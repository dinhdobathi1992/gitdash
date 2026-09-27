import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { listRunJobs } from "@/lib/github";
import { validateOwner, validateRepo, validateId, safeError } from "@/lib/validation";
import { polledCacheHeaders } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { withCache, hashKey } from "@/lib/cache";

// Server-side TTL. The workflow page polls every 30s while a run is in
// progress, so this stays short; unchanged re-fetches are free via ETag 304s.
const CACHE_TTL = 15;

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/run-details");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  const runIdResult = validateId(searchParams.get("run_id"), "run_id");
  if (!runIdResult.ok) return runIdResult.response;

  try {
    const jobs = await withCache(
      `github/run-details:${hashKey(token)}:${ownerResult.data}:${repoResult.data}:${runIdResult.data}`,
      CACHE_TTL,
      () => listRunJobs(token, ownerResult.data, repoResult.data, runIdResult.data),
      { shared: true },
    );
    return NextResponse.json(jobs, {
      headers: polledCacheHeaders(),
    });
  } catch (e) {
    return safeError(e, "Failed to fetch run details");
  }
}
