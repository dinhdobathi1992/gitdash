/**
 * GET /api/db/runs?owner=X&repo=Y&limit=200&offset=0&conclusion=failure
 *
 * Returns historical workflow runs from Neon DB (not GitHub API).
 * Falls back to 0 results if DB has no data for this repo yet.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getDbRuns, getDbRunCount } from "@/lib/db";
import { safeError, validateOwner, validateRepo } from "@/lib/validation";
import { privateCacheHeaders } from "@/lib/http-cache";
import { canSeeRepo } from "@/lib/repo-access";

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;
  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;
  const owner = ownerResult.data;
  const repoName = repoResult.data;

  const limit = Math.min(500, parseInt(searchParams.get("limit") ?? "200", 10));
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10));
  const conclusion = searchParams.get("conclusion") ?? undefined;
  const repoKey = `${owner}/${repoName}`;

  try {
    // Runs were synced with the service token; only serve repos this user can see.
    if (!(await canSeeRepo(token, owner, repoName))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const [runs, total] = await Promise.all([
      getDbRuns(repoKey, limit, offset, conclusion),
      getDbRunCount(repoKey),
    ]);

    return NextResponse.json(
      { runs, total, limit, offset },
      { headers: privateCacheHeaders(0) }
    );
  } catch (e) {
    return safeError(e, "Failed to fetch runs from DB");
  }
}
