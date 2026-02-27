import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getOctokit } from "@/lib/github";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL("/login?error=access_denied", req.url));
  }

  // Validate CSRF state token
  const session = await getSession();
  if (!state || !session.oauthState || state !== session.oauthState) {
    // LOW-002: Log security event server-side without leaking details to client
    console.warn("[security] OAuth state mismatch", {
      event: "oauth_state_mismatch",
      hasState: Boolean(state),
      hasSessionState: Boolean(session.oauthState),
      ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown",
      ts: new Date().toISOString(),
    });
    return NextResponse.redirect(new URL("/login?error=state_mismatch", req.url));
  }

  // HIGH-004: Reject state tokens older than 5 minutes
  if (session.oauthStateExpiry && Date.now() > session.oauthStateExpiry) {
    // LOW-002: Log expired state security event
    console.warn("[security] OAuth state token expired", {
      event: "oauth_state_expired",
      ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown",
      ts: new Date().toISOString(),
    });
    session.oauthState = undefined;
    session.oauthStateExpiry = undefined;
    await session.save();
    return NextResponse.redirect(new URL("/login?error=state_expired", req.url));
  }

  // Clear the one-time state token immediately (already good ✅)
  session.oauthState = undefined;
  session.oauthStateExpiry = undefined;

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/login?error=config", req.url));
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      return NextResponse.redirect(new URL("/login?error=token_exchange", req.url));
    }

    // Fetch user identity
    const octokit = getOctokit(tokenData.access_token);
    const { data: user } = await octokit.rest.users.getAuthenticated();

    // Persist into encrypted session cookie
    session.accessToken = tokenData.access_token;
    session.user = {
      login: user.login,
      name: user.name ?? null,
      avatar_url: user.avatar_url,
      email: user.email ?? null,
    };
    await session.save();

    return NextResponse.redirect(new URL("/", req.url));
  } catch {
    return NextResponse.redirect(new URL("/login?error=server", req.url));
  }
}
