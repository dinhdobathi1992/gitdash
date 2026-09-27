import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { listWorkflowRuns } from "@/lib/github";
import { validateOwner, validateRepo, validateId, validatePerPage, safeError } from "@/lib/validation";
import { polledCacheHeaders, wantsFresh } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { withCache, hashKey } from "@/lib/cache";

// Server-side TTL. The workflow page polls every 30s while a run is in
// progress, so this stays short; unchanged re-fetches are free via ETag 304s.
const CACHE_TTL = 15;

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/runs");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  const workflowIdResult = validateId(searchParams.get("workflow_id"), "workflow_id");
  if (!workflowIdResult.ok) return workflowIdResult.response;

  const perPageResult = validatePerPage(searchParams.get("per_page"), 50);
  if (!perPageResult.ok) return perPageResult.response;

  try {
    const runs = await withCache(
      `github/runs:${hashKey(token)}:${ownerResult.data}:${repoResult.data}:${workflowIdResult.data}:${perPageResult.data}`,
      CACHE_TTL,
      () => listWorkflowRuns(token, ownerResult.data, repoResult.data, workflowIdResult.data, perPageResult.data),
      { shared: true, refresh: wantsFresh(req) },
    );
    return NextResponse.json(runs, {
      headers: polledCacheHeaders(),
    });
  } catch (e) {
    return safeError(e, "Failed to fetch workflow runs");
  }
}
