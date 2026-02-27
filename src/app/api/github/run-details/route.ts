import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { listRunJobs } from "@/lib/github";
import { validateOwner, validateRepo, validateId, safeError } from "@/lib/validation";

const CACHE_TTL = 600;

export async function GET(req: NextRequest) {
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
    const jobs = await listRunJobs(token, ownerResult.data, repoResult.data, runIdResult.data);
    return NextResponse.json(jobs, {
      headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=1200` },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch run details");
  }
}
