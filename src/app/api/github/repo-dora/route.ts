import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getRepoDoraSummary } from "@/lib/github-dora";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";

const CACHE_TTL = 300; // 5 minutes — PR data changes infrequently

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  try {
    const summary = await getRepoDoraSummary(token, ownerResult.data, repoResult.data);
    return NextResponse.json(summary, {
      headers: {
        "Cache-Control": `private, max-age=${CACHE_TTL}, stale-while-revalidate=600`,
      },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch DORA metrics");
  }
}
