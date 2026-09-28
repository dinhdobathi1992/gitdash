import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { validateOwner, safeError } from "@/lib/validation";
import { getOctokit } from "@/lib/github";
import { privateCacheHeaders, wantsFresh } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { withCache, hashKey, partialAwareTtl } from "@/lib/cache";
import { buildContributorProfile, serverTiming, type StepTiming } from "@/lib/contributor-profile";

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

  // Server-Timing: per-step durations when this request built the profile,
  // and the cache outcome — miss (built here), stale (old value served while a
  // background refresh runs) or hit. Durations only; no data or identifiers.
  const t0 = performance.now();
  const steps: StepTiming[] = [];
  const run: { build: "none" | "started" | "done" } = { build: "none" };
  try {
    const response = await withCache(
      `github/contributor-profile:${hashKey(token)}:${owner}:${login}`,
      CACHE_TTL,
      async () => {
        run.build = "started";
        const v = await buildContributorProfile(getOctokit(token), owner, login, new Date(), steps);
        run.build = "done";
        return v;
      },
      { shared: true, ttlFor: partialAwareTtl(CACHE_TTL), staleSeconds: STALE_SECONDS, refresh: wantsFresh(req) },
    );
    const outcome = run.build === "done" ? "miss" : run.build === "started" ? "stale" : "hit";
    const timing = [
      { name: "total", ms: performance.now() - t0 },
      { name: "cache", ms: 0, desc: outcome },
      ...(outcome === "miss" ? steps : []),
    ];
    return NextResponse.json(response, {
      headers: {
        ...privateCacheHeaders(BROWSER_MAX_AGE, 600),
        "Server-Timing": serverTiming(timing),
      },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch contributor profile");
  }
}
