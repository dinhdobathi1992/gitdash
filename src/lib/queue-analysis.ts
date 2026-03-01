/**
 * Queue Wait Analysis — pure computation utilities.
 *
 * All functions are stateless and operate on arrays of WorkflowRun objects.
 * No network calls — designed for client-side use with data already fetched.
 */

import type { WorkflowRun } from "./github";

// ── Types ────────────────────────────────────────────────────────────────────

export interface QueueStats {
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  /** Runs where queue wait exceeded the threshold (default 5 min). */
  delayed: number;
  /** Total runs with measurable queue wait. */
  total: number;
  /** Percentage of runs that were delayed. */
  delayed_pct: number;
}

/** A single cell in the day-of-week × hour-of-day heatmap. */
export interface HeatmapCell {
  day: number;    // 0=Sun … 6=Sat
  hour: number;   // 0–23
  avg_ms: number;
  count: number;
}

export interface BranchQueueImpact {
  branch: string;
  runs: number;
  avg_ms: number;
  p95_ms: number;
  delayed: number;
  /** Estimated developer-minutes wasted = sum(queue_wait) for runs > threshold. */
  wasted_min: number;
}

export interface QueueDistBucket {
  label: string;
  count: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Default threshold for "delayed" classification: 5 minutes in ms. */
const DELAY_THRESHOLD_MS = 5 * 60 * 1000;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute aggregate queue-wait statistics.
 */
export function computeQueueStats(
  runs: WorkflowRun[],
  thresholdMs: number = DELAY_THRESHOLD_MS,
): QueueStats {
  const waits = runs
    .map((r) => r.queue_wait_ms)
    .filter((v): v is number => v !== undefined && v > 0);

  if (!waits.length) {
    return { avg_ms: 0, p50_ms: 0, p95_ms: 0, max_ms: 0, delayed: 0, total: 0, delayed_pct: 0 };
  }

  const sorted = [...waits].sort((a, b) => a - b);
  const delayed = waits.filter((w) => w > thresholdMs).length;

  return {
    avg_ms: Math.round(waits.reduce((a, b) => a + b, 0) / waits.length),
    p50_ms: Math.round(percentile(sorted, 0.5)),
    p95_ms: Math.round(percentile(sorted, 0.95)),
    max_ms: Math.round(sorted[sorted.length - 1]),
    delayed,
    total: waits.length,
    delayed_pct: Math.round((delayed / waits.length) * 1000) / 10,
  };
}

/**
 * Build a 7×24 heatmap of average queue wait by day-of-week and hour-of-day.
 * Times are in UTC (matching GitHub API timestamps).
 */
export function computeQueueHeatmap(runs: WorkflowRun[]): HeatmapCell[] {
  // Accumulator: [day][hour] = { sum, count }
  const grid: { sum: number; count: number }[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ sum: 0, count: 0 })),
  );

  for (const r of runs) {
    if (r.queue_wait_ms === undefined || r.queue_wait_ms <= 0) continue;
    const d = new Date(r.created_at);
    const day = d.getUTCDay();   // 0=Sun
    const hour = d.getUTCHours();
    grid[day][hour].sum += r.queue_wait_ms;
    grid[day][hour].count++;
  }

  const cells: HeatmapCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const { sum, count } = grid[day][hour];
      cells.push({
        day,
        hour,
        avg_ms: count > 0 ? Math.round(sum / count) : 0,
        count,
      });
    }
  }
  return cells;
}

/**
 * Top branches ranked by queue-wait impact.
 */
export function computeBranchQueueImpact(
  runs: WorkflowRun[],
  thresholdMs: number = DELAY_THRESHOLD_MS,
  limit: number = 10,
): BranchQueueImpact[] {
  const byBranch: Record<string, number[]> = {};

  for (const r of runs) {
    if (r.queue_wait_ms === undefined || r.queue_wait_ms <= 0) continue;
    const branch = r.head_branch ?? "unknown";
    (byBranch[branch] ??= []).push(r.queue_wait_ms);
  }

  return Object.entries(byBranch)
    .map(([branch, waits]) => {
      const sorted = [...waits].sort((a, b) => a - b);
      const delayed = waits.filter((w) => w > thresholdMs);
      return {
        branch,
        runs: waits.length,
        avg_ms: Math.round(waits.reduce((a, b) => a + b, 0) / waits.length),
        p95_ms: Math.round(percentile(sorted, 0.95)),
        delayed: delayed.length,
        wasted_min: Math.round(delayed.reduce((a, b) => a + b, 0) / 60000 * 10) / 10,
      };
    })
    .sort((a, b) => b.avg_ms * b.runs - a.avg_ms * a.runs)   // rank by total impact
    .slice(0, limit);
}

/**
 * Bucket queue waits into a histogram distribution.
 */
export function computeQueueDistribution(runs: WorkflowRun[]): QueueDistBucket[] {
  const buckets: { label: string; max: number }[] = [
    { label: "<10s",    max: 10_000 },
    { label: "10s–30s", max: 30_000 },
    { label: "30s–1m",  max: 60_000 },
    { label: "1m–2m",   max: 120_000 },
    { label: "2m–5m",   max: 300_000 },
    { label: "5m–10m",  max: 600_000 },
    { label: ">10m",    max: Infinity },
  ];

  const counts = buckets.map(() => 0);

  for (const r of runs) {
    if (r.queue_wait_ms === undefined || r.queue_wait_ms <= 0) continue;
    for (let i = 0; i < buckets.length; i++) {
      if (r.queue_wait_ms <= buckets[i].max) {
        counts[i]++;
        break;
      }
    }
  }

  return buckets.map((b, i) => ({ label: b.label, count: counts[i] }));
}

/**
 * Queue wait trend over time — one data point per run, ordered oldest→newest.
 * Used for an area/line chart overlay.
 */
export function computeQueueTrend(
  runs: WorkflowRun[],
): { run: string; queue_min: number; date: string }[] {
  return [...runs]
    .filter((r) => r.queue_wait_ms !== undefined)
    .reverse()
    .map((r) => ({
      run: `#${r.run_number}`,
      queue_min: Math.round((r.queue_wait_ms ?? 0) / 60000 * 100) / 100,
      date: new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    }));
}

/**
 * Estimate developer-time cost from queue waits.
 * @param devHourlyRate — average developer hourly rate in USD (default $75)
 */
export function estimateQueueCost(
  runs: WorkflowRun[],
  devHourlyRate: number = 75,
): { totalWaitHours: number; costUsd: number; perRunAvgMin: number } {
  const waits = runs
    .map((r) => r.queue_wait_ms)
    .filter((v): v is number => v !== undefined && v > 0);

  if (!waits.length) return { totalWaitHours: 0, costUsd: 0, perRunAvgMin: 0 };

  const totalMs = waits.reduce((a, b) => a + b, 0);
  const totalHours = totalMs / 3_600_000;

  return {
    totalWaitHours: Math.round(totalHours * 10) / 10,
    costUsd: Math.round(totalHours * devHourlyRate),
    perRunAvgMin: Math.round((totalMs / waits.length) / 60000 * 10) / 10,
  };
}
