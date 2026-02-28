import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getRepoSummary } from "@/lib/github";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";

// Short TTL — this is per-repo and called lazily as rows enter viewport
const CACHE_TTL = 60;

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  try {
    const summary = await getRepoSummary(token, ownerResult.data, repoResult.data);
    return NextResponse.json(summary, {
      headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=120` },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch repo summary");
  }
}
