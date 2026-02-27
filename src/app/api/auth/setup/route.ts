import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isStandaloneMode } from "@/lib/mode";
import { getOctokit } from "@/lib/github";
import { rateLimit, getRateLimitKey } from "@/lib/ratelimit";

// HIGH-002: 5 attempts per minute per IP on the PAT setup endpoint
const RATE_LIMIT = { limit: 5, windowMs: 60_000 };

export async function POST(req: NextRequest) {
  if (!isStandaloneMode()) {
    return NextResponse.json({ error: "Not available in organization mode" }, { status: 404 });
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
  try {
    const octokit = getOctokit(pat);
    const { data } = await octokit.rest.users.getAuthenticated();

    const session = await getSession();
    session.pat = pat;
    session.user = {
      login: data.login,
      name: data.name ?? null,
      avatar_url: data.avatar_url,
      email: data.email ?? null,
    };
    await session.save();

    return NextResponse.json({
      ok: true,
      user: session.user,
    });
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
}

// DELETE — clear the PAT from session (change / remove token)
export async function DELETE(req: NextRequest) {
  if (!isStandaloneMode()) {
    return NextResponse.json({ error: "Not available in organization mode" }, { status: 404 });
  }
  try {
    const session = await getSession();
    session.pat = undefined;
    session.user = undefined;
    await session.save();
    return NextResponse.redirect(new URL("/setup", req.url));
  } catch {
    return NextResponse.redirect(new URL("/setup", req.url));
  }
}
