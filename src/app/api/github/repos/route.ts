import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { listRepos } from "@/lib/github";
import { safeError } from "@/lib/validation";
import { privateCacheHeaders, wantsFresh } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { withCache, hashKey } from "@/lib/cache";

const CACHE_TTL = 60;

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/repos");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const repos = await withCache(
      `github/repos:${hashKey(token)}`,
      CACHE_TTL,
      () => listRepos(token),
      { shared: true, refresh: wantsFresh(req) },
    );
    return NextResponse.json(repos, {
      headers: privateCacheHeaders(0),
    });
  } catch (e) {
    return safeError(e, "Failed to fetch repositories");
  }
}
