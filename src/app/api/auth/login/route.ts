import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isStandaloneMode } from "@/lib/mode";
import { publicUrl } from "@/lib/url";
import { randomBytes } from "crypto";
import { rateLimit, getRateLimitKey } from "@/lib/ratelimit";

// HIGH-002: 10 OAuth initiations per minute per IP
const RATE_LIMIT = { limit: 10, windowMs: 60_000 };

/**
 * GitHub's redirect_uri: from NEXT_PUBLIC_APP_URL when it is set, so forwarded
 * headers cannot choose it; otherwise from publicUrl. The callback route
 * (api/auth/callback/route.ts) builds the identical string with the same
 * expression, as GitHub requires.
 */
function githubCallbackUrl(req: NextRequest): string {
  return new URL("/api/auth/callback", process.env.NEXT_PUBLIC_APP_URL || publicUrl("/", req)).toString();
}

export async function GET(req: NextRequest) {
  // Standalone mode has no OAuth login — redirect to setup
  if (isStandaloneMode()) {
    return NextResponse.redirect(publicUrl("/setup", req));
  }

  // Rate limit OAuth initiation
  const rl = rateLimit(getRateLimitKey(req, "auth:login"), RATE_LIMIT.limit, RATE_LIMIT.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)) } }
    );
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GITHUB_CLIENT_ID not configured. Set it in your .env file." },
      { status: 500 }
    );
  }

  try {
    const state = randomBytes(16).toString("hex");
    // HIGH-004: Bind state to a 5-minute expiry window
    const stateExpiry = Date.now() + 5 * 60 * 1000;
    const session = await getSession();
    session.oauthState = state;
    session.oauthStateExpiry = stateExpiry;
    await session.save();

    // Explicit: once the OAuth App has a second callback URL (the MCP sign-in),
    // GitHub stops matching sub-paths and needs redirect_uri to name one. The
    // callback repeats this exact value in its code exchange.
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: githubCallbackUrl(req),
      scope: "read:user user:email repo workflow read:org",
      allow_signup: "true",
      state,
    });

    return NextResponse.redirect(
      `https://github.com/login/oauth/authorize?${params.toString()}`
    );
  } catch {
    return NextResponse.json({ error: "Failed to initiate OAuth flow" }, { status: 500 });
  }
}
