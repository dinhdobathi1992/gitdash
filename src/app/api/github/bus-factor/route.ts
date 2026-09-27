import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";
import { getOctokit } from "@/lib/github";
import { withCache, hashKey, partialAwareTtl } from "@/lib/cache";
import { computeBusFactor, type BusFactorResponse } from "@/lib/bus-factor";

import { gatedCacheHeaders } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";

export type { ModuleOwnership, BusFactorResponse } from "@/lib/bus-factor";

const CACHE_TTL = 600; // 10 minutes

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/bus-factor");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  const owner = ownerResult.data;
  const repo = repoResult.data;

  try {
    // Route-level cache: token-scoped (result reflects this user's repo access)
    // and coalesced, so concurrent cold requests share one computation.
    const response = await withCache<BusFactorResponse>(
      `github/bus-factor:${hashKey(token)}:${owner}/${repo}`,
      CACHE_TTL,
      () => computeBusFactor(getOctokit(token), owner, repo),
      { shared: true, ttlFor: partialAwareTtl(CACHE_TTL) },
    );

    return NextResponse.json(response, {
      headers: {
        ...gatedCacheHeaders(),
      },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch bus factor data");
  }
}
