import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { validateOwner, validateRepo, validatePerPage, safeError } from "@/lib/validation";
import { getOctokit } from "@/lib/github";

const CACHE_TTL = 120; // 2 minutes

// ── Response types ────────────────────────────────────────────────────────────

export interface ContributorStat {
  login: string;
  avatar_url: string;
  total_runs: number;
  success: number;
  failure: number;
  success_rate: number;          // 0-100
  avg_duration_ms: number;
  avg_queue_wait_ms: number;
  /** Day-of-week activity: 0=Sun … 6=Sat */
  activity_by_dow: number[];     // length 7, run counts
  /** Hour-of-day activity: 0-23 */
  activity_by_hour: number[];    // length 24, run counts
  busiest_hour: number;          // 0-23, hour with most runs (UTC)
  last_run_at: string | null;
}

export interface TeamStatsResponse {
  contributors: ContributorStat[];
  /** Total runs analysed */
  total_runs: number;
  /** Period analysed in days (approximation based on oldest run in sample) */
  period_days: number;
  /** Most active contributor login */
  top_contributor: string | null;
  /** Most reliable contributor login (highest success rate, ≥5 runs) */
  most_reliable: string | null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  // Per-page: how many runs to analyse (max 100)
  const perPageResult = validatePerPage(searchParams.get("per_page"), 100);
  if (!perPageResult.ok) return perPageResult.response;

  try {
    const octokit = getOctokit(token);
    const ownerVal = ownerResult.data;
    const repoVal = repoResult.data;
    const perPage = perPageResult.ok ? perPageResult.data : 100;

    // Fetch recent runs across all workflows for this repo
    const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner: ownerVal,
      repo: repoVal,
      per_page: perPage,
      status: "completed",
    });

    const runs = data.workflow_runs;

    if (runs.length === 0) {
      const empty: TeamStatsResponse = {
        contributors: [],
        total_runs: 0,
        period_days: 0,
        top_contributor: null,
        most_reliable: null,
      };
      return NextResponse.json(empty, {
        headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=120` },
      });
    }

    // ── Aggregate per-contributor ─────────────────────────────────────────────
    interface Acc {
      login: string;
      avatar_url: string;
      success: number;
      failure: number;
      durations: number[];
      queue_waits: number[];
      activity_by_dow: number[];
      activity_by_hour: number[];
      last_run_at: string | null;
    }

    const map = new Map<string, Acc>();

    for (const r of runs) {
      const actor = r.actor;
      if (!actor) continue;
      const login = actor.login;

      if (!map.has(login)) {
        map.set(login, {
          login,
          avatar_url: actor.avatar_url,
          success: 0,
          failure: 0,
          durations: [],
          queue_waits: [],
          activity_by_dow: Array(7).fill(0),
          activity_by_hour: Array(24).fill(0),
          last_run_at: null,
        });
      }

      const acc = map.get(login)!;

      // Success / failure
      if (r.conclusion === "success") acc.success++;
      else if (r.conclusion === "failure") acc.failure++;

      // Duration
      const startedAt = r.run_started_at
        ? new Date(r.run_started_at).getTime()
        : new Date(r.created_at).getTime();
      const rawCompletedAt = (r as unknown as { completed_at?: string | null }).completed_at;
      const completedAt = rawCompletedAt
        ? new Date(rawCompletedAt).getTime()
        : new Date(r.updated_at).getTime();
      const duration_ms = completedAt - startedAt;
      if (duration_ms > 0) acc.durations.push(duration_ms);

      // Queue wait
      if (r.run_started_at) {
        const qw = new Date(r.run_started_at).getTime() - new Date(r.created_at).getTime();
        if (qw >= 0) acc.queue_waits.push(qw);
      }

      // Activity by day of week + hour (UTC)
      const createdDate = new Date(r.created_at);
      acc.activity_by_dow[createdDate.getUTCDay()]++;
      acc.activity_by_hour[createdDate.getUTCHours()]++;

      // Last run
      if (!acc.last_run_at || r.created_at > acc.last_run_at) {
        acc.last_run_at = r.created_at;
      }
    }

    // ── Build response contributors ───────────────────────────────────────────
    const contributors: ContributorStat[] = Array.from(map.values())
      .map((acc): ContributorStat => {
        const total = acc.success + acc.failure;
        const success_rate = total > 0 ? Math.round((acc.success / total) * 100) : 0;
        const avg_duration_ms = acc.durations.length
          ? Math.round(acc.durations.reduce((a, b) => a + b, 0) / acc.durations.length)
          : 0;
        const avg_queue_wait_ms = acc.queue_waits.length
          ? Math.round(acc.queue_waits.reduce((a, b) => a + b, 0) / acc.queue_waits.length)
          : 0;

        // Busiest hour = hour with max runs
        let busiest_hour = 0;
        let maxHourCount = 0;
        for (let h = 0; h < 24; h++) {
          if (acc.activity_by_hour[h] > maxHourCount) {
            maxHourCount = acc.activity_by_hour[h];
            busiest_hour = h;
          }
        }

        return {
          login: acc.login,
          avatar_url: acc.avatar_url,
          total_runs: total,
          success: acc.success,
          failure: acc.failure,
          success_rate,
          avg_duration_ms,
          avg_queue_wait_ms,
          activity_by_dow: acc.activity_by_dow,
          activity_by_hour: acc.activity_by_hour,
          busiest_hour,
          last_run_at: acc.last_run_at,
        };
      })
      // Sort by total runs descending
      .sort((a, b) => b.total_runs - a.total_runs);

    // Period: oldest run date to now
    const oldestRun = runs.at(-1);
    const period_days = oldestRun
      ? Math.max(1, Math.round((Date.now() - new Date(oldestRun.created_at).getTime()) / 86_400_000))
      : 0;

    const top_contributor = contributors[0]?.login ?? null;
    const most_reliable =
      contributors.filter((c) => c.total_runs >= 5).sort((a, b) => b.success_rate - a.success_rate)[0]
        ?.login ?? null;

    const response: TeamStatsResponse = {
      contributors,
      total_runs: runs.length,
      period_days,
      top_contributor,
      most_reliable,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=120` },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch team stats");
  }
}
