/**
 * Snapshot builders for the AI layer (v4.1.0).
 *
 * These are the privacy enforcement point. Everything sent to a model goes
 * through a builder here, and each builder constructs its result field by
 * field against an explicit interface — never by spreading a GitHub API
 * object. Anything absent from the type therefore cannot leak, even if an
 * upstream fetcher starts returning more.
 *
 * Allowed: aggregate numbers, repo/workflow/job/step names, logins, dates.
 * Never: tokens, run logs, file contents, workflow YAML, PR or commit
 * message bodies, email addresses.
 *
 * `tests/ai-snapshots.test.ts` walks the serialized output of every builder
 * and fails on a forbidden key, so this rule is checked mechanically rather
 * than by review.
 *
 * Builders reuse existing fetchers only — no new GitHub API surface.
 */

import { getRepoSummary, listWorkflowFileCommits, getOctokit } from "@/lib/github";
import type { TrendPoint } from "@/lib/github";
import { getRepoDoraSummary } from "@/lib/github-dora";
import { computeBusFactor } from "@/lib/bus-factor";
import { computeScorecard } from "@/lib/org-health-scorecard";
import type { DoraLevel } from "@/lib/dora";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InsightsDora {
  deployments_per_day: number;
  lead_time_p50_hours: number;
  change_failure_rate_pct: number;
  /** Null when no recovery events were observed in the window. */
  mttr_mean_hours: number | null;
  benchmark: DoraLevel;
}

export interface InsightsCi {
  total_runs: number;
  success_rate_pct: number;
  success_rate_prev_period_pct: number | null;
  runs_last_30d: number;
  failures_last_30d: number;
}

export interface InsightsBusFactor {
  overall: number;
  critical_modules: number;
  total_contributors: number;
}

export interface InsightsRiskBands {
  healthy: number;
  watch: number;
  at_risk: number;
  median_score: number;
}

