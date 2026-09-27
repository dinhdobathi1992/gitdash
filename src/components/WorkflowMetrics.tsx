"use client";

/**
 * Compact run-health widgets shared by the org overview and older tables.
 * Now thin wrappers over the design-system primitives (contract §5) so
 * every table draws runs, status and success the same way.
 */

import { cn } from "@/lib/utils";
import type { RepoSummary } from "@/lib/github";
import { RunStrip } from "@/components/ui/RunStrip";
import { StatusPill } from "@/components/ui/StatusPill";
import { Sparkline } from "@/components/ui/Sparkline";
import { SuccessBar } from "@/components/home/RepoTable";
import { repoHealth } from "@/lib/repo-health";

/** Last 10 runs as a run strip. */
export function RunHistoryBars({ runs }: { runs: RepoSummary["recent_runs"] }) {
  if (!runs.length) return <span className="text-xs text-muted">No runs</span>;
  return <RunStrip runs={runs} />;
}

/** 30-day daily success-rate sparkline. */
export function TrendSparkline({ points }: { points: RepoSummary["trend_30d"] }) {
  if (points.length < 2) return <span className="text-xs text-muted">Not enough runs</span>;
  const rates = points.map((p) => (p.total > 0 ? (p.success / p.total) * 100 : 0));
  const last = rates[rates.length - 1];
  const color = last >= 90 ? "var(--status-success)" : last >= 80 ? "var(--status-warning)" : "var(--status-failure)";
  return (
    <Sparkline
      values={rates}
      width={112}
      height={30}
      color={color}
      label={`Daily success rate over 30 days, latest ${Math.round(last)}%`}
    />
  );
}

/** Repo/workflow status pill (Passing, Failing, Running, Queued, No recent runs). */
export function StatusBadge({ summary }: { summary: RepoSummary | undefined }) {
  if (!summary) return <span className="inline-block h-6 w-20 rounded-full skeleton" />;
  const h = repoHealth(summary);
  return <StatusPill tone={h.tone} pulse={h.key === "running"}>{h.label}</StatusPill>;
}

/**
 * Composite health score:
 *   60% success rate (last 10 completed runs)
 *   40% recency stability (no failures in last 3 runs → bonus)
 */
export function computeHealthScore(summary: RepoSummary): number {
  const hasRuns = summary.recent_runs.some((r) => r.conclusion);
  if (!hasRuns) return 0;
  const successScore = summary.success_rate;
  const last3 = summary.recent_runs.filter((r) => r.conclusion).slice(0, 3);
  const recentSuccess = last3.filter((r) => r.conclusion === "success").length;
  const recentScore = last3.length > 0 ? (recentSuccess / last3.length) * 100 : 50;
  return Math.round(successScore * 0.6 + recentScore * 0.4);
}

/** Health score with a word — never colour alone. */
export function HealthScoreRing({ summary }: { summary: RepoSummary | undefined; size?: number }) {
  if (!summary || summary.recent_runs.every((r) => !r.conclusion)) return <span className="text-xs text-muted">—</span>;
  const score = computeHealthScore(summary);
  const word = score >= 80 ? "Good" : score >= 60 ? "Fair" : "Poor";
  const tone = score >= 80 ? "text-status-pass-text" : score >= 60 ? "text-status-warn-text" : "text-status-fail-text";
  return (
    <span className="inline-flex items-baseline gap-1.5" title={`Health score ${score} of 100`}>
      <span className={cn("font-mono text-sm font-semibold tabular-nums", tone)}>{score}</span>
      <span className="text-xs text-muted">{word}</span>
    </span>
  );
}

/** Success over the last 10 completed runs as figure + bar. */
export function HealthBadge({ summary }: { summary: RepoSummary | undefined }) {
  if (!summary || summary.recent_runs.every((r) => !r.conclusion)) return <span className="text-xs text-muted">—</span>;
  return <SuccessBar rate={summary.success_rate_30d ?? summary.success_rate} />;
}
