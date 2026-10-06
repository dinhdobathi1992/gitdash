import { NextRequest, NextResponse } from "next/server";
import { getSession, resetSession } from "@/lib/session";
import { assertOrgModeConfig, lookupWhoAmI } from "@/lib/identity";
import { upsertUser } from "@/lib/db";
import { publicUrl } from "@/lib/url";
import { labelGitHubRoute } from "@/lib/github-telemetry";

export async function GET(req: NextRequest) {
  labelGitHubRoute("auth/callback");
  assertOrgModeConfig();
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(publicUrl("/login?error=access_denied", req));
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
    return NextResponse.redirect(publicUrl("/login?error=state_mismatch", req));
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
    return NextResponse.redirect(publicUrl("/login?error=state_expired", req));
  }

  // Clear the one-time state token immediately (already good ✅)
  session.oauthState = undefined;
  session.oauthStateExpiry = undefined;

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(publicUrl("/login?error=config", req));
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      // The same redirect_uri the login sent (required once the OAuth App has
      // more than one callback URL).
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: publicUrl("/api/auth/callback", req).toString(),
      }),
    });
    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      return NextResponse.redirect(publicUrl("/login?error=token_exchange", req));
    }

    // Fetch user identity + allowed-org membership
    const { identity, allowed } = await lookupWhoAmI(tokenData.access_token);
    if (!allowed) {
      await session.save(); // persist the cleared one-time state
      return NextResponse.redirect(publicUrl("/login?error=org_not_allowed", req));
    }

    // Record the user before issuing the session (see /api/auth/setup)
    await upsertUser({ id: identity.id, login: identity.login, avatar_url: identity.avatar_url });

    // Fresh session holding only this login (no leftover PAT from an earlier sign-in)
    resetSession(session);
    session.accessToken = tokenData.access_token;
    session.user = {
      id: identity.id,
      login: identity.login,
      name: identity.name,
      avatar_url: identity.avatar_url,
      email: identity.email,
    };
    await session.save();

    return NextResponse.redirect(publicUrl("/", req));
  } catch {
    return NextResponse.redirect(publicUrl("/login?error=server", req));
  }
}
