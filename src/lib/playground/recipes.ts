/**
 * Playground recipes: for each metric, make the same GitHub REST calls
 * GitDash makes, then "cook" the raw responses with the SAME functions
 * production uses (imported, never re-implemented here). Everything this file
 * adds is orchestration and presentation: which calls, in what order, and how
 * to label the intermediate and final numbers.
 *
 * Runs in the browser (and in vitest). No server-only imports.
 */

import {
  BENCHMARKS, LEVEL_LABELS, DORA_PR_DETAIL_LIMIT, FAILURE_PR_BRANCH, calculateDoraMetrics, calculateRepoDora,
  toMergedPrInputs, toPrDetail, toReleaseInputs,
  type DoraLevel, type DoraMetrics, type PrDetailInput, type RawPullForDora,
} from "@/lib/dora";
import { computeOpenPrHealth, mergedReviewSample, MERGED_REVIEW_SAMPLE, type PullWithReviews, type RawPull, type RawReview } from "@/lib/pr-health";
import { BUS_FACTOR_COVERAGE, calculateBusFactor, commitAuthor, commitFiles, type AuthoredCommit, type ModuleOwnership } from "@/lib/bus-factor-core";
import { isBot } from "@/lib/bots";
import {
  WORKLOAD_THRESHOLDS, RECENT_DAYS, buildWorkloadCounters, computeWorkloadPeople, countCommitsByAuthor, countOpenPrsByAuthor,
  type RawCommitForWorkload,
} from "@/lib/team-workload-core";
import { DEFAULT_WORKDAY, formatWorkday } from "@/lib/team-settings";
import { buildRepoSummary, toWorkflowRun, type RawWorkflowRun } from "@/lib/workflow-run-stats";
import { repoHealth } from "@/lib/repo-health";
import type { StatusTone } from "@/components/ui/StatusPill";
import { pLimitSettled } from "@/lib/concurrency";
import { formatDurationShort } from "@/lib/utils";
import { GitHubCallError, type Exchange, type GitHubRequest, type Source } from "./source";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MetricId = "dora" | "pr-health" | "bus-factor" | "workload-ci";

export interface CookStep {
  title: string;
  /** Plain-language formula, as production computes it. */
  formula?: string;
  /** Labelled intermediate numbers. */
  rows?: [string, string][];
  table?: { columns: string[]; rows: string[][] };
  note?: string;
}

export interface CookedCard {
  label: string;
  value: string;
  sub?: string;
  badge?: { text: string; tone: StatusTone };
}

export interface CookedGroup {
  title: string;
  /** Where GitDash shows this. */
  where: string;
  cards: CookedCard[];
}

export interface RecipeResult {
  exchanges: Exchange[];
  steps: CookStep[];
  cooked: CookedGroup[];
  /** Differences from production for this run (request caps etc.). */
  caveats: string[];
}

/** Per-call fan-out caps. Sample mode uses production's; live mode is capped to spare the visitor's rate limit. */
export interface Limits {
  doraPrDetail: number;
  openPrReviews: number;
  mergedPrReviews: number;
  busFactorCommitDetail: number;
}

export const PRODUCTION_LIMITS: Limits = {
  doraPrDetail: DORA_PR_DETAIL_LIMIT,
  openPrReviews: 100,
  mergedPrReviews: MERGED_REVIEW_SAMPLE,
  busFactorCommitDetail: 300,
};

export const LIVE_LIMITS: Limits = {
  doraPrDetail: 5,
  openPrReviews: 10,
  mergedPrReviews: 10,
  busFactorCommitDetail: 20,
};

export interface RecipeContext {
  source: Source;
  owner: string;
  repo: string;
  /** "now" for every time-relative number (sample mode: the capture instant). */
  now: number;
  limits: Limits;
  signal?: AbortSignal;
}

