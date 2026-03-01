import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { listWorkflowFileCommits } from "@/lib/github";
import { validateOwner, validateRepo, validatePerPage, safeError } from "@/lib/validation";

const CACHE_TTL = 120;

export async function GET(req: NextRequest) {
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
    const commits = await listWorkflowFileCommits(
      token,
      ownerResult.data,
      repoResult.data,
      limitResult.data,
    );
    return NextResponse.json(commits, {
      headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=60` },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch audit log");
  }
}
