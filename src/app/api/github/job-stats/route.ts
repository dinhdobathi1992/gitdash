import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getJobStats } from "@/lib/github";
import { validateOwner, validateRepo, validateId, validatePerPage, safeError } from "@/lib/validation";
import { gatedCacheHeaders } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { withCache, hashKey } from "@/lib/cache";

const CACHE_TTL = 300; // 5 min

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/job-stats");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  const workflowIdResult = validateId(searchParams.get("workflow_id"), "workflow_id");
  if (!workflowIdResult.ok) return workflowIdResult.response;

  const perPageResult = validatePerPage(searchParams.get("per_page"), 30);
  if (!perPageResult.ok) return perPageResult.response;

  try {
    const stats = await withCache(
      `github/job-stats:${hashKey(token)}:${ownerResult.data}:${repoResult.data}:${workflowIdResult.data}:${perPageResult.data}`,
      CACHE_TTL,
      () => getJobStats(token, ownerResult.data, repoResult.data, workflowIdResult.data, perPageResult.data),
      { shared: true },
    );
    return NextResponse.json(stats, {
      headers: gatedCacheHeaders(),
    });
  } catch (e) {
    return safeError(e, "Failed to fetch job statistics");
  }
}