export const METRICS: { id: MetricId; label: string; blurb: string }[] = [
  { id: "dora", label: "DORA 4 keys", blurb: "Deployment frequency, lead time, change failure rate and MTTR — from PRs and releases, and from a deploy workflow's runs." },
  { id: "pr-health", label: "Open PR health", blurb: "Open PR ages, review rounds, time to first review, approval-to-merge and abandon rate." },
  { id: "bus-factor", label: "Bus factor", blurb: "How many people hold 80% of the commits, per module and repo-wide." },
  { id: "workload-ci", label: "Workload & CI", blurb: "After-hours, weekend, activity-cliff and open-PR load per person, plus CI success rate and duration." },
];

// ── Shared plumbing ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const FAN_OUT_CONCURRENCY = 4;

function get(path: string, params: Record<string, string> = {}): GitHubRequest {
  return { method: "GET", path, params };
}

/** Call log for one recipe run: required calls throw, fan-out calls are settled like production's pLimitSettled. */
class Calls {
  readonly exchanges: Exchange[] = [];
  constructor(private ctx: RecipeContext) {}

  async required<T>(req: GitHubRequest): Promise<T> {
    try {
      const ex = await this.ctx.source(req, this.ctx.signal);
      this.exchanges.push(ex);
      return ex.body as T;
    } catch (e) {
      if (e instanceof GitHubCallError) this.exchanges.push(e.exchange);
      throw e;
    }
  }

  /** Runs `tasks` with bounded concurrency; failures are logged and dropped (production marks the result partial). */
  async settled<T>(tasks: Array<() => Promise<T>>): Promise<{ values: (T | null)[]; failed: number }> {
    const results = await pLimitSettled(tasks, { concurrency: FAN_OUT_CONCURRENCY });
    let failed = 0;
    const values = results.map((r) => {
      if (r.status === "fulfilled") return r.value;
      if ((r.reason as Error)?.name === "AbortError") throw r.reason;
      // A rejected token is not a partial result: fail the whole run.
      if (r.reason instanceof GitHubCallError && r.reason.exchange.status === 401) throw r.reason;
      failed++;
      return null;
    });
    return { values, failed };
  }
}

const repoPath = (ctx: RecipeContext) => `/repos/${ctx.owner}/${ctx.repo}`;
const iso = (ms: number) => new Date(ms).toISOString();
const hours = (h: number) => `${h.toFixed(1)} h`;
const pct = (n: number) => `${n}%`;
const ms = (v: number | null | undefined) => formatDurationShort(v);
const shortDate = (s: string | null) => (s ? s.replace("T", " ").replace(/:\d\dZ$/, "Z") : "—");

const LEVEL_TONE: Record<DoraLevel, StatusTone> = { elite: "pass", high: "run", medium: "warn", low: "fail" };
const levelBadge = (l: DoraLevel) => ({ text: LEVEL_LABELS[l], tone: LEVEL_TONE[l] });

function doraCards(d: DoraMetrics): CookedCard[] {
  return [
    { label: "Deployment frequency", value: d.deployment_frequency.label, sub: BENCHMARKS.deployment_frequency[d.deployment_frequency.level], badge: levelBadge(d.deployment_frequency.level) },
    { label: "Lead time for changes", value: d.lead_time.label, sub: `p95 ${ms(d.lead_time.p95_ms)} · ${d.lead_time.sample_size} samples`, badge: levelBadge(d.lead_time.level) },
    { label: "Change failure rate", value: d.change_failure_rate.label, sub: `${d.change_failure_rate.failures} of ${d.change_failure_rate.total}`, badge: levelBadge(d.change_failure_rate.level) },
    { label: "Mean time to recovery", value: d.mttr.label, sub: `${d.mttr.recoveries} recoveries`, badge: levelBadge(d.mttr.level) },
    { label: "Overall DORA level", value: LEVEL_LABELS[d.overall_level], sub: "Worst of the four", badge: levelBadge(d.overall_level) },
  ];
}

// ── 1. DORA ───────────────────────────────────────────────────────────────────

