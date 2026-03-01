import { NextRequest, NextResponse } from "next/server";
import { unsealData } from "iron-session";
import { SessionData, sessionOptions } from "@/lib/session";
import { isStandaloneMode } from "@/lib/mode";

// Paths that never require auth
const ALWAYS_PUBLIC = ["/_next", "/favicon", "/docs", "/api/webhooks"];

// Mode-specific public paths
const STANDALONE_PUBLIC = ["/setup", "/api/auth/setup"];
const TEAM_PUBLIC = ["/login", "/api/auth/login", "/api/auth/callback"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // MED-003: Redirect HTTP → HTTPS in production (trust x-forwarded-proto from load balancer)
  if (process.env.NODE_ENV === "production") {
    const proto = req.headers.get("x-forwarded-proto");
    if (proto && proto !== "https") {
      const httpsUrl = new URL(req.url);
      httpsUrl.protocol = "https:";
      return NextResponse.redirect(httpsUrl, { status: 301 });
    }
  }

  // Always allow Next.js internals
  if (ALWAYS_PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (isStandaloneMode()) {
    // /login and OAuth routes are not valid in standalone mode
    if (TEAM_PUBLIC.some((p) => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL("/setup", req.url));
    }
    // /setup is always public in standalone
    if (STANDALONE_PUBLIC.some((p) => pathname.startsWith(p))) {
      return NextResponse.next();
    }

    // All other routes require a PAT in the session
    const cookieValue = req.cookies.get(sessionOptions.cookieName)?.value;
    if (!cookieValue) {
      return NextResponse.redirect(new URL("/setup", req.url));
    }
    try {
      const session = await unsealData<SessionData>(cookieValue, {
        password: sessionOptions.password as string,
      });
      if (!session.pat) {
        return NextResponse.redirect(new URL("/setup", req.url));
      }
    } catch {
      return NextResponse.redirect(new URL("/setup", req.url));
    }
    return NextResponse.next();
  }

  // ── Team mode ─────────────────────────────────────────────────────────────
  // /setup is not valid in organization mode
  if (STANDALONE_PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  // OAuth paths are always public
  if (TEAM_PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // All other routes require an OAuth token in the session
  const cookieValue = req.cookies.get(sessionOptions.cookieName)?.value;
  if (!cookieValue) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  try {
    const session = await unsealData<SessionData>(cookieValue, {
      password: sessionOptions.password as string,
    });
    if (!session.accessToken) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  // Exclude Next.js internals AND all static public-folder files (images, fonts, etc.)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf|eot)$).*)"],
};
