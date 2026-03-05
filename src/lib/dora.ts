/**
 * DORA Four Keys calculation utilities.
 *
 * The four DORA metrics measure software delivery performance:
 *   1. Deployment Frequency — how often code reaches production
 *   2. Lead Time for Changes — time from commit to production deploy
 *   3. Change Failure Rate — % of deployments causing failure
 *   4. Mean Time to Recovery (MTTR) — time to restore after failure
 *
 * These are computed from GitHub Actions workflow run data.
 * Since we can't know which workflows are "deploy" workflows,
 * we compute metrics for whatever workflow the user is viewing
 * and let them interpret results in context.
 *
 * Industry benchmarks (from DORA State of DevOps Report):
 *   Elite:  Deploy multiple times/day, LT <1hr, CFR <5%, MTTR <1hr
 *   High:   Deploy 1/day–1/week, LT 1day–1week, CFR 0-15%, MTTR <1day
 *   Medium: Deploy 1/week–1/month, LT 1week–1month, CFR 16-30%, MTTR <1week
 *   Low:    Deploy <1/month, LT >1month, CFR >30%, MTTR >1week
 */

import type { WorkflowRun } from "@/lib/github";

// ── Types ────────────────────────────────────────────────────────────────────

export type DoraLevel = "elite" | "high" | "medium" | "low";

export interface DoraMetrics {
  deployment_frequency: {
    /** Average deploys per day over the period. */
    per_day: number;
    /** Total completed runs in the period. */
    total: number;
    /** Period span in days. */
    period_days: number;
    /** DORA performance level. */
    level: DoraLevel;
    /** Human-readable label. */
    label: string;
  };
  lead_time: {
    /** Median lead time in milliseconds (commit authored → run completed). */
    median_ms: number;
    /** P95 lead time in milliseconds. */
    p95_ms: number;
    /** Number of data points used. */
    sample_size: number;
    /** DORA performance level. */
    level: DoraLevel;
    /** Human-readable label. */
    label: string;
  };
  change_failure_rate: {
    /** Failure rate as percentage (0-100). */
    rate: number;
    /** Number of failures. */
    failures: number;
    /** Total completed runs. */
    total: number;
    /** DORA performance level. */
    level: DoraLevel;
    /** Human-readable label. */
    label: string;
  };
  mttr: {
    /** Mean time to recovery in milliseconds. */
    mean_ms: number | null;
    /** Number of recovery events used. */
    recoveries: number;
    /** DORA performance level. */
    level: DoraLevel;
    /** Human-readable label. */
    label: string;
  };
  /** Overall DORA performance level (worst of the four). */
  overall_level: DoraLevel;
}

// ── Benchmarks ───────────────────────────────────────────────────────────────

const LEVEL_ORDER: DoraLevel[] = ["elite", "high", "medium", "low"];

function worstLevel(...levels: DoraLevel[]): DoraLevel {
  let worst = 0;
  for (const l of levels) {
    const idx = LEVEL_ORDER.indexOf(l);
    if (idx > worst) worst = idx;
  }
  return LEVEL_ORDER[worst];
}

function deployFreqLevel(perDay: number): DoraLevel {
  if (perDay >= 1) return "elite";      // multiple times per day or daily
  if (perDay >= 1 / 7) return "high";   // at least weekly
  if (perDay >= 1 / 30) return "medium"; // at least monthly
  return "low";
}

function deployFreqLabel(perDay: number): string {
  if (perDay >= 2) return `${perDay.toFixed(1)}/day`;
  if (perDay >= 1) return `${perDay.toFixed(1)}/day`;
  if (perDay >= 1 / 7) {
    const perWeek = perDay * 7;
    return `${perWeek.toFixed(1)}/week`;
  }
  const perMonth = perDay * 30;
  return `${perMonth.toFixed(1)}/month`;
}

function leadTimeLevel(medianMs: number): DoraLevel {
  const hours = medianMs / 3_600_000;
  if (hours < 1) return "elite";
  if (hours < 24) return "high";
  if (hours < 24 * 7) return "medium";
  return "low";
}

function leadTimeLabel(medianMs: number): string {
  const hours = medianMs / 3_600_000;
  if (hours < 1) return `${Math.round(medianMs / 60_000)} min`;
  if (hours < 24) return `${hours.toFixed(1)} hours`;
  const days = hours / 24;
  return `${days.toFixed(1)} days`;
}

function cfrLevel(rate: number): DoraLevel {
  if (rate <= 5) return "elite";
  if (rate <= 15) return "high";
  if (rate <= 30) return "medium";
  return "low";
}

function cfrLabel(rate: number): string {
  return `${rate.toFixed(1)}%`;
}

