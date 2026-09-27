import { NextRequest, NextResponse } from "next/server";
import { getSession, resetSession } from "@/lib/session";
import { isStandaloneMode } from "@/lib/mode";
import { rateLimit, getRateLimitKey } from "@/lib/ratelimit";
import { publicUrl, isSameOrigin } from "@/lib/url";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { assertOrgModeConfig, lookupWhoAmI } from "@/lib/identity";
import { upsertUser } from "@/lib/db";

// HIGH-002: 5 attempts per minute per IP on the PAT setup endpoint
const RATE_LIMIT = { limit: 5, windowMs: 60_000 };

/**
 * POST — sign in with a GitHub Personal Access Token.
 *
 * standalone   : the PAT is the only sign-in method (/setup).
 * organization : alternative to OAuth on /login. The account must pass the
 *                GITDASH_ALLOWED_ORGS check and is recorded in `users`; access
 *                to features is then decided by its groups.
 */
export async function POST(req: NextRequest) {
  labelGitHubRoute("auth/setup");
  const orgMode = !isStandaloneMode();
  if (orgMode) assertOrgModeConfig();

  // Login CSRF: only accept JSON from this app's own pages. A cross-site form
  // cannot set Content-Type: application/json without a CORS preflight.
  if (!isSameOrigin(req) || !req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Rate limit by IP
  const rl = rateLimit(getRateLimitKey(req, "auth:setup"), RATE_LIMIT.limit, RATE_LIMIT.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)) } }
    );
  }

  let pat: string;
  try {
    const body = await req.json();
    pat = (body.pat ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!pat) {
    return NextResponse.json({ error: "PAT is required" }, { status: 400 });
  }

  // Validate the PAT against GitHub — also fetches user identity to cache
  let who;
  try {
    who = await lookupWhoAmI(pat);
  } catch {
    // LOW-002: Log invalid PAT attempt server-side
    console.warn("[security] Invalid PAT submitted to /api/auth/setup", {
      event: "invalid_pat",
      ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown",
      ts: new Date().toISOString(),
    });
    // MED-002: Don't expose the raw GitHub error to the client
    return NextResponse.json(
      { error: "Invalid token — could not authenticate with GitHub. Check scopes and try again." },
      { status: 401 }
    );
  }

  if (orgMode && !who.allowed) {
    return NextResponse.json(
      {
        error:
          "This account is not a member of an allowed organization, or the token lacks read:org " +
          "(classic) / Members: read (fine-grained).",
      },
      { status: 403 },
    );
  }

  const { identity } = who;
  // Record the user before issuing the session: a DB failure must not leave a
  // signed-in account that admins cannot see or assign.
  if (orgMode) {
    await upsertUser({ id: identity.id, login: identity.login, avatar_url: identity.avatar_url });
  }
  const session = await getSession();
  resetSession(session);
  session.pat = pat;
  session.user = {
    id: identity.id,
    login: identity.login,
    name: identity.name,
    avatar_url: identity.avatar_url,
    email: identity.email,
  };
  await session.save();

  return NextResponse.json({ ok: true, user: session.user });
}

// DELETE — clear the PAT from session (change / remove token)
export async function DELETE(req: NextRequest) {
  labelGitHubRoute("auth/setup");
  if (!isStandaloneMode()) {
    return NextResponse.json({ error: "Not available in organization mode" }, { status: 404 });
  }
  try {
    const session = await getSession();
    session.pat = undefined;
    session.user = undefined;
    await session.save();
    return NextResponse.redirect(publicUrl("/setup", req));
  } catch {
    return NextResponse.redirect(publicUrl("/setup", req));
  }
}
