/**
 * Fleet-level figures for the repositories page, computed from per-repo
 * summaries (each holds the repo's 30 most recent runs). Pure and testable.
 */

import type { Repo, RepoSummary, RepoRunPoint } from "@/lib/github";
import { percentile } from "@/lib/utils";
import { repoHealth } from "@/lib/repo-health";

export type Range = "24h" | "7d" | "30d" | "90d";
export const RANGE_MS: Record<Range, number> = {
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};
export const RANGE_LABEL: Record<Range, string> = { "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days" };

export interface WindowStats {
  runs: number;
  completed: number;
  successRate: number | null;
  p95DurationMs: number | null;
  p95QueueMs: number | null;
}

function stats(runs: RepoRunPoint[]): WindowStats {
  const completed = runs.filter((r) => r.status === "completed" && r.conclusion !== "skipped" && r.conclusion !== "cancelled");
  const pass = completed.filter((r) => r.conclusion === "success").length;
  const durations = completed.map((r) => r.duration_ms).filter((d): d is number => typeof d === "number");
  const queues = runs.map((r) => r.queue_ms).filter((d): d is number => typeof d === "number");
  return {
    runs: runs.length,
    completed: completed.length,
    successRate: completed.length ? (pass / completed.length) * 100 : null,
    p95DurationMs: percentile(durations, 95),
    p95QueueMs: percentile(queues, 95),
  };
}

/** Runs per repo summary (listWorkflowRunsForRepo per_page in getRepoSummary). */
export const SUMMARY_RUNS = 30;

export interface FleetKpis {
  current: WindowStats;
  /**
   * The equal-length window before `current`. null when no run falls in it,
   * or when any repo's 30 fetched runs stop short of that window — comparing
   * against a truncated window would report nonsense like "+1182%".
   */
  previous: WindowStats | null;
  /** Why `previous` is null. */
  previousGap: "none" | "truncated" | null;
  /** Daily buckets across the current window, oldest first — for sparklines. */
  daily: { runs: number[]; successRate: number[]; p95Duration: number[]; p95Queue: number[] };
  repoCount: number;
}

/**
 * Aggregate runs across repos for `range`. A summary only holds a repo's 30
 * most recent runs, so busy repos under-count long ranges — callers say so.
 */
export function fleetKpis(summaries: RepoSummary[], range: Range, now: number): FleetKpis {
  const span = RANGE_MS[range];
  const all = summaries.flatMap((s) => s.window_runs ?? s.recent_runs ?? []);
  const t = (r: RepoRunPoint) => new Date(r.created_at).getTime();
  const cur = all.filter((r) => now - t(r) <= span);
  const prev = all.filter((r) => now - t(r) > span && now - t(r) <= 2 * span);

  const buckets = range === "24h" ? 12 : range === "7d" ? 7 : range === "30d" ? 15 : 18;
  const size = span / buckets;
  const daily = { runs: [] as number[], successRate: [] as number[], p95Duration: [] as number[], p95Queue: [] as number[] };
  for (let i = buckets - 1; i >= 0; i--) {
    const lo = now - (i + 1) * size;
    const hi = now - i * size;
    const s = stats(cur.filter((r) => t(r) > lo && t(r) <= hi));
    daily.runs.push(s.runs);
    daily.successRate.push(s.successRate ?? NaN);
    daily.p95Duration.push(s.p95DurationMs ?? NaN);
    daily.p95Queue.push(s.p95QueueMs ?? NaN);
  }
  // Carry the last known value over empty buckets so sparklines stay continuous.
  for (const key of ["successRate", "p95Duration", "p95Queue"] as const) {
    let last = daily[key].find((v) => !Number.isNaN(v)) ?? 0;
    daily[key] = daily[key].map((v) => (Number.isNaN(v) ? last : (last = v)));
  }
  const truncated = summaries.some((s) => {
    const runs = s.window_runs ?? [];
    if (runs.length < SUMMARY_RUNS) return false; // full history for this repo
    const oldest = Math.min(...runs.map(t));
    return oldest > now - 2 * span;
  });
  const previous = truncated || prev.length === 0 ? null : stats(prev);
  const previousGap = previous ? null : truncated ? "truncated" : "none";
  return { current: stats(cur), previous, previousGap, daily, repoCount: summaries.length };
}

export type SortKey = "attention" | "name" | "recent" | "success";
export const SORT_LABEL: Record<SortKey, string> = {
  attention: "Needs attention first",
  recent: "Most recent run",
  success: "Lowest success rate",
  name: "Name",
};

/** Sort repos; unknown summaries sort after known ones under attention/success. */
export function sortRepos(repos: Repo[], summaries: Map<string, RepoSummary>, key: SortKey, now: number): Repo[] {
  const rate = (r: Repo) => summaries.get(r.full_name)?.success_rate_30d ?? summaries.get(r.full_name)?.success_rate ?? 101;
  const last = (r: Repo) => {
    const at = summaries.get(r.full_name)?.latest_run_at;
    return at ? new Date(at).getTime() : 0;
  };
  const rank = (r: Repo) => {
    const s = summaries.get(r.full_name);
    return s ? repoHealth(s, now).rank : 5;
  };
  const out = [...repos];
  switch (key) {
    case "name": return out.sort((a, b) => a.name.localeCompare(b.name));
    case "recent": return out.sort((a, b) => last(b) - last(a));
    case "success": return out.sort((a, b) => rate(a) - rate(b) || a.name.localeCompare(b.name));
    case "attention":
    default:
      return out.sort((a, b) => rank(a) - rank(b) || rate(a) - rate(b) || last(b) - last(a));
  }
}

export interface RepoAttention {
  key: string;
  title: string;
  reason: string;
  repo: string;
  href: string;
  at: string | null;
}

/** Failing repositories as attention rows: "<repo> is failing on <branch>". */
export function failingRepoAttention(repos: Repo[], summaries: Map<string, RepoSummary>, now: number): RepoAttention[] {
  const out: RepoAttention[] = [];
  for (const r of repos) {
    const s = summaries.get(r.full_name);
    if (!s || repoHealth(s, now).key !== "failing") continue;
    const runs = s.recent_runs ?? [];
    let streak = 0;
    for (const run of runs) {
      if (run.status !== "completed") continue;
      if (run.conclusion === "success") break;
      if (run.conclusion === "failure" || run.conclusion === "timed_out" || run.conclusion === "startup_failure") streak++;
    }
    const branch = s.latest_branch ? ` on ${s.latest_branch}` : "";
    const reason = [
      streak > 1 ? `${streak} failures in a row` : "The latest run failed",
      s.latest_message ? s.latest_message : null,
    ].filter(Boolean).join(" · ");
    out.push({ key: `repo:${r.full_name}`, title: `${r.name} is failing${branch}`, reason, repo: r.name, href: `/repos/${r.owner}/${r.name}`, at: s.latest_run_at });
  }
  return out.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());
}
