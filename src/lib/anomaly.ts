/**
 * Anomaly Detection — lightweight statistical outlier detection.
 *
 * Uses a rolling baseline (mean ± 2×stddev) to flag runs whose duration
 * or queue wait is significantly outside the normal range.
 *
 * All functions are pure and stateless — designed for client-side use.
 */

import type { WorkflowRun } from "./github";

// ── Types ────────────────────────────────────────────────────────────────────

export type AnomalyMetric = "duration" | "queue_wait";

export interface AnomalyResult {
  runId: number;
  runNumber: number;
  metric: AnomalyMetric;
  value_ms: number;
  mean_ms: number;
  stddev_ms: number;
  /** How many standard deviations from the mean. Positive = above, negative = below. */
  zScore: number;
  /** Whether the value is anomalously high (> mean + threshold×stddev). */
  isHigh: boolean;
  /** Whether the value is anomalously low (< mean - threshold×stddev). Only for duration. */
  isLow: boolean;
}

export interface RunAnomalies {
  runId: number;
  runNumber: number;
  anomalies: AnomalyResult[];
  /** True if any anomaly is detected for this run. */
  hasAnomaly: boolean;
  /** Worst z-score (highest absolute value) across all metrics. */
  worstZ: number;
}

export interface BaselineStats {
  metric: AnomalyMetric;
  mean_ms: number;
  stddev_ms: number;
  upperBound_ms: number;
  lowerBound_ms: number;
  sampleSize: number;
}

// ── Configuration ────────────────────────────────────────────────────────────

/** Number of preceding runs used to compute the rolling baseline. */
const BASELINE_WINDOW = 20;

/** Z-score threshold for anomaly detection. 2 = ~95% confidence. */
const Z_THRESHOLD = 2;

/** Minimum runs needed before anomaly detection kicks in. */
const MIN_SAMPLES = 5;

// ── Helpers ──────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function stddev(arr: number[], avg: number): number {
  if (arr.length < 2) return 0;
  const variance = arr.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect anomalies across all runs for a given metric.
 *
 * For each run, the baseline is computed from the PRECEDING runs (not
 * including the run itself), so the detection is causal — it only uses
 * data available at the time the run completed.
 *
 * Runs are expected in newest-first order (as returned by the GitHub API).
 */
function detectForMetric(
  runs: WorkflowRun[],
  metric: AnomalyMetric,
  threshold: number = Z_THRESHOLD,
): AnomalyResult[] {
  const getValue = (r: WorkflowRun): number | undefined =>
    metric === "duration" ? r.duration_ms : r.queue_wait_ms;

  // Work oldest→newest so we can build up the baseline window.
  const chronological = [...runs].reverse();
  const results: AnomalyResult[] = [];

  for (let i = 0; i < chronological.length; i++) {
    const run = chronological[i];
    const value = getValue(run);
    if (value === undefined || value <= 0) continue;

    // Baseline: up to BASELINE_WINDOW preceding runs with valid values.
    const precedingValues: number[] = [];
    for (let j = i - 1; j >= 0 && precedingValues.length < BASELINE_WINDOW; j--) {
      const v = getValue(chronological[j]);
      if (v !== undefined && v > 0) precedingValues.push(v);
    }

    if (precedingValues.length < MIN_SAMPLES) continue;

    const m = mean(precedingValues);
    const sd = stddev(precedingValues, m);

    // Avoid false positives when stddev is near zero (all values identical).
    if (sd < 1) continue;

    const z = (value - m) / sd;
    const isHigh = z > threshold;
    const isLow = metric === "duration" ? z < -threshold : false; // queue_wait low is fine

    if (isHigh || isLow) {
      results.push({
        runId: run.id,
        runNumber: run.run_number,
        metric,
        value_ms: value,
        mean_ms: Math.round(m),
        stddev_ms: Math.round(sd),
        zScore: Math.round(z * 10) / 10,
        isHigh,
        isLow,
      });
    }
  }

  return results;
}

/**
 * Run anomaly detection for all metrics on the given runs.
 * Returns a map of runId → anomalies for easy lookup.
 */
export function detectAnomalies(
  runs: WorkflowRun[],
  threshold: number = Z_THRESHOLD,
): Map<number, RunAnomalies> {
  const durationAnomalies = detectForMetric(runs, "duration", threshold);
  const queueAnomalies = detectForMetric(runs, "queue_wait", threshold);

  const map = new Map<number, RunAnomalies>();

  const addResult = (r: AnomalyResult) => {
    let entry = map.get(r.runId);
    if (!entry) {
      entry = { runId: r.runId, runNumber: r.runNumber, anomalies: [], hasAnomaly: false, worstZ: 0 };
      map.set(r.runId, entry);
    }
    entry.anomalies.push(r);
    entry.hasAnomaly = true;
    if (Math.abs(r.zScore) > Math.abs(entry.worstZ)) {
      entry.worstZ = r.zScore;
    }
  };

  durationAnomalies.forEach(addResult);
  queueAnomalies.forEach(addResult);

  return map;
}

/**
 * Compute the current baseline stats for display (e.g. shaded normal range on charts).
 * Uses the most recent BASELINE_WINDOW runs with valid values.
 */
export function computeBaseline(
  runs: WorkflowRun[],
  metric: AnomalyMetric,
  threshold: number = Z_THRESHOLD,
): BaselineStats | null {
  const getValue = (r: WorkflowRun): number | undefined =>
    metric === "duration" ? r.duration_ms : r.queue_wait_ms;

  const values: number[] = [];
  for (const r of runs) {
    const v = getValue(r);
    if (v !== undefined && v > 0) {
      values.push(v);
      if (values.length >= BASELINE_WINDOW) break;
    }
  }

  if (values.length < MIN_SAMPLES) return null;

  const m = mean(values);
  const sd = stddev(values, m);

  return {
    metric,
    mean_ms: Math.round(m),
    stddev_ms: Math.round(sd),
    upperBound_ms: Math.round(m + threshold * sd),
    lowerBound_ms: Math.max(0, Math.round(m - threshold * sd)),
    sampleSize: values.length,
  };
}

/**
 * Format an anomaly result into a human-readable tooltip string.
 */
export function formatAnomalyTooltip(a: AnomalyResult): string {
  const metricLabel = a.metric === "duration" ? "Duration" : "Queue wait";
  const direction = a.isHigh ? "above" : "below";
  const absZ = Math.abs(a.zScore);
  return `${metricLabel}: ${absZ.toFixed(1)} stddev ${direction} mean (expected ~${fmtMs(a.mean_ms)}, got ${fmtMs(a.value_ms)})`;
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** Anomaly severity label for UI badge colouring. */
export function anomalySeverity(worstZ: number): "extreme" | "high" | "moderate" {
  const absZ = Math.abs(worstZ);
  if (absZ >= 4) return "extreme";
  if (absZ >= 3) return "high";
  return "moderate";
}

/** Tailwind styles for anomaly severity badges. */
export const ANOMALY_BADGE_STYLES: Record<"extreme" | "high" | "moderate", { bg: string; text: string; border: string }> = {
  extreme:  { bg: "bg-red-500/15",    text: "text-red-300",    border: "border-red-500/30" },
  high:     { bg: "bg-orange-500/15", text: "text-orange-300", border: "border-orange-500/30" },
  moderate: { bg: "bg-amber-500/15",  text: "text-amber-300",  border: "border-amber-500/30" },
};
