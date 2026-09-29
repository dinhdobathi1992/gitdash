/**
 * GET /api/github/team-workload-risk
 *
 * Team-wide people-risk radar for a single repo. Distinct from Review
 * Bottleneck (v3.2.0, which covers reviewer overload) — this covers three
 * signals nothing else in the app surfaces:
 *   - sustained after-hours / weekend commit share (burnout signal)
 *   - "activity cliff": was actively committing, has gone quiet (possible
 *     disengagement — the thing a manager wants to know before it becomes
 *     an attrition surprise)
 *   - concurrent open-PR overload (context-switching load)
 *
 * Deliberately does its own lightweight repo-wide commit/PR fetch rather
 * than reusing contributor-profile's per-contributor logic — fetching
 * commits once for the whole repo and grouping by author locally is far
 * cheaper than N per-contributor fetches, and open PRs are a single call.
 *
 * Without `days`: the legacy 42-day view (repo Team tab), output shape
 * unchanged. With `days=30|90`: the Team insights window, with `partial`,
 * the thresholds and the workday. Both count hours in the org workday
 * (src/lib/team-settings.ts) and merge linked accounts (src/lib/team-workload.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getOctokit } from "@/lib/github";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";
import { withCache, hashKey } from "@/lib/cache";
import { gatedCacheHeaders } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { loadCanonical } from "@/lib/identity-links";
import { workdayKey, type Workday } from "@/lib/team-settings";
import { getWorkday } from "@/lib/workday-setting";
import {
  WORKLOAD_THRESHOLDS, computeWorkload, fetchCommitCounters, type WorkloadCounters, type WorkloadPerson,
} from "@/lib/team-workload";

const CACHE_TTL = 900; // 15 min
const WINDOW_DAYS = 42; // legacy: recent 14d + prior 28d baseline
const VALID_DAYS = [30, 90];

export interface WorkloadRiskEntry {
  login: string;
  avatar_url: string;
  total_commits: number;
  after_hours_pct: number;
  weekend_pct: number;
  open_pr_count: number;
  /** Commits in the prior baseline window (days 15-42 back). */
  prior_period_commits: number;
  /** Commits in the most recent window (last 14 days). */
  recent_period_commits: number;
  flags: {
    after_hours: boolean;
    weekend: boolean;
    concurrent_pr_overload: boolean;
    /** Was active in the prior period, has gone silent in the recent one. */
    activity_cliff: boolean;
  };
  /** Number of flags set — used to sort risk-first. */
  risk_score: number;
}

export interface TeamWorkloadRiskResponse {
  people: WorkloadRiskEntry[];
  window_days: number;
  total_commits_analysed: number;
}

/** `days=30|90`: the Team insights window. Rows carry bot/name/link markers. */
export interface TeamWorkloadRiskWindowResponse {
  people: WorkloadPerson[];
  window_days: number;
  total_commits_analysed: number;
  /** The commit page cap was reached; the activity cliff is not computed. */
  partial: boolean;
  thresholds: typeof WORKLOAD_THRESHOLDS;
  /** The org workday the after-hours and weekend figures were counted in. */
  workday: Workday;
}

/** Legacy output shape — exactly the fields the repo Team tab has always received. */
function toLegacyEntry(p: WorkloadPerson): WorkloadRiskEntry {
  return {
    login: p.login,
    avatar_url: p.avatar_url,
    total_commits: p.total_commits,
    after_hours_pct: p.after_hours_pct,
    weekend_pct: p.weekend_pct,
    open_pr_count: p.open_pr_count,
    prior_period_commits: p.prior_period_commits,
    recent_period_commits: p.recent_period_commits,
    flags: p.flags,
    risk_score: p.risk_score,
  };
}

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/team-workload-risk");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;
  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;
  const rawDays = searchParams.get("days");
  const days = rawDays === null ? null : Number(rawDays);
  if (days !== null && !VALID_DAYS.includes(days)) {
    return NextResponse.json({ error: "days must be 30 or 90" }, { status: 400 });
  }

  const owner = ownerResult.data;
  const repo = repoResult.data;

  try {
    const workday = await getWorkday();
    const windowDays = days ?? WINDOW_DAYS;
    // Counters depend on the workday (hours are read in its zone), so it is part of the key.
    const counters = await withCache<WorkloadCounters>(
      `github/team-workload-risk:v2:${hashKey(token)}:${owner}/${repo}:${windowDays}d:${workdayKey(workday)}`,
      CACHE_TTL,
      () => fetchCommitCounters(getOctokit(token), owner, repo, { windowDays, workday }),
      // No short TTL for `partial`: here it means the page cap was reached, which a
      // retry would not change — refetching every 30 s would only burn quota.
      { shared: true },
    );
    // Links are read uncached, after the cache, so a change shows on the next load.
    const { canonical } = await loadCanonical();

    if (days === null) {
      const response: TeamWorkloadRiskResponse = {
        people: computeWorkload(counters, canonical).map(toLegacyEntry),
        window_days: WINDOW_DAYS,
        total_commits_analysed: counters.total_commits,
      };
      return NextResponse.json(response, { headers: gatedCacheHeaders() });
    }

    const response: TeamWorkloadRiskWindowResponse = {
      people: computeWorkload(counters, canonical, { cliff: !counters.partial }),
      window_days: days,
      total_commits_analysed: counters.total_commits,
      partial: counters.partial,
      thresholds: WORKLOAD_THRESHOLDS,
      workday,
    };
    return NextResponse.json(response, { headers: gatedCacheHeaders() });
  } catch (e) {
    return safeError(e, "Failed to compute team workload risk");
  }
}