function mttrLevel(meanMs: number | null): DoraLevel {
  if (meanMs === null) return "high"; // No failures = good
  const hours = meanMs / 3_600_000;
  if (hours < 1) return "elite";
  if (hours < 24) return "high";
  if (hours < 24 * 7) return "medium";
  return "low";
}

function mttrLabel(meanMs: number | null): string {
  if (meanMs === null) return "No failures";
  const hours = meanMs / 3_600_000;
  if (hours < 1) return `${Math.round(meanMs / 60_000)} min`;
  if (hours < 24) return `${hours.toFixed(1)} hours`;
  const days = hours / 24;
  return `${days.toFixed(1)} days`;
}

// ── Math helpers ─────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ── Main calculation ─────────────────────────────────────────────────────────

/**
 * Calculate DORA four keys from workflow run data.
 *
 * All four metrics are computed from the same runs array.
 * No additional API calls needed.
 */
export function calculateDoraMetrics(runs: WorkflowRun[]): DoraMetrics {
  const completed = runs.filter((r) => r.status === "completed");
  const sorted = [...completed].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // ── 1. Deployment Frequency ────────────────────────────────────────────
  let periodDays = 1;
  if (sorted.length >= 2) {
    const first = new Date(sorted[0].created_at).getTime();
    const last = new Date(sorted[sorted.length - 1].created_at).getTime();
    periodDays = Math.max(1, (last - first) / 86_400_000);
  }
  const perDay = sorted.length / periodDays;
  const dfLevel = deployFreqLevel(perDay);

  // ── 2. Lead Time for Changes ───────────────────────────────────────────
  // Approximation: time from commit author date to run completion.
  // This measures "how long from code being written to CI finishing".
  const leadTimes: number[] = [];
  for (const run of completed) {
    if (!run.head_commit?.author) continue;
    // run_started_at → when the run actually started executing
    // For lead time, we want commit → completion
    const commitTs = new Date(run.created_at).getTime(); // created_at is when the run was triggered
    const runStarted = run.run_started_at
      ? new Date(run.run_started_at).getTime()
      : commitTs;
    const durationMs = run.duration_ms ?? 0;
    const completedAt = runStarted + durationMs;
    // Lead time = queue wait + execution time
    const leadTime = completedAt - commitTs;
    if (leadTime > 0) leadTimes.push(leadTime);
  }
  const sortedLeadTimes = [...leadTimes].sort((a, b) => a - b);
  const medianLT = percentile(sortedLeadTimes, 0.5);
  const p95LT = percentile(sortedLeadTimes, 0.95);
  const ltLevel = leadTimeLevel(medianLT);

  // ── 3. Change Failure Rate ─────────────────────────────────────────────
  const failures = completed.filter((r) => r.conclusion === "failure").length;
  const cfr = completed.length > 0 ? (failures / completed.length) * 100 : 0;
  const cfrLvl = cfrLevel(cfr);

  // ── 4. Mean Time to Recovery ───────────────────────────────────────────
  // Time between first failure and next success on the same branch.
  const byBranch: Record<string, WorkflowRun[]> = {};
  for (const r of sorted) {
    const b = r.head_branch ?? "unknown";
    (byBranch[b] ??= []).push(r);
  }

  const recoveryTimes: number[] = [];
  for (const branchRuns of Object.values(byBranch)) {
    let failAt: number | null = null;
    for (const r of branchRuns) {
      if (r.conclusion === "failure" && failAt === null) {
        failAt = new Date(r.created_at).getTime();
      }
      if (r.conclusion === "success" && failAt !== null) {
        recoveryTimes.push(new Date(r.created_at).getTime() - failAt);
        failAt = null;
      }
    }
  }

  const meanMttr =
    recoveryTimes.length > 0
      ? Math.round(
          recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length
        )
      : null;
  const mttrLvl = mttrLevel(meanMttr);

  // ── Overall level ──────────────────────────────────────────────────────
  const overall = worstLevel(dfLevel, ltLevel, cfrLvl, mttrLvl);

  return {
    deployment_frequency: {
      per_day: Math.round(perDay * 100) / 100,
      total: sorted.length,
      period_days: Math.round(periodDays),
      level: dfLevel,
      label: deployFreqLabel(perDay),
    },
    lead_time: {
      median_ms: medianLT,
      p95_ms: p95LT,
      sample_size: sortedLeadTimes.length,
      level: ltLevel,
      label: leadTimeLabel(medianLT),
    },
    change_failure_rate: {
      rate: Math.round(cfr * 10) / 10,
      failures,
      total: completed.length,
      level: cfrLvl,
      label: cfrLabel(cfr),
    },
    mttr: {
      mean_ms: meanMttr,
      recoveries: recoveryTimes.length,
      level: mttrLvl,
      label: mttrLabel(meanMttr),
    },
    overall_level: overall,
  };
}

// ── Level display helpers ────────────────────────────────────────────────────

