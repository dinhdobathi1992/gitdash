/**
 * GET /api/github/org-health-scorecard
 *
 * Leadership-facing rollup across every repo in an org: a composite health
 * score (DORA tier + bus-factor risk), a throughput trend, and everything
 * sorted worst-first so a leader sees what needs attention without opening
 * repos one at a time.
 *
 * Computation lives in src/lib/org-health-scorecard.ts (also reused by the
 * Weekly Leadership Digest, v4.0.3) — this route is a thin cached wrapper.
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
import { getOctokit } from "@/lib/github";
import { computeScorecard, type OrgHealthScorecardResponse } from "@/lib/org-health-scorecard";
import { validateOrg, validatePerPage, safeError } from "@/lib/validation";
import { withCache, hashKey } from "@/lib/cache";

export type { RepoScorecardEntry, OrgHealthScorecardResponse } from "@/lib/org-health-scorecard";

const CACHE_TTL = 900; // 15 min — this fans out DORA + bus-factor per repo

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
      () => computeScorecard(token, getOctokit(token), org, limit),
    );

    return NextResponse.json(response, {
      headers: { "Cache-Control": `private, max-age=${CACHE_TTL}, stale-while-revalidate=300` },
    });
  } catch (e) {
    return safeError(e, "Failed to compute org health scorecard");
  }
}
