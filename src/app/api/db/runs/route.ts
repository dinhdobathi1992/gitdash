/**
 * GET /api/db/runs?owner=X&repo=Y&limit=200&offset=0&conclusion=failure
 *
 * Returns historical workflow runs from Neon DB (not GitHub API).
 * Falls back to 0 results if DB has no data for this repo yet.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getDbRuns, getDbRunCount } from "@/lib/db";
import { safeError } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");
  const repoName = searchParams.get("repo");
  if (!owner || !repoName) {
    return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
  }

  const limit = Math.min(500, parseInt(searchParams.get("limit") ?? "200", 10));
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10));
  const conclusion = searchParams.get("conclusion") ?? undefined;
  const repoKey = `${owner}/${repoName}`;

  try {
    const [runs, total] = await Promise.all([
      getDbRuns(repoKey, limit, offset, conclusion),
      getDbRunCount(repoKey),
    ]);

    return NextResponse.json(
      { runs, total, limit, offset },
      { headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (e) {
    return safeError(e, "Failed to fetch runs from DB");
  }
}