export const LEVEL_COLORS: Record<DoraLevel, { text: string; bg: string; border: string }> = {
  elite: { text: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
  high: { text: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  medium: { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  low: { text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
};

export const LEVEL_LABELS: Record<DoraLevel, string> = {
  elite: "Elite",
  high: "High",
  medium: "Medium",
  low: "Low",
};

// ── PR-based DORA input types ─────────────────────────────────────────────────

/** Minimal PR shape needed for DORA calculation — sourced from GitHub pulls.list */
export interface PrInput {
  number: number;
  title: string;
  created_at: string;
  merged_at: string;
  head_ref: string;
}

/** Per-PR detail fetched in a separate batch (commits + reviews + size) */
export interface PrDetailInput {
  number: number;
  first_commit_at: string | null;
  first_review_at: string | null;
  approved_at: string | null;
  additions: number;
  deletions: number;
}

export interface ReleaseInput {
  published_at: string;
}

// ── PR-based DORA output types ────────────────────────────────────────────────

export interface RepoCycleBreakdown {
  /** First commit on PR → PR created_at */
  avg_time_to_open_ms: number;
  /** PR created_at → first review submitted */
  avg_pickup_ms: number;
  /** First review → approval */
  avg_review_ms: number;
  /** Approval (or first review) → merged */
  avg_merge_ms: number;
  sample_size: number;
}

export interface PrScatterPoint {
  number: number;
  title: string;
  /** additions + deletions */
  loc: number;
  hours_to_merge: number;
  merged_at: string;
}

export interface ThroughputWeek {
  /** ISO date string for Monday of that week */
  week_start: string;
  count: number;
}

export interface RepoDoraSummary extends DoraMetrics {
  cycle_breakdown: RepoCycleBreakdown;
  pr_scatter: PrScatterPoint[];
  throughput_by_week: ThroughputWeek[];
  /** How many merged PRs were included in this analysis window */
  prs_analysed: number;
  /** How many GitHub releases were found (0 = fell back to PR merges) */
  releases_analysed: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function avgMs(arr: number[]): number {
  return arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;
}

// ── PR-based DORA calculation ─────────────────────────────────────────────────

/**
 * Calculate all four DORA metrics plus drill-down data from merged PR history.
 *
 * Deployment frequency: prefers GitHub Releases; falls back to merged PRs.
 * Lead time: first commit (or PR created_at) → merged_at.
 * CFR: hotfix / revert PRs as a fraction of total merged PRs.
 * MTTR: created_at → merged_at of each hotfix/revert PR.
 */
export function calculateRepoDora(
  mergedPrs: PrInput[],
  releases: ReleaseInput[],
  detailMap: Map<number, PrDetailInput>,
): RepoDoraSummary {
  const sortedPrs = [...mergedPrs].sort(
    (a, b) => new Date(a.merged_at).getTime() - new Date(b.merged_at).getTime(),
  );

  // ── 1. Deployment Frequency ──────────────────────────────────────────────
  const deployTs =
    releases.length > 0
      ? releases.map(r => new Date(r.published_at).getTime()).sort((a, b) => a - b)
      : sortedPrs.map(pr => new Date(pr.merged_at).getTime());

  let periodDays = 30;
  if (deployTs.length >= 2) {
    periodDays = Math.max(1, (deployTs[deployTs.length - 1] - deployTs[0]) / 86_400_000);
  }
  const perDay = deployTs.length / periodDays;
  const dfLevel = deployFreqLevel(perDay);

  // ── 2. Lead Time ─────────────────────────────────────────────────────────
  const leadTimes: number[] = [];
  for (const pr of mergedPrs) {
    const detail = detailMap.get(pr.number);
    const startTs = detail?.first_commit_at
      ? new Date(detail.first_commit_at).getTime()
      : new Date(pr.created_at).getTime();
    const lt = new Date(pr.merged_at).getTime() - startTs;
    if (lt > 0) leadTimes.push(lt);
  }
  const sortedLT = [...leadTimes].sort((a, b) => a - b);
  const medianLT = percentile(sortedLT, 0.5);
  const p95LT = percentile(sortedLT, 0.95);
  const ltLevel = leadTimeLevel(medianLT);

  // ── 3. Change Failure Rate ────────────────────────────────────────────────
  const isFailurePr = (pr: PrInput) =>
    /hotfix|revert|fix-prod|emergency/i.test(pr.head_ref) ||
    pr.title.toLowerCase().startsWith("revert ");
  const failurePrs = mergedPrs.filter(isFailurePr);
  const cfr = mergedPrs.length > 0 ? (failurePrs.length / mergedPrs.length) * 100 : 0;
  const cfrLvl = cfrLevel(cfr);

  // ── 4. MTTR ───────────────────────────────────────────────────────────────
  // Proxy: time from hotfix/revert PR created to merged (how quickly the fix landed)
  const recoveryTimes = failurePrs
    .map(pr => new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime())
    .filter(t => t > 0);
  const meanMttr =
    recoveryTimes.length > 0
      ? Math.round(recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length)
      : null;
  const mttrLvl = mttrLevel(meanMttr);

  // ── 5. Cycle Breakdown ────────────────────────────────────────────────────
  const phases = mergedPrs
    .map(pr => {
      const d = detailMap.get(pr.number);
      if (!d) return null;
      const created = new Date(pr.created_at).getTime();
      const merged = new Date(pr.merged_at).getTime();
      const firstCommit = d.first_commit_at ? new Date(d.first_commit_at).getTime() : created;
      const firstReview = d.first_review_at ? new Date(d.first_review_at).getTime() : null;
      const approved = d.approved_at ? new Date(d.approved_at).getTime() : null;
      const mergeFrom = approved ?? firstReview ?? created;
      return {
        time_to_open: Math.max(0, created - firstCommit),
        pickup: firstReview ? Math.max(0, firstReview - created) : 0,
        review: firstReview && approved ? Math.max(0, approved - firstReview) : 0,
        merge: Math.max(0, merged - mergeFrom),
      };
    })
    .filter(Boolean) as { time_to_open: number; pickup: number; review: number; merge: number }[];

  const cycle_breakdown: RepoCycleBreakdown = {
    avg_time_to_open_ms: avgMs(phases.map(p => p.time_to_open)),
    avg_pickup_ms: avgMs(phases.map(p => p.pickup)),
    avg_review_ms: avgMs(phases.map(p => p.review)),
    avg_merge_ms: avgMs(phases.map(p => p.merge)),
    sample_size: phases.length,
  };

  // ── 6. PR Scatter ─────────────────────────────────────────────────────────
  const pr_scatter: PrScatterPoint[] = mergedPrs
    .map(pr => {
      const detail = detailMap.get(pr.number);
      if (!detail) return null;
      const loc = detail.additions + detail.deletions;
      const hours =
        (new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime()) / 3_600_000;
      if (loc <= 0 || hours <= 0) return null;
      return {
        number: pr.number,
        title: pr.title,
        loc,
        hours_to_merge: Math.round(hours * 10) / 10,
        merged_at: pr.merged_at,
      };
    })
    .filter(Boolean) as PrScatterPoint[];

  // ── 7. Throughput by week (last 12 weeks) ─────────────────────────────────
  const weekMap: Record<string, number> = {};
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i * 7);
    weekMap[getWeekStart(d)] = 0;
  }
  for (const pr of mergedPrs) {
    const w = getWeekStart(new Date(pr.merged_at));
    if (w in weekMap) weekMap[w] = (weekMap[w] ?? 0) + 1;
  }
  const throughput_by_week: ThroughputWeek[] = Object.entries(weekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week_start, count]) => ({ week_start, count }));

  const overall = worstLevel(dfLevel, ltLevel, cfrLvl, mttrLvl);

  return {
    deployment_frequency: {
      per_day: Math.round(perDay * 100) / 100,
      total: deployTs.length,
      period_days: Math.round(periodDays),
      level: dfLevel,
      label: deployFreqLabel(perDay),
    },
    lead_time: {
      median_ms: medianLT,
      p95_ms: p95LT,
      sample_size: sortedLT.length,
      level: ltLevel,
      label: leadTimeLabel(medianLT),
    },
    change_failure_rate: {
      rate: Math.round(cfr * 10) / 10,
      failures: failurePrs.length,
      total: mergedPrs.length,
      level: cfrLvl,
      label: cfrLabel(cfr),
    },
    mttr: {
      mean_ms: meanMttr,
      recoveries: recoveryTimes.length,
      level: mttrLvl,
      label: mttrLabel(meanMttr),
    },
    overall_level: overall,
    cycle_breakdown,
    pr_scatter,
    throughput_by_week,
    prs_analysed: mergedPrs.length,
    releases_analysed: releases.length,
  };
}

/** Benchmark descriptions for each metric and level. */
export const BENCHMARKS = {
  deployment_frequency: {
    elite: "Multiple deploys per day",
    high: "Between once per day and once per week",
    medium: "Between once per week and once per month",
    low: "Less than once per month",
  },
  lead_time: {
    elite: "Less than one hour",
    high: "Between one day and one week",
    medium: "Between one week and one month",
    low: "More than one month",
  },
  change_failure_rate: {
    elite: "0-5%",
    high: "0-15%",
    medium: "16-30%",
    low: "More than 30%",
  },
  mttr: {
    elite: "Less than one hour",
    high: "Less than one day",
    medium: "Less than one week",
    low: "More than one week",
  },
} as const;
