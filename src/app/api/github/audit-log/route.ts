import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { listWorkflowFileCommits } from "@/lib/github";
import { validateOwner, validateRepo, validatePerPage, safeError } from "@/lib/validation";
import { privateCacheHeaders, wantsFresh } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { withCache, hashKey } from "@/lib/cache";

const CACHE_TTL = 300; // 5 min

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/audit-log");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  const limitResult = validatePerPage(searchParams.get("limit"), 30);
  if (!limitResult.ok) return limitResult.response;

  try {
    const commits = await withCache(
      `github/audit-log:${hashKey(token)}:${ownerResult.data}:${repoResult.data}:${limitResult.data}`,
      CACHE_TTL,
      () => listWorkflowFileCommits(token, ownerResult.data, repoResult.data, limitResult.data),
      { shared: true, refresh: wantsFresh(req) },
    );
    return NextResponse.json(commits, {
      headers: privateCacheHeaders(0),
    });
  } catch (e) {
    return safeError(e, "Failed to fetch audit log");
  }
}
