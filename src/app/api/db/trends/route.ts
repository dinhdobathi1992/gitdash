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
import { safeError } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "daily";
  const owner = searchParams.get("owner");
  const repoName = searchParams.get("repo");

  try {
    if (type === "org") {
      if (!owner) return NextResponse.json({ error: "owner is required" }, { status: 400 });
      const days = Math.min(365, parseInt(searchParams.get("days") ?? "90", 10));
      const data = await getOrgDailyTrends(owner, days);
      return NextResponse.json({ type: "org", data }, {
        headers: { "Cache-Control": "private, s-maxage=900, stale-while-revalidate=3600" },
      });
    }

    if (!owner || !repoName) {
      return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
    }
    const repoKey = `${owner}/${repoName}`;

    if (type === "quarterly") {
      const quarters = Math.min(12, parseInt(searchParams.get("quarters") ?? "6", 10));
      const data = await getQuarterlySummary(repoKey, quarters);
      return NextResponse.json({ type: "quarterly", data }, {
        headers: { "Cache-Control": "private, s-maxage=3600, stale-while-revalidate=7200" },
      });
    }

    // Default: daily
    const days = Math.min(365, parseInt(searchParams.get("days") ?? "90", 10));
    const data = await getDailyTrends(repoKey, days);
    return NextResponse.json({ type: "daily", data }, {
      headers: { "Cache-Control": "private, s-maxage=900, stale-while-revalidate=3600" },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch trend data");
  }
}
