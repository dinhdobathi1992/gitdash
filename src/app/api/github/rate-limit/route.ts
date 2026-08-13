/**
 * GET /api/github/rate-limit
 *
 * Returns the authenticated user's current GitHub API rate-limit status.
 * Calls GET /rate_limit, which GitHub explicitly excludes from rate-limit
 * accounting — checking this endpoint never costs quota.
 */

import { NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getOctokit } from "@/lib/github";
import { safeError } from "@/lib/validation";

const CACHE_TTL = 30; // seconds — short-lived, browser-only cache

export interface RateLimitStatus {
  core: { limit: number; remaining: number; reset: number; used: number };
  graphql: { limit: number; remaining: number; reset: number; used: number };
}

export async function GET() {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const octokit = getOctokit(token);
    const { data } = await octokit.request("GET /rate_limit");

    const status: RateLimitStatus = {
      core: {
        limit: data.resources.core.limit,
        remaining: data.resources.core.remaining,
        reset: data.resources.core.reset,
        used: data.resources.core.used,
      },
      graphql: {
        limit: data.resources.graphql?.limit ?? 0,
        remaining: data.resources.graphql?.remaining ?? 0,
        reset: data.resources.graphql?.reset ?? 0,
        used: data.resources.graphql?.used ?? 0,
      },
    };

    return NextResponse.json(status, {
      headers: { "Cache-Control": `private, max-age=${CACHE_TTL}` },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch rate limit status");
  }
}
