import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { listOrgRepos } from "@/lib/github";
import { validateOrg, safeError } from "@/lib/validation";
import { privateCacheHeaders, wantsFresh } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { withCache, hashKey } from "@/lib/cache";

const CACHE_TTL = 300; // 5 min

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/org-repos");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgResult = validateOrg(new URL(req.url).searchParams.get("org"));
  if (!orgResult.ok) return orgResult.response;

  try {
    const repos = await withCache(
      `github/org-repos:${hashKey(token)}:${orgResult.data}`,
      CACHE_TTL,
      () => listOrgRepos(token, orgResult.data),
      { shared: true, refresh: wantsFresh(req) },
    );
    return NextResponse.json(repos, {
      headers: privateCacheHeaders(0),
    });
  } catch (e) {
    return safeError(e, "Failed to fetch organization repositories");
  }
}
