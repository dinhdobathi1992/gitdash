/**
 * Org-wide health scorecard computation — composite score (DORA tier +
 * bus-factor risk) and throughput trend per repo. Extracted from the
 * org-health-scorecard route (v4.0.0) so the Weekly Leadership Digest
 * (v4.0.3) can reuse the exact same computation for its narrative instead
 * of duplicating the fan-out; the route itself is now a thin cached wrapper.
 */

import type { Octokit } from "@octokit/rest";
import { listOrgRepos } from "@/lib/github";
import { getRepoDoraSummary, type RepoDoraSummaryWithFetchStatus } from "@/lib/github-dora";
import { computeBusFactor, type BusFactorResponse } from "@/lib/bus-factor";
import type { DoraLevel } from "@/lib/dora";
import { pLimitSettled } from "@/lib/concurrency";

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

export async function computeScorecard(
  token: string,
  octokit: Octokit,
  org: string,
  limit: number,
): Promise<OrgHealthScorecardResponse> {
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
