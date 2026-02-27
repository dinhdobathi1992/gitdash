import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getJobStats } from "@/lib/github";
import { validateOwner, validateRepo, validateId, validatePerPage, safeError } from "@/lib/validation";

const CACHE_TTL = 60;

export async function GET(req: NextRequest) {
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
    const stats = await getJobStats(
      token,
      ownerResult.data,
      repoResult.data,
      workflowIdResult.data,
      perPageResult.data
    );
    return NextResponse.json(stats, {
      headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=120` },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch job statistics");
  }
}
