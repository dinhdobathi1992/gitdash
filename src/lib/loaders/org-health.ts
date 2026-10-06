import { getOctokit } from "@/lib/github";
import { computeScorecard, type OrgHealthScorecardResponse } from "@/lib/org-health-scorecard";
import { validateOrg, validatePerPage } from "@/lib/validation";
import { withCache, hashKey, PARTIAL_TTL_SECONDS } from "@/lib/cache";
import { applyLabel, loaderOk, validationFailure, type LoaderOptions, type LoaderResult } from "./types";

const CACHE_TTL = 900; // 15 min — this fans out DORA + bus-factor per repo

/**
 * `limit` is the number of repos to analyse. A string is validated exactly as
 * the route's `limit` query parameter; the effective value is capped at 20
 * because the fan-out is expensive. Default 10.
 */
export async function loadOrgHealth(
  token: string,
  org: string | null,
  limit?: string | number | null,
  opts?: LoaderOptions,
): Promise<LoaderResult<OrgHealthScorecardResponse>> {
  applyLabel(opts);
  const orgResult = validateOrg(org);
  if (!orgResult.ok) return validationFailure(orgResult);
  const validOrg = orgResult.data;

  const limitResult = validatePerPage(limit === undefined || limit === null ? null : String(limit), 10);
  if (!limitResult.ok) return validationFailure(limitResult);
  const cappedLimit = Math.min(limitResult.data, 20); // expensive fan-out — keep this modest

  const response = await withCache<OrgHealthScorecardResponse>(
    `github/org-health-scorecard:${hashKey(token)}:${validOrg}:${cappedLimit}`,
    CACHE_TTL,
    () => computeScorecard(token, getOctokit(token), validOrg, cappedLimit),
    {
      shared: true,
      ttlFor: (r) =>
        r.repos_analysed < r.repos_attempted || r.repos.some((x) => x.partial) ? PARTIAL_TTL_SECONDS : CACHE_TTL,
    },
  );
  return loaderOk(response);
}