async function doraRecipe(ctx: RecipeContext): Promise<RecipeResult> {
  const calls = new Calls(ctx);
  const base = repoPath(ctx);
  const caveats: string[] = [];

  // Repo DORA (src/lib/github-dora.ts → calculateRepoDora)
  const closed = await calls.required<RawPullForDora[]>(get(`${base}/pulls`, { state: "closed", per_page: "60", sort: "updated", direction: "desc" }));
  const rawReleases = await calls.required<{ published_at: string | null }[]>(get(`${base}/releases`, { per_page: "30" }));
  const mergedPrs = toMergedPrInputs(closed);
  const releases = toReleaseInputs(rawReleases);

  const detailPrs = mergedPrs.slice(0, ctx.limits.doraPrDetail);
  if (ctx.limits.doraPrDetail < DORA_PR_DETAIL_LIMIT && mergedPrs.length > detailPrs.length) {
    caveats.push(`Per-PR detail fetched for ${detailPrs.length} merged PRs (GitDash fetches ${DORA_PR_DETAIL_LIMIT}); the rest fall back to PR created_at for lead time.`);
  }
  const { values: details, failed: detailFailed } = await calls.settled(
    detailPrs.map((pr) => async () => {
      const [commits, reviews, pull] = await Promise.all([
        calls.required<Parameters<typeof toPrDetail>[1]>(get(`${base}/pulls/${pr.number}/commits`, { per_page: "250" })),
        calls.required<RawReview[]>(get(`${base}/pulls/${pr.number}/reviews`, { per_page: "100" })),
        calls.required<{ additions: number; deletions: number }>(get(`${base}/pulls/${pr.number}`)),
      ]);
      return toPrDetail(pr.number, commits, reviews, pull);
    }),
  );
  const detailMap = new Map<number, PrDetailInput>();
  for (const d of details) if (d) detailMap.set(d.number, d);
  if (detailFailed) caveats.push(`${detailFailed} per-PR detail fetches failed — GitDash marks this result partial.`);

  const repoDora = calculateRepoDora(mergedPrs, releases, detailMap);

  // Workflow DORA (workflow page → calculateDoraMetrics over one workflow's runs)
  const workflows = await calls.required<{ workflows: { id: number; name: string; path: string; state: string }[] }>(get(`${base}/actions/workflows`, { per_page: "10" }));
  const active = workflows.workflows.filter((w) => w.state === "active");
  const wf = active.find((w) => /deploy|release/i.test(`${w.name} ${w.path}`)) ?? active[0] ?? null;
  let wfDora: DoraMetrics | null = null;
  let wfRunCount = 0;
  if (wf) {
    const runs = await calls.required<{ workflow_runs: RawWorkflowRun[] }>(get(`${base}/actions/workflows/${wf.id}/runs`, { per_page: "50" }));
    const mapped = runs.workflow_runs.map(toWorkflowRun);
    wfRunCount = mapped.length;
    wfDora = calculateDoraMetrics(mapped);
    caveats.push(`Workflow DORA uses "${wf.name}" — picked by the playground (a deploy/release workflow, else the first active one). In GitDash it is computed for whichever workflow page you open.`);
  } else {
    caveats.push("No active workflow found — the workflow-run DORA view is skipped.");
  }

  const r = repoDora;
  const steps: CookStep[] = [
    {
      title: "Merged PRs (toMergedPrInputs)",
      formula: "Keep closed PRs whose merged_at is set; read number, title, created_at, merged_at, head.ref.",
      rows: [["Closed PRs returned", String(closed.length)], ["Merged PRs kept", String(mergedPrs.length)]],
    },
    {
      title: "Deploy events (toReleaseInputs)",
      formula: "Published releases are deploys; drafts (published_at = null) are dropped. No releases → merged PRs count as deploys.",
      rows: [
        ["Releases returned", String(rawReleases.length)],
        ["Published releases kept", String(releases.length)],
        ["Deploys counted from", r.releases_analysed > 0 ? "GitHub releases" : "merged PRs (no releases)"],
      ],
    },
    {
      title: "Per-PR detail (toPrDetail)",
      formula: "first_commit_at = oldest commit date; first_review_at = earliest submitted review; approved_at = first APPROVED review; size from additions + deletions.",
      table: {
        columns: ["PR", "first commit", "first review", "approved", "merged"],
        rows: detailPrs.map((pr) => {
          const d = detailMap.get(pr.number);
          return [`#${pr.number}`, shortDate(d?.first_commit_at ?? null), shortDate(d?.first_review_at ?? null), shortDate(d?.approved_at ?? null), shortDate(pr.merged_at)];
        }),
      },
    },
    {
      title: "Deployment frequency",
      formula: "deploys ÷ days between first and last deploy (at least 1 day; 30 days when fewer than 2 deploys).",
      rows: [["Deploys", String(r.deployment_frequency.total)], ["Period", `${r.deployment_frequency.period_days} days`], ["Per day", String(r.deployment_frequency.per_day)], ["Level", LEVEL_LABELS[r.deployment_frequency.level]]],
    },
    {
      title: "Lead time for changes",
      formula: "merged_at − first commit (PR created_at when no detail) per merged PR; median and p95.",
      rows: [["Samples", String(r.lead_time.sample_size)], ["Median", ms(r.lead_time.median_ms)], ["p95", ms(r.lead_time.p95_ms)], ["Level", LEVEL_LABELS[r.lead_time.level]]],
    },
    {
      title: "Change failure rate",
      formula: `Merged PRs whose branch matches ${FAILURE_PR_BRANCH} or whose title starts with "Revert ", ÷ merged PRs.`,
      rows: [["Failure PRs", String(r.change_failure_rate.failures)], ["Merged PRs", String(r.change_failure_rate.total)], ["Rate", r.change_failure_rate.label], ["Level", LEVEL_LABELS[r.change_failure_rate.level]]],
    },
    {
      title: "Mean time to recovery",
      formula: "Mean of (merged_at − created_at) over the failure PRs — how fast the fix landed.",
      rows: [["Recoveries", String(r.mttr.recoveries)], ["Mean", r.mttr.label], ["Level", LEVEL_LABELS[r.mttr.level]]],
    },
  ];
  if (wfDora) {
    steps.push({
      title: `Workflow-run DORA — "${wf!.name}" (toWorkflowRun → calculateDoraMetrics)`,
      formula: "Completed runs = deploys. Lead time = run created → completed (queue + execution), for runs whose head commit has an author. CFR = failed ÷ completed runs. MTTR = first failure → next success on the same branch.",
      rows: [
        ["Runs returned", String(wfRunCount)],
        ["Completed runs", String(wfDora.change_failure_rate.total)],
        ["Failed runs", String(wfDora.change_failure_rate.failures)],
        ["Span", `${wfDora.deployment_frequency.period_days} days`],
        ["Lead time median / p95", `${ms(wfDora.lead_time.median_ms)} / ${ms(wfDora.lead_time.p95_ms)}`],
        ["Recoveries", String(wfDora.mttr.recoveries)],
      ],
    });
  }

  const cooked: CookedGroup[] = [{ title: "Repository DORA", where: "Repository → Overview → DORA cards", cards: [...doraCards(r), { label: "PRs analysed", value: String(r.prs_analysed), sub: `${r.releases_analysed} releases` }] }];
  if (wfDora) cooked.push({ title: `Workflow DORA — ${wf!.name}`, where: "Workflow detail page → DORA", cards: doraCards(wfDora) });

  return { exchanges: calls.exchanges, steps, cooked, caveats };
}

