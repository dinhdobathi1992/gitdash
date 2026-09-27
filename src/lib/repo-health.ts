/**
 * Repository status for the repositories table, pinned list and phone cards.
 * Vocabulary is fixed by the design contract §5: Passing, Failing, Running,
 * Queued, No recent runs.
 */

import type { RepoSummary } from "@/lib/github";
import type { StatusTone } from "@/components/ui/StatusPill";

export type RepoHealthKey = "failing" | "running" | "queued" | "passing" | "none";

export interface RepoHealth {
  key: RepoHealthKey;
  label: string;
  tone: StatusTone;
  dot: string;
  /** Lower sorts first under "Needs attention first". */
  rank: number;
}

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
const QUEUED = new Set(["queued", "waiting", "requested", "pending"]);
const DAY = 86_400_000;

const HEALTH: Record<RepoHealthKey, RepoHealth> = {
  failing: { key: "failing", label: "Failing", tone: "fail", dot: "bg-status-fail", rank: 0 },
  running: { key: "running", label: "Running", tone: "run", dot: "bg-status-run", rank: 1 },
  queued: { key: "queued", label: "Queued", tone: "run", dot: "bg-status-run", rank: 2 },
  passing: { key: "passing", label: "Passing", tone: "pass", dot: "bg-status-pass", rank: 3 },
  none: { key: "none", label: "No recent runs", tone: "neutral", dot: "bg-status-neutral", rank: 4 },
};

/**
 * Live state wins (running/queued). Otherwise the newest *decisive* run —
 * cancelled and skipped runs say nothing about health — decides pass/fail.
 * No runs in 30 days = "No recent runs". `now` is injectable for tests.
 */
export function repoHealth(s: RepoSummary, now: number = Date.now()): RepoHealth {
  const runs = s.recent_runs ?? [];
  if (runs.length === 0 || !s.latest_run_at || now - new Date(s.latest_run_at).getTime() > 30 * DAY) return HEALTH.none;
  const newest = runs[0];
  if (newest.status === "in_progress") return HEALTH.running;
  if (newest.status && QUEUED.has(newest.status)) return HEALTH.queued;
  const decisive = runs.find((r) => r.status === "completed" && (r.conclusion === "success" || FAILED.has(r.conclusion ?? "")));
  if (!decisive) return HEALTH.none;
  return FAILED.has(decisive.conclusion ?? "") ? HEALTH.failing : HEALTH.passing;
}

export { HEALTH as REPO_HEALTH };
