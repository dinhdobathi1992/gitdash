import { SessionOptions, getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { isStandaloneMode } from "@/lib/mode";

export interface SessionData {
  // organization mode: OAuth access token
  accessToken?: string;
  // standalone mode: user-provided PAT
  pat?: string;
  // OAuth CSRF state (organization mode only)
  oauthState?: string;
  // Expiry timestamp for oauthState (ms since epoch)
  oauthStateExpiry?: number;
  // cached GitHub user identity (both modes)
  user?: {
    login: string;
    name: string | null;
    avatar_url: string;
    email: string | null;
  };
}

// CRIT-002: Fail loudly in production if SESSION_SECRET is missing or too short.
const SESSION_SECRET = (() => {
  const secret = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!secret || secret.length < 32) {
      throw new Error(
        "[GitDash] SESSION_SECRET must be set to a string of at least 32 characters in production. " +
        "Generate one with: openssl rand -hex 32"
      );
    }
  } else if (!secret || secret.length < 32) {
    // Development: warn, use insecure fallback
    console.warn(
      "[GitDash] WARNING: SESSION_SECRET is missing or shorter than 32 chars. " +
      "Using dev fallback — NEVER deploy this to production."
    );
  }
  return secret ?? "fallback-dev-secret-change-in-production!!";
})();

export const sessionOptions: SessionOptions = {
  cookieName: "gitdash_session",
  password: SESSION_SECRET,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

/** Get session from a Next.js server component or route handler. */
export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/**
 * Return the GitHub token for the current request.
 *
 * standalone    → session.pat          (user entered their own PAT on /setup)
 * organization  → session.accessToken  (OAuth token from GitHub)
 */
export async function getTokenFromSession(): Promise<string | null> {
  const session = await getSession();
  if (isStandaloneMode()) return session.pat ?? null;
  return session.accessToken ?? null;
}
