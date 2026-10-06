import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import { unsealData } from "iron-session";
import { SessionData, sessionOptions, sessionToken } from "@/lib/session";
import { isStandaloneMode } from "@/lib/mode";
import { publicUrl, isSameOrigin } from "@/lib/url";
import { looksLikeTwin, under } from "@/lib/paths";
import { assertOrgModeConfig } from "@/lib/identity";
import {
  classify,
  decide,
  rbacEnforced,
  resolveAccess,
  resolveIdentity,
  AuthzUnavailableError,
} from "@/lib/permissions";

// Paths that never require auth
// /api/cron is protected by its own CRON_SECRET bearer-token check (see
// src/app/api/cron/sync/route.ts) — it must bypass the session-cookie gate
// here, since Vercel Cron's request carries no session cookie and would
// otherwise be redirected to /login before the route's own auth even runs.
// /welcome is the public product landing page. robots.txt, the sitemap,
// llms.txt and the Open Graph image are discovery files for crawlers and agents.
const ALWAYS_PUBLIC = [
  "/_next", "/favicon.ico", "/docs", "/welcome", "/api/webhooks", "/api/health", "/api/cron",
  "/robots.txt", "/sitemap.xml", "/llms.txt", "/llms-full.txt", "/opengraph-image",
];

// Mode-specific public paths
const STANDALONE_PUBLIC = ["/setup", "/api/auth/setup"];
const TEAM_PUBLIC = ["/login", "/api/auth/login", "/api/auth/callback", "/api/auth/setup"];

/**
 * The product site (gitdash.info) greets signed-out visitors at "/" with the
 * /welcome landing page instead of the sign-in screen. Off by default, so a
 * self-hosted GitDash keeps opening straight to sign-in.
 */
function landingFor(pathname: string): string | null {
  return pathname === "/" && process.env.GITDASH_LANDING_PAGE === "true" ? "/welcome" : null;
}

async function readSession(req: NextRequest): Promise<SessionData | null> {
  const cookieValue = req.cookies.get(sessionOptions.cookieName)?.value;
  if (!cookieValue) return null;
  try {
    return await unsealData<SessionData>(cookieValue, { password: sessionOptions.password as string });
  } catch {
    return null;
  }
}

/** In-process throttle for recording users: at most one DB write per user per 10 minutes. */
const SEEN_EVERY_MS = 10 * 60_000;
const lastRecorded = new Map<number, number>();

function recordSeen(identity: { id: number; login: string; avatar_url: string }, event?: NextFetchEvent): void {
  const now = Date.now();
  if (now - (lastRecorded.get(identity.id) ?? 0) < SEEN_EVERY_MS) return;
  lastRecorded.set(identity.id, now);
  if (lastRecorded.size > 10_000) lastRecorded.clear();
  // Upsert (not update): sessions created before users were recorded still get
  // a row, so an admin can assign them a group. Never blocks the request.
  const write = import("@/lib/db")
    .then((db) => db.upsertUser({ id: identity.id, login: identity.login, avatar_url: identity.avatar_url }))
    .catch(() => lastRecorded.delete(identity.id));
  event?.waitUntil(write);
}