export interface InsightsSnapshot {
  surface: "repo" | "org";
  /** "owner/repo" or the org login. */
  scope: string;
  period_days: number;
  dora: InsightsDora | null;
  ci: InsightsCi | null;
  bus_factor: InsightsBusFactor | null;
  /** Org surface only — distribution across the health scorecard's bands. */
  risk_bands: InsightsRiskBands | null;
  /** Org surface only — the worst-scoring repos, names and scores only. */
  worst_repos: { repo: string; score: number; band: string; dora_level: DoraLevel }[];
  /** Metadata only: when the workflow definitions changed, and by whom. */
  recent_workflow_changes: { date: string; author_login: string | null }[];
  /** True when any sub-fetch returned partial data — the model is told to hedge. */
  partial: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const msToHours = (ms: number): number => Math.round((ms / 3_600_000) * 10) / 10;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Map workflow-file commits down to date + author.
 *
 * The source WorkflowFileCommit carries `message`, `sha`, `html_url` and
 * `file_path`; none of those may reach a prompt. Commit messages in
 * particular are free text, which is exactly the injection vector this
 * layer avoids by construction.
 */
function toWorkflowChanges(
  commits: { date: string; author_login: string | null }[],
  limit: number,
): { date: string; author_login: string | null }[] {
  return commits.slice(0, limit).map((c) => ({
    date: c.date,
    author_login: c.author_login,
  }));
}

/**
 * Split the 30-day trend into halves so the model can see direction, not just
 * level. TrendPoint is {date, success, total} — failures are derived.
 */
function splitTrend(trend: TrendPoint[]): {
  total: number;
  failures: number;
  ratePct: number;
  prevRatePct: number | null;
} {
  const total = trend.reduce((s, d) => s + d.total, 0);
  const failures = trend.reduce((s, d) => s + (d.total - d.success), 0);
  const ratePct = total > 0 ? Math.round(((total - failures) / total) * 100) : 0;

  if (trend.length < 4) return { total, failures, ratePct, prevRatePct: null };

  const half = Math.floor(trend.length / 2);
  const prior = trend.slice(0, half);
  const priorTotal = prior.reduce((s, d) => s + d.total, 0);
  const priorSuccess = prior.reduce((s, d) => s + d.success, 0);
  const prevRatePct =
    priorTotal > 0 ? Math.round((priorSuccess / priorTotal) * 100) : null;

  return { total, failures, ratePct, prevRatePct };
}

// ── Repo surface ──────────────────────────────────────────────────────────────

async function buildRepoInsights(
  token: string,
  owner: string,
  repo: string,
): Promise<InsightsSnapshot> {
  const octokit = getOctokit(token);

  // Every sub-fetch is allowed to fail independently — a snapshot with a null
  // section is still useful, and the prompt tells the model to say so rather
  // than guess. A hard failure here would take out the whole card.
  const [summaryRes, doraRes, busRes, commitsRes] = await Promise.allSettled([
    getRepoSummary(token, owner, repo),
    getRepoDoraSummary(token, owner, repo),
    computeBusFactor(octokit, owner, repo),
    listWorkflowFileCommits(token, owner, repo, 10),
  ]);

  let partial = false;

  let ci: InsightsCi | null = null;
  if (summaryRes.status === "fulfilled") {
    const s = summaryRes.value;
    const t = splitTrend(s.trend_30d);
    ci = {
      total_runs: t.total,
      success_rate_pct: s.success_rate,
      success_rate_prev_period_pct: t.prevRatePct,
      runs_last_30d: t.total,
      failures_last_30d: t.failures,
    };
  } else {
    partial = true;
  }

  let dora: InsightsDora | null = null;
  if (doraRes.status === "fulfilled") {
    const d = doraRes.value;
    if (d.partial) partial = true;
    dora = {
      deployments_per_day: d.deployment_frequency.per_day,
      lead_time_p50_hours: msToHours(d.lead_time.median_ms),
      change_failure_rate_pct: d.change_failure_rate.rate,
      mttr_mean_hours: d.mttr.mean_ms === null ? null : msToHours(d.mttr.mean_ms),
      benchmark: d.deployment_frequency.level,
    };
  } else {
    partial = true;
  }

  let bus_factor: InsightsBusFactor | null = null;
  if (busRes.status === "fulfilled") {
    const b = busRes.value;
    if (b.partial) partial = true;
    bus_factor = {
      overall: b.overall_bus_factor,
      critical_modules: b.critical_modules,
      total_contributors: b.total_contributors,
    };
  } else {
    partial = true;
  }

  const recent_workflow_changes =
    commitsRes.status === "fulfilled" ? toWorkflowChanges(commitsRes.value, 10) : [];
  if (commitsRes.status === "rejected") partial = true;

  return {
    surface: "repo",
    scope: `${owner}/${repo}`,
    period_days: 30,
    dora,
    ci,
    bus_factor,
    risk_bands: null,
    worst_repos: [],
    recent_workflow_changes,
    partial,
  };
}

// ── Org surface ───────────────────────────────────────────────────────────────

async function buildOrgInsights(token: string, org: string): Promise<InsightsSnapshot> {
  const octokit = getOctokit(token);
  const scorecard = await computeScorecard(token, octokit, org, 10);

  const bands = { healthy: 0, watch: 0, at_risk: 0 };
  for (const r of scorecard.repos) bands[r.risk_band]++;

  const worst = [...scorecard.repos]
    .sort((a, b) => a.composite_score - b.composite_score)
    .slice(0, 5)
    .map((r) => ({
      repo: r.repo,
      score: r.composite_score,
      band: r.risk_band,
      dora_level: r.dora_level,
    }));

  const criticalModules = scorecard.repos.reduce((s, r) => s + r.critical_modules, 0);
  const worstBusFactor = scorecard.repos.length
    ? Math.min(...scorecard.repos.map((r) => r.overall_bus_factor))
    : 0;

  return {
    surface: "org",
    scope: org,
    period_days: 30,
    dora: null,
    ci: null,
    bus_factor: scorecard.repos.length
      ? { overall: worstBusFactor, critical_modules: criticalModules, total_contributors: 0 }
      : null,
    risk_bands: {
      ...bands,
      median_score: median(scorecard.repos.map((r) => r.composite_score)),
    },
    worst_repos: worst,
    recent_workflow_changes: [],
    partial: scorecard.repos_analysed < scorecard.repos_attempted,
  };
}

// ── Public entry point ────────────────────────────────────────────────────────

export type InsightsScope =
  | { surface: "repo"; owner: string; repo: string }
  | { surface: "org"; org: string };

export async function buildInsightsSnapshot(
  token: string,
  scope: InsightsScope,
): Promise<InsightsSnapshot> {
  return scope.surface === "repo"
    ? buildRepoInsights(token, scope.owner, scope.repo)
    : buildOrgInsights(token, scope.org);
}