// ── 2. Open PR health ─────────────────────────────────────────────────────────

async function prHealthRecipe(ctx: RecipeContext): Promise<RecipeResult> {
  const calls = new Calls(ctx);
  const base = repoPath(ctx);
  const caveats: string[] = [];

  const openPrs = await calls.required<RawPull[]>(get(`${base}/pulls`, { state: "open", per_page: "100", sort: "created", direction: "desc" }));
  const closedPrs = await calls.required<RawPull[]>(get(`${base}/pulls`, { state: "closed", per_page: "60", sort: "updated", direction: "desc" }));

  const openSlice = openPrs.slice(0, ctx.limits.openPrReviews);
  if (openSlice.length < openPrs.length) caveats.push(`Reviews fetched for ${openSlice.length} of ${openPrs.length} open PRs (GitDash fetches all); the others are left out of the open-PR numbers.`);
  const sample = mergedReviewSample(closedPrs);
  const mergedSlice = sample.slice(0, ctx.limits.mergedPrReviews);
  if (mergedSlice.length < sample.length) caveats.push(`Reviews fetched for ${mergedSlice.length} of ${sample.length} sampled merged PRs (GitDash fetches up to ${MERGED_REVIEW_SAMPLE}).`);

  const withReviews = (prs: RawPull[]) => calls.settled(prs.map((pr) => async (): Promise<PullWithReviews> => ({
    pr, reviews: await calls.required<RawReview[]>(get(`${base}/pulls/${pr.number}/reviews`, { per_page: "100" })),
  })));
  const openRes = await withReviews(openSlice);
  const mergedRes = await withReviews(mergedSlice);
  const failed = openRes.failed + mergedRes.failed;
  if (failed) caveats.push(`${failed} review fetches failed — GitDash marks this result partial.`);

  const open = openRes.values.filter((v): v is PullWithReviews => v !== null);
  const merged = mergedRes.values.filter((v): v is PullWithReviews => v !== null);
  const h = computeOpenPrHealth({ open, closedPrs, merged, now: ctx.now });

  const oldest = h.open_prs[0];
  const busiest = h.concurrent_prs_by_author[0];
  const steps: CookStep[] = [
    {
      title: "Inputs",
      rows: [
        ["Open PRs returned", String(openPrs.length)],
        ["Recently closed PRs (abandon-rate base)", String(closedPrs.length)],
        ["Merged PRs sampled for review times", `${merged.length} (most recent ${MERGED_REVIEW_SAMPLE} max)`],
      ],
    },
    {
      title: "Open PRs with review status",
      formula: "age = now − created_at; review rounds = reviews with a submitted_at.",
      table: {
        columns: ["PR", "author", "age", "rounds", "draft"],
        rows: h.open_prs.map((p) => [`#${p.number}`, p.author, hours(p.age_hours), String(p.review_rounds), p.draft ? "yes" : "no"]),
      },
    },
    {
      title: "Time to first review (merged PRs)",
      formula: "earliest submitted review − PR created_at, in hours; p50/p90 by linear interpolation.",
      rows: [["p50", hours(h.time_to_first_review_p50_hours)], ["p90", hours(h.time_to_first_review_p90_hours)]],
    },
    {
      title: "Approval → merge (merged PRs)",
      formula: "merged_at − first APPROVED review, in hours; p50/p90.",
      rows: [["p50", hours(h.time_approval_to_merge_p50_hours)], ["p90", hours(h.time_approval_to_merge_p90_hours)]],
    },
    {
      title: "Distributions",
      rows: [
        ...h.age_distribution.map((b): [string, string] => [`Age ${b.bucket}`, String(b.count)]),
        ...h.review_round_distribution.map((b): [string, string] => [`Merged PRs with ${b.rounds} review rounds`, String(b.count)]),
      ],
    },
    {
      title: "Abandon rate",
      formula: "closed PRs with merged_at = null ÷ recently closed PRs, rounded to a whole percent.",
      rows: [["Closed PRs", String(h.closed_prs_analysed)], ["Abandon rate", pct(h.abandon_rate)]],
    },
  ];

  const cooked: CookedGroup[] = [{
    title: "Open PR health",
    where: "Repository → Pull requests",
    cards: [
      {
        label: "Open PRs",
        value: String(h.total_open),
        sub: [openSlice.length < openPrs.length ? `reviewed ${h.total_open} of ${openPrs.length} open` : null, oldest ? `Oldest: #${oldest.number}, ${hours(oldest.age_hours)}` : "None open"].filter(Boolean).join(" · "),
      },
      { label: "Time to first review", value: hours(h.time_to_first_review_p50_hours), sub: `p50 · p90 ${hours(h.time_to_first_review_p90_hours)}` },
      { label: "Approval → merge", value: hours(h.time_approval_to_merge_p50_hours), sub: `p50 · p90 ${hours(h.time_approval_to_merge_p90_hours)}` },
      { label: "Abandon rate", value: pct(h.abandon_rate), sub: `of ${h.closed_prs_analysed} recently closed PRs` },
      { label: "Most concurrent PRs", value: busiest ? String(busiest.count) : "0", sub: busiest ? busiest.login : "—" },
    ],
  }];
  return { exchanges: calls.exchanges, steps, cooked, caveats };
}

