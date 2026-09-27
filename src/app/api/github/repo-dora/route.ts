import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getRepoDoraSummary } from "@/lib/github-dora";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";
import { gatedCacheHeaders } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { withCache, hashKey, partialAwareTtl } from "@/lib/cache";

const CACHE_TTL = 300; // 5 minutes — PR data changes infrequently

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/repo-dora");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  try {
    const summary = await withCache(
      `github/repo-dora:${hashKey(token)}:${ownerResult.data}:${repoResult.data}`,
      CACHE_TTL,
      () => getRepoDoraSummary(token, ownerResult.data, repoResult.data),
      { shared: true, ttlFor: partialAwareTtl(CACHE_TTL) },
    );
    return NextResponse.json(summary, {
      headers: {
        ...gatedCacheHeaders(),
      },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch DORA metrics");
  }
}
