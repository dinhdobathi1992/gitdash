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

import {
  getRepoSummary,
  listWorkflowFileCommits,
  listWorkflowRuns,
  getOctokit,
} from "@/lib/github";
import type { TrendPoint, WorkflowRun } from "@/lib/github";
import { getRepoDoraSummary } from "@/lib/github-dora";
import { computeBusFactor } from "@/lib/bus-factor";
import { computeScorecard } from "@/lib/org-health-scorecard";
import { detectAnomalies, computeBaseline, type AnomalyMetric } from "@/lib/anomaly";
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

// ── Anomaly explanation (v4.1.1) ──────────────────────────────────────────────

export interface AnomalyOutlier {
  run_number: number;
  date: string;
  value_ms: number;
  z_score: number;
  trigger: string;
  actor_login: string | null;
}

export interface AnomalySnapshot {
  workflow_name: string;
  repo: string;
  metric: AnomalyMetric;
  baseline: { mean_ms: number; stddev_ms: number; sample_size: number } | null;
  /** Most recent first, capped at 5. */
  outliers: AnomalyOutlier[];
  concurrent_signals: {
    workflow_file_changes: { date: string; author_login: string | null }[];
    /** Event name → count across the analysed window. */
    trigger_mix: Record<string, number>;
  };
  total_runs_analysed: number;
}

/** Duration is wall-clock; queue wait is created_at → run_started_at. */
function runMetricValue(run: WorkflowRun, metric: AnomalyMetric): number | null {
  if (metric === "duration") {
    if (!run.run_started_at || !run.updated_at) return null;
    return new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime();
  }
  if (!run.run_started_at || !run.created_at) return null;
  return new Date(run.run_started_at).getTime() - new Date(run.created_at).getTime();
}

/**
 * Build the context for explaining one metric's outliers.
 *
 * Note this re-fetches runs and re-runs detection server-side even though the
 * client already computed the same anomalies. That is deliberate: prompts are
 * assembled server-side from typed snapshots only, so the client cannot hand
 * us numbers to feed a model. The cost is one listWorkflowRuns call plus one
 * listWorkflowFileCommits call per cache miss.
 */
export async function buildAnomalySnapshot(
  token: string,
  params: { owner: string; repo: string; workflowId: number; metric: AnomalyMetric },
): Promise<AnomalySnapshot> {
  const { owner, repo, workflowId, metric } = params;

  const [runsRes, commitsRes] = await Promise.allSettled([
    listWorkflowRuns(token, owner, repo, workflowId, 50),
    listWorkflowFileCommits(token, owner, repo, 10),
  ]);

  const runs: WorkflowRun[] = runsRes.status === "fulfilled" ? runsRes.value : [];
  const completed = runs.filter((r) => r.status === "completed");

  const inputs = completed.map((r) => ({
    id: r.id,
    run_number: r.run_number,
    duration_ms: runMetricValue(r, "duration"),
    queue_wait_ms: runMetricValue(r, "queue_wait"),
  }));

  const anomalyMap = detectAnomalies(inputs);
  const baseline = computeBaseline(inputs, metric);
  const byId = new Map(completed.map((r) => [r.id, r]));

  const outliers: AnomalyOutlier[] = [];
  for (const entry of anomalyMap.values()) {
    for (const a of entry.anomalies) {
      if (a.metric !== metric) continue;
      const run = byId.get(a.runId);
      if (!run) continue;
      outliers.push({
        run_number: a.runNumber,
        date: run.created_at,
        value_ms: a.value_ms,
        z_score: Math.round(a.zScore * 10) / 10,
        trigger: run.event,
        actor_login: run.triggering_actor?.login ?? run.actor?.login ?? null,
      });
    }
  }
  // Most recent first, then cap — a leader cares about what just happened.
  outliers.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const trigger_mix: Record<string, number> = {};
  for (const r of completed) trigger_mix[r.event] = (trigger_mix[r.event] ?? 0) + 1;

  return {
    workflow_name: completed[0]?.name ?? runs[0]?.name ?? "workflow",
    repo: `${owner}/${repo}`,
    metric,
    baseline: baseline
      ? {
          mean_ms: Math.round(baseline.mean_ms),
          stddev_ms: Math.round(baseline.stddev_ms),
          sample_size: baseline.sampleSize,
        }
      : null,
    outliers: outliers.slice(0, 5),
    concurrent_signals: {
      workflow_file_changes:
        commitsRes.status === "fulfilled" ? toWorkflowChanges(commitsRes.value, 10) : [],
      trigger_mix,
    },
    total_runs_analysed: completed.length,
  };
}