// ── 3. Bus factor ─────────────────────────────────────────────────────────────

async function busFactorRecipe(ctx: RecipeContext): Promise<RecipeResult> {
  const calls = new Calls(ctx);
  const base = repoPath(ctx);
  const caveats: string[] = [];

  // Production lists up to 3 pages of 100; the playground reads the first page.
  const listed = await calls.required<RawCommitForWorkload[]>(get(`${base}/commits`, { since: iso(ctx.now - 90 * DAY_MS), per_page: "100", page: "1" }));
  if (listed.length === 100) caveats.push("Only the first page (100 commits) is read; GitDash reads up to 300.");
  const toResolve = listed.slice(0, ctx.limits.busFactorCommitDetail) as (RawCommitForWorkload & { sha: string })[];
  if (toResolve.length < listed.length) caveats.push(`File lists fetched for ${toResolve.length} of ${listed.length} commits (GitDash fetches all, cached forever per SHA).`);

  const { values, failed } = await calls.settled(toResolve.map((c) => async (): Promise<AuthoredCommit> => ({
    author: commitAuthor(c),
    files: commitFiles(await calls.required<{ files?: { filename: string }[] }>(get(`${base}/commits/${c.sha}`))),
  })));
  if (failed) caveats.push(`${failed} commit detail fetches failed — GitDash marks this result partial.`);
  const commits = values.filter((v): v is AuthoredCommit => v !== null);
  const bf = calculateBusFactor(commits);

  const bots = [...new Set(commits.map((c) => c.author))].filter((a) => isBot(a));
  const steps: CookStep[] = [
    {
      title: "Commits (last 90 days)",
      formula: "Author = linked GitHub login, else the git author name. Files come from GET /commits/{sha}.",
      rows: [["Commits listed", String(listed.length)], ["Commits resolved to files", String(commits.length)], ["Unique authors", String(bf.total_contributors)]],
    },
    {
      title: "Group by module (moduleOf)",
      formula: "Module = first two path segments (src/lib/x.ts → src/lib); top-level files → (root). A commit counts once per module it touches.",
    },
    {
      title: "Bus factor per module",
      formula: `Sort contributors by commits; bus factor = how many it takes to reach ${BUS_FACTOR_COVERAGE * 100}% of the module's commits. 1 = critical, 2 = warning, 3+ = healthy.`,
      table: {
        columns: ["module", "commits", "top contributor", "bus factor", "risk"],
        rows: bf.modules.map((m) => [m.module, String(m.total_commits), m.contributors[0] ? `${m.contributors[0].login} (${m.contributors[0].pct}%)` : "—", String(m.bus_factor), m.risk]),
      },
    },
    {
      title: "Repository bus factor",
      formula: `Same ${BUS_FACTOR_COVERAGE * 100}% rule over all commits by author.`,
      rows: [["Overall bus factor", String(bf.overall_bus_factor)], ["Critical modules", String(bf.critical_modules)]],
      note: bots.length ? `Bot accounts (${bots.join(", ")}) are counted like people here — GitDash's bus factor does not exclude bots.` : undefined,
    },
  ];
  const riskTone: Record<ModuleOwnership["risk"], StatusTone> = { critical: "fail", warning: "warn", healthy: "pass" };
  const cooked: CookedGroup[] = [{
    title: "Bus factor",
    where: "Repository → Team → Bus factor heatmap",
    cards: [
      { label: "Repository bus factor", value: String(bf.overall_bus_factor), sub: `people holding ${BUS_FACTOR_COVERAGE * 100}% of ${bf.total_commits} commits` },
      { label: "Critical modules", value: String(bf.critical_modules), sub: `of ${bf.modules.length} modules` },
      { label: "Contributors", value: String(bf.total_contributors) },
      ...bf.modules.slice(0, 3).map((m): CookedCard => ({ label: m.module, value: `bus factor ${m.bus_factor}`, sub: m.contributors.map((c) => `${c.login} ${c.pct}%`).join(" · "), badge: { text: m.risk, tone: riskTone[m.risk] } })),
    ],
  }];
  return { exchanges: calls.exchanges, steps, cooked, caveats };
}