export async function proxy(req: NextRequest, event?: NextFetchEvent) {
  const { pathname } = req.nextUrl;

  // Markdown twins of public pages ("/docs/caching.md") are public too; the
  // /md handler renders them and 404s anything without a public page behind it.
  if (looksLikeTwin(pathname)) {
    return NextResponse.rewrite(new URL(`/md${pathname.replace(/\.md$/, "")}`, req.url));
  }

  // Always allow public paths first — kubelet probes and static assets must
  // never be redirected (they carry no x-forwarded-proto / cookie).
  if (under(pathname, ALWAYS_PUBLIC)) {
    return NextResponse.next();
  }

  // MED-003: Redirect HTTP → HTTPS in production (trust x-forwarded-proto from load balancer)
  if (process.env.NODE_ENV === "production") {
    const proto = req.headers.get("x-forwarded-proto");
    if (proto && proto !== "https") {
      const httpsUrl = publicUrl(pathname + req.nextUrl.search, req);
      httpsUrl.protocol = "https:";
      return NextResponse.redirect(httpsUrl, { status: 301 });
    }
  }

  if (isStandaloneMode()) {
    // /login and OAuth routes are not valid in standalone mode
    if (under(pathname, TEAM_PUBLIC.filter((p) => p !== "/api/auth/setup"))) {
      return NextResponse.redirect(publicUrl("/setup", req));
    }
    // /setup is always public in standalone
    if (under(pathname, STANDALONE_PUBLIC)) {
      return NextResponse.next();
    }

    // All other routes require a PAT in the session
    const session = await readSession(req);
    if (!session?.pat) {
      return NextResponse.redirect(publicUrl(landingFor(pathname) ?? "/setup", req));
    }
    return NextResponse.next();
  }

  // ── Organization mode ─────────────────────────────────────────────────────
  assertOrgModeConfig();
  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  const deny = (status: number, code: string, page: string, extra: Record<string, unknown> = {}) =>
    isApi
      ? NextResponse.json({ error: code === "unauthorized" ? "Unauthorized" : "Forbidden", code, ...extra }, { status })
      : NextResponse.redirect(publicUrl(page, req));

  // Sign-in endpoints are public (the PAT endpoint does its own Origin check)
  if (under(pathname, TEAM_PUBLIC)) {
    return NextResponse.next();
  }
  // The /setup page is standalone-only; organization mode signs in on /login
  if (under(pathname, ["/setup"])) {
    return NextResponse.redirect(publicUrl("/login", req));
  }

  // Cross-site writes: a browser always sends Origin on a cross-site POST.
  if (isApi && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden", code: "cross_origin" }, { status: 403 });
  }
  // Signing out must always work — even for a refused account or during an outage.
  if (pathname === "/api/auth/logout") {
    return NextResponse.next();
  }

  const session = await readSession(req);
  const token = session ? sessionToken(session) : null;
  if (!token) {
    const landing = landingFor(pathname);
    return landing ? NextResponse.redirect(publicUrl(landing, req)) : deny(401, "unauthorized", "/login");
  }

  try {
    const { identity, allowed } = await resolveIdentity(token);
    if (!allowed) {
      const res = deny(403, "org_not_allowed", "/login?error=org_not_allowed");
      res.cookies.delete(sessionOptions.cookieName);
      return res;
    }

    const cls = classify(pathname, req.method);
    const enforce = rbacEnforced();
    // Groups/grants are only needed for admin routes, or for everything once
    // enforcement is on — so during rollout a DB outage cannot take the app down.
    const needAccess = cls === "admin" || (enforce && cls !== "public" && cls !== "auth");
    const access = needAccess ? await resolveAccess(identity.id) : null;
    const d = decide(cls, access, enforce);

    recordSeen(identity, event);

    if (d.ok) return NextResponse.next();
    if (d.code === "no_groups") return deny(403, "no_groups", "/pending");
    if (d.code === "unregistered") return deny(403, "unregistered", "/");
    return deny(403, "forbidden", "/", d.flag ? { flag: d.flag } : {});
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      // Token revoked or expired: drop the session and start over.
      const res = deny(401, "unauthorized", "/login");
      res.cookies.delete(sessionOptions.cookieName);
      return res;
    }
    if (err instanceof AuthzUnavailableError) {
      return isApi
        ? NextResponse.json({ error: "Service unavailable", code: "authz_unavailable" }, { status: 503 })
        : new NextResponse("Permissions are temporarily unavailable. Please retry in a moment.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "30" },
          });
    }
    throw err;
  }
}

export const config = {
  // Exclude Next.js internals, and static public-folder files (images, fonts,
  // media) — but never anything under /api, which must always be checked.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico$|(?!api/)[^?]*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav)$).*)",
  ],
};
