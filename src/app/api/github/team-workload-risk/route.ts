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
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getOctokit } from "@/lib/github";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";
import { withCache, hashKey } from "@/lib/cache";

const CACHE_TTL = 900; // 15 min
const WINDOW_DAYS = 42; // recent 14d + prior 28d baseline
const RECENT_DAYS = 14;
const AFTER_HOURS_THRESHOLD = 0.3; // >=30% of commits outside 9-18 UTC
const WEEKEND_THRESHOLD = 0.25; // >=25% of commits on Sat/Sun
const MIN_SAMPLE = 5; // minimum commits before flagging after-hours/weekend risk
const CONCURRENT_PR_OVERLOAD = 4; // open PRs at once

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

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;
  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  const owner = ownerResult.data;
  const repo = repoResult.data;

  try {
    const response = await withCache<TeamWorkloadRiskResponse>(
      `team-workload-risk:${hashKey(token)}:${owner}/${repo}`,
      CACHE_TTL,
      () => computeWorkloadRisk(token, owner, repo),
    );

    return NextResponse.json(response, {
      headers: { "Cache-Control": `private, max-age=${CACHE_TTL}, stale-while-revalidate=300` },
    });
  } catch (e) {
    return safeError(e, "Failed to compute team workload risk");
  }
}

async function computeWorkloadRisk(
  token: string,
  owner: string,
  repo: string,
): Promise<TeamWorkloadRiskResponse> {
  const octokit = getOctokit(token);
  const now = Date.now();
  const windowStart = new Date(now - WINDOW_DAYS * 86_400_000);
  const recentCutoff = now - RECENT_DAYS * 86_400_000;

  // ── Repo-wide commits, one paginated fetch, grouped by author locally ────
  interface AuthorAcc {
    login: string;
    avatar_url: string;
    total: number;
    afterHours: number;
    weekend: number;
    recent: number;
    prior: number;
  }
  const authorMap = new Map<string, AuthorAcc>();

  for (let page = 1; page <= 5; page++) {
    const { data } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      since: windowStart.toISOString(),
      per_page: 100,
      page,
    });
    if (data.length === 0) break;

    for (const c of data) {
      const login = c.author?.login ?? c.commit?.author?.name ?? "unknown";
      const avatar = c.author?.avatar_url ?? "";
      const dateStr = c.commit.author?.date ?? c.commit.committer?.date;
      if (!dateStr) continue;
      const d = new Date(dateStr);
      const ts = d.getTime();

      if (!authorMap.has(login)) {
        authorMap.set(login, { login, avatar_url: avatar, total: 0, afterHours: 0, weekend: 0, recent: 0, prior: 0 });
      }
      const acc = authorMap.get(login)!;
      acc.total++;
      if (!acc.avatar_url && avatar) acc.avatar_url = avatar;

      const hour = d.getUTCHours();
      if (hour < 9 || hour >= 18) acc.afterHours++;

      const day = d.getUTCDay();
      if (day === 0 || day === 6) acc.weekend++;

      if (ts >= recentCutoff) acc.recent++;
      else acc.prior++;
    }

    if (data.length < 100) break;
  }

  // ── Open PRs — one call, grouped by author for concurrent-load signal ───
  const openPrCounts = new Map<string, number>();
  try {
    const { data: openPrs } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "open",
      per_page: 100,
    });
    for (const pr of openPrs) {
      const login = pr.user?.login;
      if (!login) continue;
      openPrCounts.set(login, (openPrCounts.get(login) ?? 0) + 1);
    }
  } catch {
    // Non-fatal — workload risk without concurrent-PR data is still useful.
  }

  const totalCommitsAnalysed = Array.from(authorMap.values()).reduce((s, a) => s + a.total, 0);

  const people: WorkloadRiskEntry[] = Array.from(authorMap.values())
    .filter((a) => a.total >= 1)
    .map((a) => {
      const afterHoursPct = a.total > 0 ? Math.round((a.afterHours / a.total) * 100) : 0;
      const weekendPct = a.total > 0 ? Math.round((a.weekend / a.total) * 100) : 0;
      const openPrCount = openPrCounts.get(a.login) ?? 0;

      const afterHoursFlag = a.total >= MIN_SAMPLE && afterHoursPct / 100 >= AFTER_HOURS_THRESHOLD;
      const weekendFlag = a.total >= MIN_SAMPLE && weekendPct / 100 >= WEEKEND_THRESHOLD;
      const overloadFlag = openPrCount >= CONCURRENT_PR_OVERLOAD;
      // Cliff: meaningfully active in the baseline window, silent in the recent one.
      const cliffFlag = a.prior >= 3 && a.recent === 0;

      const flags = {
        after_hours: afterHoursFlag,
        weekend: weekendFlag,
        concurrent_pr_overload: overloadFlag,
        activity_cliff: cliffFlag,
      };
      const riskScore = Object.values(flags).filter(Boolean).length;

      return {
        login: a.login,
        avatar_url: a.avatar_url,
        total_commits: a.total,
        after_hours_pct: afterHoursPct,
        weekend_pct: weekendPct,
        open_pr_count: openPrCount,
        prior_period_commits: a.prior,
        recent_period_commits: a.recent,
        flags,
        risk_score: riskScore,
      };
    })
    .sort((a, b) => b.risk_score - a.risk_score || b.total_commits - a.total_commits);

  return {
    people,
    window_days: WINDOW_DAYS,
    total_commits_analysed: totalCommitsAnalysed,
  };
}
