/**
 * GET /api/github/org-health-scorecard
 *
 * Leadership-facing rollup across every repo in an org: a composite health
 * score (DORA tier + bus-factor risk), a throughput trend, and everything
 * sorted worst-first so a leader sees what needs attention without opening
 * repos one at a time.
 *
 * Validation, caching and the computation live in
 * src/lib/loaders/org-health.ts and src/lib/org-health-scorecard.ts (also
 * reused by the Weekly Leadership Digest, v4.0.3) — this route is a thin
 * HTTP wrapper.
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
import { safeError } from "@/lib/validation";
import { gatedCacheHeaders } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { loadOrgHealth } from "@/lib/loaders/org-health";

export type { RepoScorecardEntry, OrgHealthScorecardResponse } from "@/lib/org-health-scorecard";

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/org-health-scorecard");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  try {
    const result = await loadOrgHealth(token, searchParams.get("org"), searchParams.get("limit"));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, {
      headers: gatedCacheHeaders(),
    });
  } catch (e) {
    return safeError(e, "Failed to compute org health scorecard");
  }
}
