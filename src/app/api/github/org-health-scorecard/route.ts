/**
 * GET /api/github/org-health-scorecard
 *
 * Leadership-facing rollup across every repo in an org: a composite health
 * score (DORA tier + bus-factor risk), a throughput trend, and everything
 * sorted worst-first so a leader sees what needs attention without opening
 * repos one at a time.
 *
 * Deliberately avoids any new DB table (v4.0.0's rollback-safety goal —
 * see CHANGELOG): the trend signal is derived from the DORA throughput data
 * already fetched for the score itself (recent vs. prior half of the same
 * window), so this works identically for standalone/no-DB deployments.
 *
 * Composite score = 60% DORA tier + 40% bus-factor risk, 0-100. This is a
 * deliberately simple v1 — review-load balance and security findings are
 * candidates for a future version once this shape is validated.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getOctokit, listOrgRepos } from "@/lib/github";
import { getRepoDoraSummary, type RepoDoraSummaryWithFetchStatus } from "@/lib/github-dora";
import { computeBusFactor, type BusFactorResponse } from "@/lib/bus-factor";
import type { DoraLevel } from "@/lib/dora";
import { validateOrg, validatePerPage, safeError } from "@/lib/validation";
import { withCache, hashKey } from "@/lib/cache";
import { pLimitSettled } from "@/lib/concurrency";

const CACHE_TTL = 900; // 15 min — this fans out DORA + bus-factor per repo

const DORA_SCORE: Record<DoraLevel, number> = { elite: 100, high: 75, medium: 50, low: 25 };

export interface RepoScorecardEntry {
  owner: string;
  repo: string;
  dora_level: DoraLevel;
  overall_bus_factor: number;
  critical_modules: number;
  /** 0-100, higher is healthier. 60% DORA tier + 40% bus-factor risk. */
  composite_score: number;
  risk_band: "healthy" | "watch" | "at_risk";
  /** Merged-PR throughput, recent half of the window vs. prior half. */
  trend: "up" | "down" | "flat";
  /** True if either the DORA or bus-factor sub-fetch had partial data. */
  partial: boolean;
}

export interface OrgHealthScorecardResponse {
  org: string;
  repos: RepoScorecardEntry[];
  repos_analysed: number;
  repos_attempted: number;
}

function busFactorScore(overallBusFactor: number): number {
  if (overallBusFactor <= 1) return 25;
  if (overallBusFactor <= 2) return 60;
  return 100;
}

function riskBand(score: number): RepoScorecardEntry["risk_band"] {
  if (score >= 80) return "healthy";
  if (score >= 50) return "watch";
  return "at_risk";
}

function throughputTrend(weeks: { week_start: string; count: number }[]): RepoScorecardEntry["trend"] {
  if (weeks.length < 4) return "flat"; // not enough weeks for a stable signal
  const sorted = [...weeks].sort((a, b) => a.week_start.localeCompare(b.week_start));
  const half = Math.floor(sorted.length / 2);
  const prior = sorted.slice(0, half);
  const recent = sorted.slice(half);
  const avg = (arr: typeof sorted) => arr.reduce((s, w) => s + w.count, 0) / arr.length;
  const priorAvg = avg(prior);
  const recentAvg = avg(recent);
  if (priorAvg === 0 && recentAvg === 0) return "flat";
  const delta = priorAvg === 0 ? 1 : (recentAvg - priorAvg) / priorAvg;
  if (delta > 0.15) return "up";
  if (delta < -0.15) return "down";
  return "flat";
}

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const orgResult = validateOrg(searchParams.get("org"));
  if (!orgResult.ok) return orgResult.response;
  const org = orgResult.data;

  const limitResult = validatePerPage(searchParams.get("limit"), 10);
  if (!limitResult.ok) return limitResult.response;
  const limit = Math.min(limitResult.data, 20); // expensive fan-out — keep this modest

  try {
    const response = await withCache<OrgHealthScorecardResponse>(
      `org-health-scorecard:${hashKey(token)}:${org}:${limit}`,
      CACHE_TTL,
      () => computeScorecard(token, org, limit),
    );

    return NextResponse.json(response, {
      headers: { "Cache-Control": `private, max-age=${CACHE_TTL}, stale-while-revalidate=300` },
    });
  } catch (e) {
    return safeError(e, "Failed to compute org health scorecard");
  }
}

async function computeScorecard(
  token: string,
  org: string,
  limit: number,
): Promise<OrgHealthScorecardResponse> {
  const octokit = getOctokit(token);
  const allRepos = await listOrgRepos(token, org);
  const targets = allRepos.slice(0, limit);

  const settled = await pLimitSettled(
    targets.map((repo) => async () => {
      const [dora, busFactor] = await Promise.all([
        getRepoDoraSummary(token, org, repo.name) as Promise<RepoDoraSummaryWithFetchStatus>,
        computeBusFactor(octokit, org, repo.name) as Promise<BusFactorResponse>,
      ]);

      const doraScore = DORA_SCORE[dora.overall_level];
      const bfScore = busFactorScore(busFactor.overall_bus_factor);
      const composite = Math.round(doraScore * 0.6 + bfScore * 0.4);

      const entry: RepoScorecardEntry = {
        owner: org,
        repo: repo.name,
        dora_level: dora.overall_level,
        overall_bus_factor: busFactor.overall_bus_factor,
        critical_modules: busFactor.critical_modules,
        composite_score: composite,
        risk_band: riskBand(composite),
        trend: throughputTrend(dora.throughput_by_week),
        partial: dora.partial || busFactor.partial,
      };
      return entry;
    }),
    { concurrency: 3 }, // each task is itself ~2 fanned-out repo analyses — keep outer concurrency low
  );

  const repos = settled
    .filter((r): r is PromiseFulfilledResult<RepoScorecardEntry> => r.status === "fulfilled")
    .map((r) => r.value)
    .sort((a, b) => a.composite_score - b.composite_score); // worst first

  return {
    org,
    repos,
    repos_analysed: repos.length,
    repos_attempted: targets.length,
  };
}
