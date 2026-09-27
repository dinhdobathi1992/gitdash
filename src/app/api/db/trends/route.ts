/**
 * GET /api/db/trends?owner=X&repo=Y&type=daily|quarterly&days=90&quarters=6
 *
 * Returns aggregated historical trend data from Neon DB.
 * type=daily  → daily rollups for charts (last N days)
 * type=quarterly → quarterly summaries for year-over-year comparison
 * type=org    → org-wide daily trends (owner param = org login)
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getDailyTrends, getQuarterlySummary, getOrgDailyTrends } from "@/lib/db";
import { safeError, validateOwner, validateRepo } from "@/lib/validation";
import { privateCacheHeaders } from "@/lib/http-cache";
import { canSeeRepo, canSeeOwner } from "@/lib/repo-access";

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "daily";
  const rawOwner = searchParams.get("owner");
  const rawRepo = searchParams.get("repo");
  const ownerResult = rawOwner === null ? null : validateOwner(rawOwner);
  if (ownerResult && !ownerResult.ok) return ownerResult.response;
  const repoResult = rawRepo === null ? null : validateRepo(rawRepo);
  if (repoResult && !repoResult.ok) return repoResult.response;
  const owner = ownerResult?.data ?? null;
  const repoName = repoResult?.data ?? null;

  try {
    if (type === "org") {
      if (!owner) return NextResponse.json({ error: "owner is required" }, { status: 400 });
      // Trends were synced with the service token; only serve orgs this user belongs to.
      if (!(await canSeeOwner(token, owner))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const days = Math.min(365, parseInt(searchParams.get("days") ?? "90", 10));
      const data = await getOrgDailyTrends(owner, days);
      return NextResponse.json({ type: "org", data }, {
        headers: privateCacheHeaders(0),
      });
    }

    if (!owner || !repoName) {
      return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
    }
    const repoKey = `${owner}/${repoName}`;
    if (!(await canSeeRepo(token, owner, repoName))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (type === "quarterly") {
      const quarters = Math.min(12, parseInt(searchParams.get("quarters") ?? "6", 10));
      const data = await getQuarterlySummary(repoKey, quarters);
      return NextResponse.json({ type: "quarterly", data }, {
        headers: privateCacheHeaders(0),
      });
    }

    // Default: daily
    const days = Math.min(365, parseInt(searchParams.get("days") ?? "90", 10));
    const data = await getDailyTrends(repoKey, days);
    return NextResponse.json({ type: "daily", data }, {
      headers: privateCacheHeaders(0),
    });
  } catch (e) {
    return safeError(e, "Failed to fetch trend data");
  }
}
