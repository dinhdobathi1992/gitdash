/**
 * Signed-in, read-only MCP data tools (served at /mcp/me only).
 *
 * Each tool stands for one web API route (`apiPath`): it is authorized exactly
 * like that route (authorize-tool.ts) and answered by the same phase-02 loader
 * with the user's own GitHub token, so it shares the route's cache entries.
 *
 * Results: content[0].text is a Markdown summary with units and the time
 * window; structuredContent matches the tool's outputSchema. Errors are tool
 * errors (isError) with a fixed message: raw exception text never reaches the
 * client.
 */

import { z } from "zod";
import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { Repo, RepoSummary } from "@/lib/github";
import { validateOrg, validateOwner, validateRepo } from "@/lib/validation";
import { pLimitSettled } from "@/lib/concurrency";
import { loadRepos } from "@/lib/loaders/repos";
import { loadRepoSummary } from "@/lib/loaders/repo-summary";
import { loadRepoOverview } from "@/lib/loaders/repo-overview";
import { loadRepoDora } from "@/lib/loaders/repo-dora";
import { loadFailingWorkflows } from "@/lib/loaders/failing-workflows";
import { loadOpenPrHealth } from "@/lib/loaders/open-pr-health";
import { loadOrgHealth } from "@/lib/loaders/org-health";
import { loadCostAnalysis } from "@/lib/loaders/cost-analysis";
import type { LoaderResult } from "@/lib/loaders/types";
import { MSG, authorizeTool, revokeForTool, toolError, type ToolAuth } from "./authorize-tool";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** Repos whose recent runs list_repos looks up (one summary fetch each). */
export const LIST_REPOS_RUN_DATA_MAX = 25;
/** Repos list_repos returns. */
export const LIST_REPOS_MAX = 100;
const SUMMARY_CONCURRENCY = 5;
const STALE_PR_HOURS = 7 * 24;

// ── Input schemas (the loaders validate again with the same rules) ───────────

const owner = z
  .string()
  .max(39)
  .refine((v) => validateOwner(v).ok, "Invalid owner")
  .describe("GitHub user or organization login, e.g. 'acme'");
const repo = z
  .string()
  .max(100)
  .refine((v) => validateRepo(v).ok, "Invalid repo")
  .describe("Repository name without the owner, e.g. 'web'");
const org = z
  .string()
  .max(39)
  .refine((v) => validateOrg(v).ok, "Invalid org")
  .describe("GitHub organization login");

// ── Shared plumbing ──────────────────────────────────────────────────────────

type Outcome<T> = { ok: true; text: string; data: T } | { ok: false; error: string };

const fail = (error: string): Outcome<never> => ({ ok: false, error });

/** A loader failure as a tool error; the loader's message is fixed text, never an exception. */
function loaderError(r: Extract<LoaderResult<unknown>, { ok: false }>): Outcome<never> {
  return fail(r.hint ? `${r.error} ${r.hint}` : r.error);
}

