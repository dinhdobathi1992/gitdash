import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getRepoOverview } from "@/lib/github";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";

const CACHE_TTL = 90;

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  try {
    const overview = await getRepoOverview(token, ownerResult.data, repoResult.data);
    return NextResponse.json(overview, {
      headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=180` },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch repo overview");
  }
}
