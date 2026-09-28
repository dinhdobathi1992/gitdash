import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { validateOwner, safeError } from "@/lib/validation";
import { getOctokit } from "@/lib/github";
import { privateCacheHeaders, wantsFresh } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { withCache, hashKey, partialAwareTtl } from "@/lib/cache";
import { buildContributorProfile } from "@/lib/contributor-profile";

export type {
  ContributorPrSummary,
  ContributorReviewSummary,
  ContributorProfileResponse,
} from "@/lib/contributor-profile";

/**
 * A 90-day profile barely moves in half an hour. Past the TTL the old value is
 * served for up to 6 hours while one background rebuild replaces it, so only
 * the very first visit ever waits for GitHub search.
 */
const CACHE_TTL = 1800;
const STALE_SECONDS = 6 * 3600;
const BROWSER_MAX_AGE = 300;

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/contributor-profile");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;
  const owner = ownerResult.data;

  const loginParam = searchParams.get("login");
  if (!loginParam || !/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$|^[a-zA-Z0-9]$/.test(loginParam)) {
    return NextResponse.json({ error: "Invalid login parameter" }, { status: 400 });
  }
  const login = loginParam;

  try {
    const response = await withCache(
      `github/contributor-profile:${hashKey(token)}:${owner}:${login}`,
      CACHE_TTL,
      () => buildContributorProfile(getOctokit(token), owner, login),
      { shared: true, ttlFor: partialAwareTtl(CACHE_TTL), staleSeconds: STALE_SECONDS, refresh: wantsFresh(req) },
    );
    return NextResponse.json(response, {
      headers: {
        ...privateCacheHeaders(BROWSER_MAX_AGE, 600),
      },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch contributor profile");
  }
}