/** Authorize, run, and map every failure to a fixed tool error. */
async function guarded<T extends Record<string, unknown>>(
  ctx: ServerContext,
  apiPath: string,
  run: (auth: ToolAuth) => Promise<Outcome<T>>,
): Promise<CallToolResult> {
  const gate = await authorizeTool(ctx.http?.authInfo, apiPath);
  if (!gate.ok) return gate.result;
  try {
    const out = await run(gate.auth);
    if (!out.ok) return toolError(out.error);
    return { content: [{ type: "text", text: out.text }], structuredContent: out.data };
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status === 401) {
      await revokeForTool(gate.auth, "github_revoked", "mcp.github_revoked");
      return toolError(MSG.githubRevoked);
    }
    if (status === 403 || status === 404) return toolError("GitHub refused this request or the resource does not exist for your account.");
    console.error(`[mcp] tool for ${apiPath} failed: ${(err as Error | null)?.name ?? "error"}${status ? ` (HTTP ${status})` : ""}`);
    return toolError("GitHub data could not be loaded right now; try again shortly.");
  }
}

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : `${Math.round(n * 10) / 10}%`);
const mins = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? "n/a" : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 6_000) / 10} min`;
const hours = (h: number) => (h < 48 ? `${Math.round(h * 10) / 10} h` : `${Math.round((h / 24) * 10) / 10} d`);
const usd = (n: number) => `$${n.toFixed(2)}`;
const nullable = <T extends z.ZodType>(t: T) => t.nullable();

// ── Tools ────────────────────────────────────────────────────────────────────

const listReposOutput = z.object({
  repos: z.array(
    z.object({
      full_name: z.string(),
      language: nullable(z.string()),
      visibility: z.enum(["public", "private"]),
      updated_at: nullable(z.string()),
      last_run_at: nullable(z.string()),
      last_conclusion: nullable(z.string()),
      success_rate_pct: nullable(z.number()),
    }),
  ),
  total: z.number(),
  shown: z.number(),
  with_run_data: z.number(),
});

const repoOverviewOutput = z.object({
  repo: z.string(),
  window: z.string(),
  runs: z.number(),
  success_rate_pct: nullable(z.number()),
  p95_duration_ms: nullable(z.number()),
  workflows: z.array(
    z.object({
      name: z.string(),
      state: z.string(),
      runs: z.number(),
      failures: z.number(),
      success_rate_pct: nullable(z.number()),
      p95_duration_ms: nullable(z.number()),
      latest_conclusion: nullable(z.string()),
      latest_run_at: nullable(z.string()),
    }),
  ),
  top_failing: z.array(z.object({ workflow: z.string(), failures: z.number() })),
});

const doraKey = z.object({ level: z.string(), label: z.string(), measured_as: z.string() });
const repoDoraOutput = z.object({
  repo: z.string(),
  overall_level: z.string(),
  deployment_frequency: doraKey.extend({ per_day: z.number(), total: z.number(), period_days: z.number() }),
  lead_time: doraKey.extend({ median_ms: z.number(), p95_ms: z.number(), sample_size: z.number() }),
  change_failure_rate: doraKey.extend({ rate_pct: z.number(), failures: z.number(), total: z.number() }),
  mttr: doraKey.extend({ mean_ms: nullable(z.number()), recoveries: z.number() }),
  prs_analysed: z.number(),
  releases_analysed: z.number(),
  partial: z.boolean(),
});

const failingOutput = z.object({
  failing: z.array(
    z.object({
      repo: z.string(),
      url: z.string(),
      latest_conclusion: nullable(z.string()),
      latest_branch: nullable(z.string()),
      latest_run_at: nullable(z.string()),
      latest_message: nullable(z.string()),
      success_rate: z.number(),
    }),
  ),
  checked: z.number(),
  total: z.number(),
  errors: z.number(),
});

const prHealthOutput = z.object({
  repo: z.string(),
  total_open: z.number(),
  stale: z.number(),
  unreviewed: z.number(),
  age_distribution: z.array(z.object({ bucket: z.string(), count: z.number() })),
  time_to_first_review_p50_hours: z.number(),
  time_to_first_review_p90_hours: z.number(),
  abandon_rate_pct: z.number(),
  oldest: z.array(
    z.object({ number: z.number(), title: z.string(), author: z.string(), age_hours: z.number(), has_review: z.boolean(), draft: z.boolean(), url: z.string() }),
  ),
  partial: z.boolean(),
});

const orgHealthOutput = z.object({
  org: z.string(),
  repos: z.array(
    z.object({
      rank: z.number(),
      repo: z.string(),
      composite_score: z.number(),
      risk_band: z.string(),
      dora_level: z.string(),
      overall_bus_factor: z.number(),
      critical_modules: z.number(),
      trend: z.string(),
      partial: z.boolean(),
    }),
  ),
  repos_analysed: z.number(),
  repos_attempted: z.number(),
});

const costOutput = z.object({
  login: z.string(),
  kind: z.enum(["org", "user"]),
  period: z.object({ year: z.number(), month: z.number() }),
  currency: z.literal("USD"),
  total_minutes: z.number(),
  total_net_amount: z.number(),
  total_gross_amount: z.number(),
  total_discount_amount: z.number(),
  by_runner: z.array(z.object({ runner: z.string(), minutes: z.number(), net_amount: z.number() })),
  top_repos: z.array(z.object({ repo: z.string(), minutes: z.number(), net_amount: z.number() })),
  projection: z.object({
    days_elapsed: z.number(),
    days_total: z.number(),
    projected_minutes: z.number(),
    daily_burn_rate_minutes: z.number(),
    projected_overage_cost: z.number(),
    status: z.string(),
  }),
});

function failuresOf(s: RepoSummary): number {
  return s.recent_runs.filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out").length;
}

function p95(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

export function registerDataTools(server: McpServer): void {
  server.registerTool(
    "list_repos",
    {
      title: "List repositories",
      description:
        `Repositories you can see in GitDash: name, language, visibility, and for the ${LIST_REPOS_RUN_DATA_MAX} most recently updated ` +
        "the last workflow run and the success rate of the last 10 completed runs.",
      inputSchema: z.object({ owner: owner.optional() }),
      outputSchema: listReposOutput,
      annotations: READ_ONLY,
    },
    async ({ owner: o }, ctx) =>
      guarded(ctx, "/api/github/repos", async (auth) => {
        const label = "mcp/list_repos";
        const res = await loadRepos(auth.gh, { label });
        if (!res.ok) return loaderError(res);
        const time = (r: Repo) => (r.updated_at ? Date.parse(r.updated_at) : 0);
        const inScope = (o ? res.data.filter((r) => r.owner.toLowerCase() === o.toLowerCase()) : res.data).sort((a, b) => time(b) - time(a));
        const shown = inScope.slice(0, LIST_REPOS_MAX);
        const withRuns = shown.slice(0, LIST_REPOS_RUN_DATA_MAX);
        const settled = await pLimitSettled(
          withRuns.map((r) => async () => {
            const s = await loadRepoSummary(auth.gh, r.owner, r.name, { label });
            return s.ok ? s.data : null;
          }),
          { concurrency: SUMMARY_CONCURRENCY },
        );
        const summaries = settled.map((s) => (s.status === "fulfilled" ? s.value : null));
        const repos = shown.map((r, i) => {
          const s = summaries[i] ?? null;
          return {
            full_name: r.full_name,
            language: r.language,
            visibility: r.private ? ("private" as const) : ("public" as const),
            updated_at: r.updated_at,
            last_run_at: s?.latest_run_at ?? null,
            last_conclusion: s?.latest_conclusion ?? null,
            success_rate_pct: s && s.recent_runs.length ? s.success_rate : null,
          };
        });
        const lines = repos.map(
          (r) =>
            `- ${r.full_name} (${r.visibility}${r.language ? `, ${r.language}` : ""})` +
            (r.last_run_at ? ` — last run ${r.last_run_at} ${r.last_conclusion ?? "in progress"}, success ${pct(r.success_rate_pct)} of the last 10 completed runs` : ""),
        );
        const head =
          `${inScope.length} repositories${o ? ` under ${o}` : ""}; showing ${shown.length}, most recently updated first. ` +
          `Run data for the first ${withRuns.length}.`;
        return {
          ok: true,
          text: `${head}\n\n${lines.join("\n")}`,
          data: { repos, total: inScope.length, shown: shown.length, with_run_data: withRuns.length },
        };
      }),
  );

  server.registerTool(
    "repo_overview",
    {
      title: "Repository CI overview",
      description: "Workflow runs, success rate, p95 duration and the most-failing workflows of one repository (up to 10 workflows, last 20 runs each).",
      inputSchema: z.object({ owner, repo }),
      outputSchema: repoOverviewOutput,
      annotations: READ_ONLY,
    },
    async ({ owner: o, repo: r }, ctx) =>
      guarded(ctx, "/api/github/repo-overview", async (auth) => {
        const res = await loadRepoOverview(auth.gh, o, r, { label: "mcp/repo_overview" });
        if (!res.ok) return loaderError(res);
        const workflows = res.data.map((w) => {
          const s = w.summary;
          return {
            name: w.name,
            state: w.state,
            runs: w.dur_points.length,
            failures: failuresOf(s),
            success_rate_pct: s.recent_runs.length ? s.success_rate : null,
            p95_duration_ms: p95(w.dur_points.map((d) => d.duration_ms)),
            latest_conclusion: s.latest_conclusion,
            latest_run_at: s.latest_run_at,
          };
        });
        const runs = workflows.reduce((n, w) => n + w.runs, 0);
        const rated = workflows.filter((w) => w.success_rate_pct !== null);
        const success = rated.length ? rated.reduce((n, w) => n + (w.success_rate_pct ?? 0), 0) / rated.length : null;
        const allDurations = res.data.flatMap((w) => w.dur_points.map((d) => d.duration_ms));
        const topFailing = workflows
          .filter((w) => w.failures > 0)
          .sort((a, b) => b.failures - a.failures)
          .slice(0, 5)
          .map((w) => ({ workflow: w.name, failures: w.failures }));
        const window = "last 20 completed runs per workflow (up to 10 workflows)";
        const text =
          `${o}/${r}: ${workflows.length} workflows, ${runs} runs (${window}). ` +
          `Average success ${pct(success)}, p95 duration ${mins(p95(allDurations))}.\n\n` +
          workflows.map((w) => `- ${w.name}: success ${pct(w.success_rate_pct)}, p95 ${mins(w.p95_duration_ms)}, ${w.failures} recent failures`).join("\n") +
          (topFailing.length ? `\n\nMost failing: ${topFailing.map((t) => `${t.workflow} (${t.failures})`).join(", ")}.` : "\n\nNo recent failures.");
        return {
          ok: true,
          text,
          data: { repo: `${o}/${r}`, window, runs, success_rate_pct: success, p95_duration_ms: p95(allDurations), workflows, top_failing: topFailing },
        };
      }),
  );

  server.registerTool(
    "repo_dora",
    {
      title: "Repository DORA metrics",
      description: "The four DORA keys of one repository (deployment frequency, lead time, change failure rate, time to restore), their ratings, and how each is measured.",
      inputSchema: z.object({ owner, repo }),
      outputSchema: repoDoraOutput,
      annotations: READ_ONLY,
    },
    async ({ owner: o, repo: r }, ctx) =>
      guarded(ctx, "/api/github/repo-dora", async (auth) => {
        const res = await loadRepoDora(auth.gh, o, r, { label: "mcp/repo_dora" });
        if (!res.ok) return loaderError(res);
        const d = res.data;
        const viaReleases = d.releases_analysed > 0;
        const data = {
          repo: `${o}/${r}`,
          overall_level: d.overall_level,
          deployment_frequency: {
            per_day: d.deployment_frequency.per_day,
            total: d.deployment_frequency.total,
            period_days: d.deployment_frequency.period_days,
            level: d.deployment_frequency.level,
            label: d.deployment_frequency.label,
            measured_as: viaReleases ? "GitHub releases per day" : "Merged pull requests per day (no releases found)",
          },
          lead_time: {
            median_ms: d.lead_time.median_ms,
            p95_ms: d.lead_time.p95_ms,
            sample_size: d.lead_time.sample_size,
            level: d.lead_time.level,
            label: d.lead_time.label,
            measured_as: "First commit (or PR opened) to merge, median",
          },
          change_failure_rate: {
            rate_pct: d.change_failure_rate.rate,
            failures: d.change_failure_rate.failures,
            total: d.change_failure_rate.total,
            level: d.change_failure_rate.level,
            label: d.change_failure_rate.label,
            measured_as: "Share of merged PRs that are hotfixes or reverts",
          },
          mttr: {
            mean_ms: d.mttr.mean_ms,
            recoveries: d.mttr.recoveries,
            level: d.mttr.level,
            label: d.mttr.label,
            measured_as: "Mean time from opening to merging a hotfix or revert PR",
          },
          prs_analysed: d.prs_analysed,
          releases_analysed: d.releases_analysed,
          partial: d.partial,
        };
        const text =
          `DORA for ${o}/${r} over ${d.deployment_frequency.period_days} days (${d.prs_analysed} merged PRs, ${d.releases_analysed} releases). Overall: ${d.overall_level}.\n\n` +
          `- Deployment frequency: ${Math.round(d.deployment_frequency.per_day * 100) / 100} per day (${d.deployment_frequency.level}) — ${data.deployment_frequency.measured_as}.\n` +
          `- Lead time: median ${hours(d.lead_time.median_ms / 3_600_000)}, p95 ${hours(d.lead_time.p95_ms / 3_600_000)} (${d.lead_time.level}) — ${data.lead_time.measured_as}.\n` +
          `- Change failure rate: ${pct(d.change_failure_rate.rate)} (${d.change_failure_rate.failures} of ${d.change_failure_rate.total}, ${d.change_failure_rate.level}) — ${data.change_failure_rate.measured_as}.\n` +
          `- Time to restore: ${d.mttr.mean_ms === null ? "n/a" : hours(d.mttr.mean_ms / 3_600_000)} (${d.mttr.level}) — ${data.mttr.measured_as}.` +
          (d.partial ? "\n\nSome PR details could not be fetched (rate limit); figures are partial." : "");
        return { ok: true, text, data };
      }),
  );

  server.registerTool(
    "failing_workflows",
    {
      title: "Failing workflows",
      description: "Repositories whose newest decisive workflow run failed, worst success rate first. Checks at most the 25 most recently updated repositories.",
      inputSchema: z.object({ owner: owner.optional() }),
      outputSchema: failingOutput,
      annotations: READ_ONLY,
    },
    async ({ owner: o }, ctx) =>
      guarded(ctx, "/api/github/repo-summary", async (auth) => {
        const res = await loadFailingWorkflows(auth.gh, o ?? null, { label: "mcp/failing_workflows" });
        if (!res.ok) return loaderError(res);
        const d = res.data;
        const head = `Checked ${d.checked} of ${d.total} repositories${o ? ` under ${o}` : ""} (most recently updated first)` + (d.errors ? `; ${d.errors} could not be loaded.` : ".");
        const body = d.failing.length
          ? d.failing.map((f) => `- ${f.repo}: latest ${f.latest_conclusion ?? "failure"} on ${f.latest_branch ?? "?"} at ${f.latest_run_at ?? "?"}, success ${pct(f.success_rate)} of the last 10 completed runs`).join("\n")
          : "No failing repositories.";
        return { ok: true, text: `${head}\n\n${body}`, data: { ...d } };
      }),
  );

  server.registerTool(
    "open_pr_health",
    {
      title: "Open pull request health",
      description: "Open pull requests of one repository: age buckets, stale (open over 7 days) and unreviewed counts, review speed and the oldest PRs.",
      inputSchema: z.object({ owner, repo }),
      outputSchema: prHealthOutput,
      annotations: READ_ONLY,
    },
    async ({ owner: o, repo: r }, ctx) =>
      guarded(ctx, "/api/github/open-pr-health", async (auth) => {
        const res = await loadOpenPrHealth(auth.gh, o, r, { label: "mcp/open_pr_health" });
        if (!res.ok) return loaderError(res);
        const d = res.data;
        const ready = d.open_prs.filter((p) => !p.draft);
        const stale = ready.filter((p) => p.age_hours > STALE_PR_HOURS).length;
        const unreviewed = ready.filter((p) => !p.has_review).length;
        const oldest = [...d.open_prs]
          .sort((a, b) => b.age_hours - a.age_hours)
          .slice(0, 10)
          .map((p) => ({ number: p.number, title: p.title, author: p.author, age_hours: p.age_hours, has_review: p.has_review, draft: p.draft, url: p.html_url }));
        const text =
          `${o}/${r}: ${d.total_open} open PRs; ${stale} stale (non-draft, open over 7 days), ${unreviewed} without any review. ` +
          `First review p50 ${hours(d.time_to_first_review_p50_hours)}, p90 ${hours(d.time_to_first_review_p90_hours)} (from ${d.closed_prs_analysed} recently closed PRs); abandon rate ${pct(d.abandon_rate)}.\n\n` +
          `Age: ${d.age_distribution.map((b) => `${b.bucket} ${b.count}`).join(", ")}.\n\n` +
          (oldest.length ? `Oldest:\n${oldest.map((p) => `- #${p.number} ${p.title} — ${hours(p.age_hours)}${p.draft ? ", draft" : ""}${p.has_review ? "" : ", no review"}`).join("\n")}` : "No open PRs.");
        return {
          ok: true,
          text,
          data: {
            repo: `${o}/${r}`,
            total_open: d.total_open,
            stale,
            unreviewed,
            age_distribution: d.age_distribution,
            time_to_first_review_p50_hours: d.time_to_first_review_p50_hours,
            time_to_first_review_p90_hours: d.time_to_first_review_p90_hours,
            abandon_rate_pct: d.abandon_rate,
            oldest,
            partial: d.partial,
          },
        };
      }),
  );

  server.registerTool(
    "org_health",
    {
      title: "Organization health scorecard",
      description: "Ranked health scorecard for up to 10 repositories of an organization: composite score (DORA tier and bus factor), risk band and throughput trend.",
      inputSchema: z.object({ org }),
      outputSchema: orgHealthOutput,
      annotations: READ_ONLY,
    },
    async ({ org: g }, ctx) =>
      guarded(ctx, "/api/github/org-health-scorecard", async (auth) => {
        const res = await loadOrgHealth(auth.gh, g, null, { label: "mcp/org_health" });
        if (!res.ok) return loaderError(res);
        const d = res.data;
        const repos = [...d.repos]
          .sort((a, b) => b.composite_score - a.composite_score)
          .map((x, i) => ({
            rank: i + 1,
            repo: `${x.owner}/${x.repo}`,
            composite_score: x.composite_score,
            risk_band: x.risk_band,
            dora_level: x.dora_level,
            overall_bus_factor: x.overall_bus_factor,
            critical_modules: x.critical_modules,
            trend: x.trend,
            partial: x.partial,
          }));
        const text =
          `${d.org}: ${d.repos_analysed} of ${d.repos_attempted} repositories scored (0-100, higher is healthier: 60% DORA tier, 40% bus factor).\n\n` +
          repos.map((x) => `${x.rank}. ${x.repo} — ${x.composite_score} (${x.risk_band}), DORA ${x.dora_level}, bus factor ${x.overall_bus_factor}, trend ${x.trend}`).join("\n");
        return { ok: true, text, data: { org: d.org, repos, repos_analysed: d.repos_analysed, repos_attempted: d.repos_attempted } };
      }),
  );

  server.registerTool(
    "actions_cost",
    {
      title: "GitHub Actions cost",
      description: "GitHub Actions spend for an organization in one month (default: this month): minutes and USD by runner and by repository, plus the month-end projection.",
      inputSchema: z.object({
        org,
        year: z.number().int().min(2020).max(2100).optional().describe("Four-digit year; default this year"),
        month: z.number().int().min(1).max(12).optional().describe("1-12; default this month"),
      }),
      outputSchema: costOutput,
      annotations: READ_ONLY,
    },
    async ({ org: g, year, month }, ctx) =>
      guarded(ctx, "/api/github/billing/cost-analysis", async (auth) => {
        // Same defaults as the web route.
        const now = new Date();
        const res = await loadCostAnalysis(auth.gh, g, year ?? now.getFullYear(), month ?? now.getMonth() + 1, { label: "mcp/actions_cost" });
        if (!res.ok) return loaderError(res);
        const d = res.data;
        const byRunner = d.skus.map((s) => ({ runner: s.label, minutes: s.minutes, net_amount: s.net_amount })).sort((a, b) => b.net_amount - a.net_amount);
        const topRepos = (d.repos ?? []).slice(0, 10).map((x) => ({ repo: x.repo, minutes: x.minutes, net_amount: x.net_amount }));
        const b = d.burn_rate;
        const period = `${d.period.year}-${String(d.period.month).padStart(2, "0")}`;
        const text =
          `GitHub Actions for ${d.login}, ${period}: ${Math.round(d.total_minutes)} minutes, ${usd(d.total_net_amount)} billed ` +
          `(${usd(d.total_gross_amount)} gross, ${usd(d.total_discount_amount)} discounts). ` +
          `Projected month end: ${Math.round(b.projected_minutes)} minutes at ${Math.round(b.daily_burn_rate)} minutes/day (day ${b.days_elapsed} of ${b.days_total}), status ${b.status}.\n\n` +
          `By runner:\n${byRunner.map((x) => `- ${x.runner}: ${Math.round(x.minutes)} min, ${usd(x.net_amount)}`).join("\n") || "- none"}` +
          (topRepos.length ? `\n\nTop repositories:\n${topRepos.map((x) => `- ${x.repo}: ${Math.round(x.minutes)} min, ${usd(x.net_amount)}`).join("\n")}` : "");
        return {
          ok: true,
          text,
          data: {
            login: d.login,
            kind: d.kind,
            period: d.period,
            currency: "USD" as const,
            total_minutes: d.total_minutes,
            total_net_amount: d.total_net_amount,
            total_gross_amount: d.total_gross_amount,
            total_discount_amount: d.total_discount_amount,
            by_runner: byRunner,
            top_repos: topRepos,
            projection: {
              days_elapsed: b.days_elapsed,
              days_total: b.days_total,
              projected_minutes: b.projected_minutes,
              daily_burn_rate_minutes: b.daily_burn_rate,
              projected_overage_cost: b.projected_overage_cost,
              status: b.status,
            },
          },
        };
      }),
  );
}
