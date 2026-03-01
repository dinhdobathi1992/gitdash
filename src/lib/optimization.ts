/**
 * Workflow Optimization Recommendations — rule-based analysis engine.
 *
 * Analyses WorkflowRun[] data and produces actionable suggestions.
 * All rules are stateless, pure functions. No network calls.
 */

import type { WorkflowRun } from "./github";

// ── Types ────────────────────────────────────────────────────────────────────

export type TipSeverity = "info" | "warning" | "critical";
export type TipCategory = "cost" | "performance" | "reliability" | "security";

export interface OptimizationTip {
  /** Stable identifier for dismissal persistence (e.g. "high-queue-wait"). */
  id: string;
  title: string;
  description: string;
  severity: TipSeverity;
  category: TipCategory;
  /** Estimated monthly savings or impact (human-readable). */
  impact?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function fmtMin(ms: number): string {
  const m = Math.round(ms / 60000 * 10) / 10;
  return m >= 60 ? `${Math.round(m / 60 * 10) / 10}h` : `${m}m`;
}

// ── Rule Engine ──────────────────────────────────────────────────────────────

type Rule = (runs: WorkflowRun[], completed: WorkflowRun[]) => OptimizationTip | null;

const rules: Rule[] = [
  // 1. High average queue wait
  (runs) => {
    const waits = runs
      .map((r) => r.queue_wait_ms)
      .filter((v): v is number => v !== undefined && v > 0);
    if (waits.length < 5) return null;
    const avgWait = avg(waits);
    if (avgWait < 120_000) return null; // < 2 min is fine
    return {
      id: "high-queue-wait",
      title: "High average queue wait",
      description: `Runs wait an average of ${fmtMin(avgWait)} for a runner. Consider adding self-hosted runners or scheduling non-urgent workflows during off-peak hours.`,
      severity: avgWait > 300_000 ? "critical" : "warning",
      category: "performance",
      impact: `~${fmtMin(avgWait)} wasted per run`,
    };
  },

  // 2. P95 queue wait SLA breach (>5 min)
  (runs) => {
    const waits = runs
      .map((r) => r.queue_wait_ms)
      .filter((v): v is number => v !== undefined && v > 0);
    if (waits.length < 5) return null;
    const p95 = percentile(waits, 0.95);
    if (p95 <= 300_000) return null;
    return {
      id: "queue-sla-breach",
      title: "Queue wait SLA breach (p95 > 5 min)",
      description: `The p95 queue wait is ${fmtMin(p95)}. 1 in 20 runs waits longer than this. This directly impacts developer feedback loops.`,
      severity: "critical",
      category: "performance",
      impact: "Slow CI feedback for 5%+ of runs",
    };
  },

  // 3. Low success rate
  (_runs, completed) => {
    if (completed.length < 10) return null;
    const successRate =
      completed.filter((r) => r.conclusion === "success").length / completed.length;
    if (successRate >= 0.8) return null;
    const pct = Math.round(successRate * 100);
    return {
      id: "low-success-rate",
      title: `Low success rate (${pct}%)`,
      description: `Only ${pct}% of runs succeed. Investigate the most common failure causes — flaky tests, dependency issues, or environment problems.`,
      severity: pct < 50 ? "critical" : "warning",
      category: "reliability",
    };
  },

  // 4. High re-run rate (flakiness indicator)
  (runs) => {
    if (runs.length < 10) return null;
    const rerunCount = runs.filter((r) => (r.run_attempt ?? 1) > 1).length;
    const rerunRate = rerunCount / runs.length;
    if (rerunRate < 0.1) return null;
    return {
      id: "high-rerun-rate",
      title: `High re-run rate (${Math.round(rerunRate * 100)}%)`,
      description: `${rerunCount} of ${runs.length} runs were re-triggered (attempt > 1). This often indicates flaky tests or transient infrastructure issues. Investigate and fix root causes to save CI minutes.`,
      severity: rerunRate > 0.25 ? "critical" : "warning",
      category: "reliability",
      impact: `~${rerunCount} unnecessary re-runs`,
    };
  },

  // 5. Duration increasing trend
  (runs) => {
    const withDuration = runs
      .filter((r) => r.duration_ms !== undefined && r.duration_ms > 0)
      .slice(0, 50); // most recent 50
    if (withDuration.length < 10) return null;
    const half = Math.floor(withDuration.length / 2);
    // runs are sorted newest-first
    const recentAvg = avg(withDuration.slice(0, half).map((r) => r.duration_ms!));
    const olderAvg = avg(withDuration.slice(half).map((r) => r.duration_ms!));
    if (olderAvg === 0) return null;
    const increase = (recentAvg - olderAvg) / olderAvg;
    if (increase < 0.2) return null; // < 20% increase is normal variation
    return {
      id: "duration-increasing",
      title: `Duration increasing (+${Math.round(increase * 100)}%)`,
      description: `Recent runs average ${fmtMin(recentAvg)} vs ${fmtMin(olderAvg)} for older runs — a ${Math.round(increase * 100)}% increase. Check for new dependencies, larger test suites, or missing caches.`,
      severity: increase > 0.5 ? "critical" : "warning",
      category: "performance",
      impact: `+${fmtMin(recentAvg - olderAvg)} per run`,
    };
  },

  // 6. High cancellation rate
  (_runs, completed) => {
    if (completed.length < 10) return null;
    const cancelled = completed.filter((r) => r.conclusion === "cancelled").length;
    const rate = cancelled / completed.length;
    if (rate < 0.15) return null;
    return {
      id: "high-cancel-rate",
      title: `High cancellation rate (${Math.round(rate * 100)}%)`,
      description: `${cancelled} of ${completed.length} runs were cancelled. If these are superseded pushes, consider enabling concurrency groups with \`cancel-in-progress: true\` to save CI minutes.`,
      severity: "info",
      category: "cost",
      impact: `${cancelled} cancelled runs consuming resources`,
    };
  },

  // 7. Long average duration
  (runs) => {
    const durations = runs
      .map((r) => r.duration_ms)
      .filter((v): v is number => v !== undefined && v > 0);
    if (durations.length < 5) return null;
    const avgDur = avg(durations);
    if (avgDur < 600_000) return null; // < 10 min is fine
    return {
      id: "long-duration",
      title: `Long average duration (${fmtMin(avgDur)})`,
      description: `Runs take ${fmtMin(avgDur)} on average. Consider splitting into parallel jobs, caching dependencies, or using larger runners for faster execution.`,
      severity: avgDur > 1_800_000 ? "warning" : "info", // > 30min
      category: "performance",
      impact: avgDur > 1_200_000 ? "Significant CI queue time" : undefined,
    };
  },

  // 8. Mostly off-hours runs (cost optimization)
  (runs) => {
    if (runs.length < 20) return null;
    const weekendRuns = runs.filter((r) => {
      const d = new Date(r.created_at).getUTCDay();
      return d === 0 || d === 6;
    }).length;
    const weekendRate = weekendRuns / runs.length;
    if (weekendRate < 0.2) return null;
    return {
      id: "weekend-runs",
      title: `${Math.round(weekendRate * 100)}% of runs on weekends`,
      description: `${weekendRuns} of ${runs.length} runs triggered on weekends. If these are scheduled/cron workflows, consider reducing frequency or moving to weekday-only schedules to save CI minutes.`,
      severity: "info",
      category: "cost",
      impact: `${weekendRuns} weekend runs`,
    };
  },

  // 9. Active failure streak
  (runs) => {
    let streak = 0;
    for (const r of runs) {
      if (r.conclusion === "failure") streak++;
      else if (r.status === "completed") break;
    }
    if (streak < 3) return null;
    return {
      id: "failure-streak",
      title: `${streak} consecutive failures`,
      description: `The last ${streak} completed runs all failed. This workflow may be broken — investigate immediately to unblock deployments.`,
      severity: streak >= 5 ? "critical" : "warning",
      category: "reliability",
    };
  },

  // 10. Timed-out runs
  (_runs, completed) => {
    if (completed.length < 5) return null;
    const timedOut = completed.filter((r) => r.conclusion === "timed_out").length;
    if (timedOut < 2) return null;
    const rate = timedOut / completed.length;
    return {
      id: "timed-out-runs",
      title: `${timedOut} timed-out runs (${Math.round(rate * 100)}%)`,
      description: `${timedOut} runs hit the timeout limit. Review \`timeout-minutes\` settings — either increase them or investigate why runs take so long (hung processes, network issues).`,
      severity: rate > 0.1 ? "critical" : "warning",
      category: "reliability",
    };
  },
];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run all optimisation rules against the given runs and return applicable tips.
 * Tips are sorted by severity (critical → warning → info).
 */
export function analyzeWorkflow(
  runs: WorkflowRun[],
): OptimizationTip[] {
  const completed = runs.filter((r) => r.status === "completed");

  const tips = rules
    .map((rule) => rule(runs, completed))
    .filter((tip): tip is OptimizationTip => tip !== null);

  const severityOrder: Record<TipSeverity, number> = { critical: 0, warning: 1, info: 2 };
  tips.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return tips;
}

/** Severity → tailwind colour mappings. */
export const SEVERITY_STYLES: Record<TipSeverity, { bg: string; border: string; text: string; icon: string }> = {
  critical: { bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-300", icon: "text-red-400" },
  warning:  { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-300", icon: "text-amber-400" },
  info:     { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-300", icon: "text-blue-400" },
};

export const CATEGORY_LABELS: Record<TipCategory, string> = {
  cost: "Cost",
  performance: "Performance",
  reliability: "Reliability",
  security: "Security",
};
