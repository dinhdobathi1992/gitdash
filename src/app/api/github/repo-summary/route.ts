import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getRepoSummary } from "@/lib/github";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";
import { privateCacheHeaders, wantsFresh } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { withCache, hashKey } from "@/lib/cache";

// Short TTL — this is per-repo and called lazily as rows enter viewport
const CACHE_TTL = 300; // 5 min

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/repo-summary");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  try {
    const summary = await withCache(
      `github/repo-summary:${hashKey(token)}:${ownerResult.data}:${repoResult.data}`,
      CACHE_TTL,
      () => getRepoSummary(token, ownerResult.data, repoResult.data),
      { shared: true, refresh: wantsFresh(req) },
    );
    return NextResponse.json(summary, {
      headers: privateCacheHeaders(0),
    });
  } catch (e) {
    return safeError(e, "Failed to fetch repo summary");
  }
}