// ── 4. Workload risk + CI health ──────────────────────────────────────────────

/** Legacy repo Team tab window (src/app/api/github/team-workload-risk/route.ts). */
const WORKLOAD_WINDOW_DAYS = 42;

async function workloadCiRecipe(ctx: RecipeContext): Promise<RecipeResult> {
  const calls = new Calls(ctx);
  const base = repoPath(ctx);
  const caveats: string[] = [];
  const workday = DEFAULT_WORKDAY;

  const commits = await calls.required<RawCommitForWorkload[]>(get(`${base}/commits`, { since: iso(ctx.now - WORKLOAD_WINDOW_DAYS * DAY_MS), per_page: "100", page: "1" }));
  const openPrs = await calls.required<{ user?: { login: string } | null }[]>(get(`${base}/pulls`, { state: "open", per_page: "100" }));
  const partial = commits.length === 100;
  if (partial) caveats.push("Only the first page (100 commits) is read; GitDash reads up to 5 pages, so older (prior-period) commits are missing here and the activity-cliff flag may differ.");
  caveats.push(`Hours are counted in the default workday (${formatWorkday(workday)}); a GitDash admin can set the org's own workday.`);

  const counters = buildWorkloadCounters(countCommitsByAuthor(commits, { workday, now: ctx.now }), countOpenPrsByAuthor(openPrs), { windowDays: WORKLOAD_WINDOW_DAYS, partial });
  // The legacy repo Team tab view: activity cliff always evaluated (computeWorkload's default).
  // No account links in the playground, so every login is its own person ("no links" rule:
  // lowercase login, as identity-links.ts noLinks — not imported because that module uses node crypto).
  const people = computeWorkloadPeople(counters, (login) => login.toLowerCase(), { personKey: (k) => k });

  const runsBody = await calls.required<{ workflow_runs: RawWorkflowRun[] }>(get(`${base}/actions/runs`, { per_page: "30" }));
  const summary = buildRepoSummary(runsBody.workflow_runs, ctx.now);
  const health = repoHealth(summary, ctx.now);
  const t = WORKLOAD_THRESHOLDS;

  const steps: CookStep[] = [
    {
      title: `Per-author counters (${WORKLOAD_WINDOW_DAYS} days, workday ${formatWorkday(workday)})`,
      formula: `Each commit's author date is read in the workday's zone: outside the workday hours → after-hours; Sat/Sun → weekend. Last ${RECENT_DAYS} days → recent, older → prior.`,
      table: {
        columns: ["author", "commits", "after-hours", "weekend", "recent", "prior", "bot"],
        rows: counters.authors.map((a) => [a.login + (a.unlinked_name ? " (git name)" : ""), String(a.total), String(a.afterHours), String(a.weekend), String(a.recent), String(a.prior), a.is_bot ? "yes" : ""]),
      },
    },
    {
      title: "Open PRs per author",
      rows: Object.entries(counters.open_prs).map(([login, n]): [string, string] => [login, String(n)]),
    },
    {
      title: "Flags (computeWorkload)",
      formula: `after-hours ≥ ${t.after_hours_pct}% and weekend ≥ ${t.weekend_pct}% (each needs ≥ ${t.min_sample} commits); open PRs ≥ ${t.open_prs}; activity cliff = ≥ 3 prior commits and 0 recent. Risk score = number of flags.`,
      table: {
        columns: ["person", "after-hours", "weekend", "open PRs", "flags"],
        rows: people.map((p) => [p.login + (p.is_bot ? " (bot)" : ""), pct(p.after_hours_pct), pct(p.weekend_pct), String(p.open_pr_count), flagList(p.flags) || "—"]),
      },
    },
    {
      title: "CI runs (buildRepoSummary)",
      formula: "Success rate = successful ÷ the 10 most recent completed runs. 30-day window: completed runs created in the last 30 days; duration = updated_at − run_started_at; p95 by nearest rank.",
      rows: [
        ["Runs returned", String(runsBody.workflow_runs.length)],
        ["Completed runs in 30 days", String(summary.runs_30d ?? 0)],
        ["30-day success rate", summary.success_rate_30d == null ? "—" : `${summary.success_rate_30d}%`],
        ["p95 duration (30 days)", ms(summary.p95_duration_ms)],
        ["Latest run", `${summary.latest_status ?? "—"} / ${summary.latest_conclusion ?? "—"} on ${summary.latest_branch ?? "—"}`],
      ],
    },
    {
      title: "Status (repoHealth)",
      formula: "Running/queued wins; otherwise the newest decisive run (success or failure — cancelled/skipped ignored) decides Passing vs Failing; nothing in 30 days → No recent runs.",
      rows: [["Status", health.label]],
    },
  ];

  const flagged = people.filter((p) => p.risk_score > 0);
  const cooked: CookedGroup[] = [
    {
      title: "Workload risk",
      where: "Repository → Team → Workload risk radar",
      cards: flagged.length
        ? flagged.map((p): CookedCard => ({ label: p.login, value: flagList(p.flags), sub: `${p.total_commits} commits · ${pct(p.after_hours_pct)} after-hours · ${pct(p.weekend_pct)} weekend · ${p.open_pr_count} open PRs`, badge: { text: `risk ${p.risk_score}`, tone: p.risk_score >= 2 ? "fail" : "warn" } }))
        : [{ label: "No one flagged", value: "—", sub: `${people.length} people checked` }],
    },
    {
      title: "CI health",
      where: "Repositories list and repository header",
      cards: [
        { label: "Status", value: health.label, badge: { text: health.label, tone: health.tone } },
        { label: "Success rate", value: `${summary.success_rate}%`, sub: "last 10 completed runs" },
        { label: "30-day success rate", value: summary.success_rate_30d == null ? "—" : `${summary.success_rate_30d}%`, sub: `${summary.runs_30d ?? 0} completed runs` },
        { label: "p95 duration", value: ms(summary.p95_duration_ms), sub: "completed runs, last 30 days" },
      ],
    },
  ];
  return { exchanges: calls.exchanges, steps, cooked, caveats };
}

function flagList(f: { after_hours: boolean; weekend: boolean; concurrent_pr_overload: boolean; activity_cliff: boolean }): string {
  return [f.after_hours && "after-hours", f.weekend && "weekend", f.concurrent_pr_overload && "PR overload", f.activity_cliff && "activity cliff"].filter(Boolean).join(", ");
}

// ── Entry point ───────────────────────────────────────────────────────────────

const RECIPES: Record<MetricId, (ctx: RecipeContext) => Promise<RecipeResult>> = {
  "dora": doraRecipe,
  "pr-health": prHealthRecipe,
  "bus-factor": busFactorRecipe,
  "workload-ci": workloadCiRecipe,
};

export function runRecipe(metric: MetricId, ctx: RecipeContext): Promise<RecipeResult> {
  return RECIPES[metric](ctx);
}
