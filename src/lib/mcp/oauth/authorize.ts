/**
 * /oauth/authorize and the GitHub callback for the MCP sign-in.
 *
 * Errors found before the redirect URI is validated render an error page and
 * never redirect. After that, errors go back to the client with
 * `error`, `state` and `iss`.
 *
 * The transaction (client, redirect, PKCE challenge, state, resource, and
 * after sign-in the GitHub token and identity) is sealed as `mcp.tx` into a
 * per-nonce cookie `__Host-mcp_tx_<nonce>` (`mcp_tx_<nonce>` on a plain-http
 * site, where the prefix's required Secure flag cannot be set), so parallel
 * sign-ins never collide. The nonce doubles as GitHub's `state`. The web session cookie is only read, for
 * the signed-in shortcut, and never written.
 */

import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { unsealData } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { lookupWhoAmI } from "@/lib/identity";
import { upsertUser } from "@/lib/db";
import { getRateLimitKey, rateLimit } from "@/lib/ratelimit";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { open, seal, TOKEN_TTL_SEC, type TokenPayload } from "./tokens";
import { GITHUB_CALLBACK_PATH, GITHUB_SCOPES, MCP_SCOPE, isOurResource, issuer, mcpGate, resourceUrl, secureCookies } from "./config";
import { matchRedirect, resolveClient, type ResolvedClient, type ValidRedirect } from "./clients";
import { errorPage, escapeHtml, htmlPage, pageHeaders } from "./headers";

const RATE_LIMIT = { limit: 10, windowMs: 60_000 };
const MAX_STATE = 512;
const MAX_REDIRECT = 1024;
/** S256 challenge: base64url of a SHA-256 digest, unpadded, so exactly 43 characters. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
/** Parallel sign-ins allowed per browser; the oldest transaction cookies are dropped beyond this. */
const MAX_TX_COOKIES = 4;
/**
 * The one description for every access_denied sent back to a client, whether
 * the user pressed Deny, cancelled at GitHub, or is outside the allowed
 * organizations: the client must not learn organization membership.
 */
export const ACCESS_DENIED_DESCRIPTION = "access was denied";

// ── Transaction cookie ───────────────────────────────────────────────────────

/** `__Host-` binds the cookie to this exact origin (Secure, Path=/, no Domain); plain http cannot use it. */
export const txCookiePrefix = () => (secureCookies() ? "__Host-mcp_tx_" : "mcp_tx_");
export const txCookieName = (nonce: string) => `${txCookiePrefix()}${nonce}`;
export const isNonce = (v: unknown): v is string => typeof v === "string" && NONCE_RE.test(v);

/*
 * Path is "/" rather than "/oauth": the GitHub callback lives at
 * /api/auth/callback/mcp (fixed by the OAuth App registration) and must read
 * the same cookie. SameSite=Lax still keeps it off cross-site POSTs.
 */
function cookieAttrs(maxAgeSec: number): string {
  return `Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secureCookies() ? "; Secure" : ""}`;
}

export function setTxCookie(headers: Headers, nonce: string, sealed: string, maxAgeSec: number): void {
  headers.append("Set-Cookie", `${txCookieName(nonce)}=${sealed}; ${cookieAttrs(maxAgeSec)}`);
}

export function clearTxCookie(headers: Headers, nonce: string): void {
  headers.append("Set-Cookie", `${txCookieName(nonce)}=; ${cookieAttrs(0)}`);
}

export type Tx = TokenPayload<"mcp.tx">;

/** The live transaction for `nonce`, or null (missing, tampered, expired or for another nonce). */
export async function readTx(req: NextRequest, nonce: unknown): Promise<Tx | null> {
  if (!isNonce(nonce)) return null;
  const tx = await open("mcp.tx", req.cookies.get(txCookieName(nonce))?.value);
  return tx && tx.nonce === nonce ? tx : null;
}

/** Seconds left on a transaction, at least 1. */
export const txRemaining = (tx: Tx) => Math.max(1, tx.exp - Math.floor(Date.now() / 1000));

// ── Redirects back to the client ─────────────────────────────────────────────

/**
 * Send the browser to the client's redirect URI with `params` and `iss`. A
 * custom-scheme (desktop app) redirect is a page with an "Open" link and an
 * automatic location.replace, not a 302, so the browser does not show a bare
 * error when the scheme handler is missing.
 */
export function clientRedirect(
  r: ValidRedirect,
  params: Record<string, string | undefined>,
  headers: Headers = pageHeaders(),
): Response {
  const url = new URL(r.uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  url.searchParams.set("iss", issuer());
  const target = url.toString();
  if (r.kind === "native") {
    const app = r.host.split("://")[0];
    return htmlPage(
      "Return to your app",
      `<h1>Return to your app</h1><p>Your browser should now open <strong>${escapeHtml(app)}</strong>.</p>` +
        `<p class="actions"><a class="button primary" href="${escapeHtml(target)}">Open ${escapeHtml(app)}</a></p>` +
        `<p class="muted">You can close this tab afterwards.</p>`,
      200,
      headers,
      `location.replace(${JSON.stringify(target).replace(/</g, "\\u003c")});`,
    );
  }
  headers.set("Location", target);
  return new Response(null, { status: 302, headers });
}

function redirectTo(path: string, headers: Headers = pageHeaders()): Response {
  headers.set("Location", path.startsWith("http") ? path : `${issuer()}${path}`);
  return new Response(null, { status: 302, headers });
}

// ── Web session (read-only, for the signed-in shortcut) ──────────────────────

async function webOAuthToken(req: NextRequest): Promise<string | null> {
  const raw = req.cookies.get(sessionOptions.cookieName)?.value;
  if (!raw) return null;
  try {
    const s = await unsealData<SessionData>(raw, { password: sessionOptions.password as string });
    // OAuth sessions only: a PAT session goes through GitHub instead, so a
    // personal token is never sealed into tokens handed to a third party.
    return typeof s.accessToken === "string" && s.accessToken && !s.pat ? s.accessToken : null;
  } catch {
    return null;
  }
}

const statusOf = (err: unknown) => (err as { status?: number } | null)?.status;

// ── /oauth/authorize ─────────────────────────────────────────────────────────

export async function handleAuthorize(req: NextRequest): Promise<Response> {
  const gated = mcpGate(req);
  if (gated) return gated;

  const rl = rateLimit(getRateLimitKey(req, "mcp:authorize"), RATE_LIMIT.limit, RATE_LIMIT.windowMs);
  if (!rl.allowed) {
    const res = errorPage(429, "Too many sign-in attempts. Wait a minute and try again.");
    res.headers.set("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)));
    return res;
  }

  const q = req.nextUrl.searchParams;
  const clientId = q.get("client_id");
  const redirectUri = q.get("redirect_uri");
  if (!clientId) return errorPage(400, "The request has no client_id.");
  if (!redirectUri || redirectUri.length > MAX_REDIRECT) return errorPage(400, "The request has no valid redirect_uri.");

  const resolved = await resolveClient(clientId);
  if (!resolved.ok) {
    if (!resolved.busy) return errorPage(400, resolved.error);
    const res = errorPage(503, resolved.error);
    res.headers.set("Retry-After", "5");
    return res;
  }
  const client = resolved.client;
  const redirect = matchRedirect(client, redirectUri);
  if (!redirect) return errorPage(400, "The redirect_uri is not one this app registered, or its form is not allowed.");

  // From here on, errors go back to the client.
  const rawState = q.get("state") ?? undefined;
  if (rawState !== undefined && rawState.length > MAX_STATE) {
    return clientRedirect(redirect, { error: "invalid_request", error_description: "state is too long" });
  }
  const state = rawState;
  const fail = (error: string, description: string) =>
    clientRedirect(redirect, { error, error_description: description, state });

  if (q.get("response_type") !== "code") return fail("unsupported_response_type", "response_type must be code");
  const challenge = q.get("code_challenge");
  if (!challenge || q.get("code_challenge_method") !== "S256") return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
  if (!CHALLENGE_RE.test(challenge)) return fail("invalid_request", "code_challenge is malformed");
  if (!isOurResource(q.get("resource"))) return fail("invalid_target", `resource must be ${resourceUrl()}`);
  const scope = q.get("scope");
  if (scope && scope.split(" ").some((s) => s && s !== MCP_SCOPE)) return fail("invalid_scope", `the only scope is ${MCP_SCOPE}`);

  const nonce = randomBytes(16).toString("hex");
  const txBase = {
    nonce,
    client_id: client.client_id,
    redirect_uri: redirect.uri,
    code_challenge: challenge,
    ...(state !== undefined ? { state } : {}),
    resource: resourceUrl(),
  };

  // Signed-in shortcut: an OAuth web session whose token GitHub still accepts.
  let identity: { gh: string; id: number; login: string } | null = null;
  const webToken = await webOAuthToken(req);
  if (webToken) {
    try {
      const who = await lookupWhoAmI(webToken);
      if (!who.allowed) return fail("access_denied", ACCESS_DENIED_DESCRIPTION);
      identity = { gh: webToken, id: who.identity.id, login: who.identity.login };
    } catch (err) {
      // A revoked web token just means "sign in with GitHub"; anything else is an outage.
      if (statusOf(err) !== 401) return errorPage(503, "GitHub is not reachable right now. Try again in a moment.");
    }
  }

  const ttl = TOKEN_TTL_SEC["mcp.tx"];
  const sealed = await seal("mcp.tx", identity ? { ...txBase, ...identity } : txBase, ttl);
  const headers = pageHeaders();
  await dropExcessTxCookies(req, headers);
  setTxCookie(headers, nonce, sealed, ttl);

  if (identity) return redirectTo(`/oauth/consent?tx=${nonce}`, headers);

  const githubClientId = process.env.GITHUB_CLIENT_ID;
  if (!githubClientId) return errorPage(500, "GitHub sign-in is not configured on this GitDash.");
  const gh = new URLSearchParams({
    client_id: githubClientId,
    redirect_uri: `${issuer()}${GITHUB_CALLBACK_PATH}`,
    scope: GITHUB_SCOPES,
    allow_signup: "true",
    state: nonce,
  });
  return redirectTo(`https://github.com/login/oauth/authorize?${gh.toString()}`, headers);
}

/**
 * Keep the newest MAX_TX_COOKIES - 1 transactions (the new one makes
 * MAX_TX_COOKIES), clearing only the oldest, so cookies cannot pile up and a
 * new sign-in never cancels the other recent ones. Age is the sealed `iat`;
 * cookies that no longer open go first; ties keep the order the browser sent
 * them in (creation order).
 */
async function dropExcessTxCookies(req: NextRequest, headers: Headers): Promise<void> {
  const prefix = txCookiePrefix();
  const existing = req.cookies.getAll().filter((c) => c.name.startsWith(prefix) && isNonce(c.name.slice(prefix.length)));
  const excess = existing.length - (MAX_TX_COOKIES - 1);
  if (excess <= 0) return;
  const aged = await Promise.all(
    existing.map(async (c, order) => {
      const tx = await open("mcp.tx", c.value);
      return { nonce: c.name.slice(prefix.length), iat: tx ? tx.iat : -Infinity, order };
    }),
  );
  aged.sort((a, b) => a.iat - b.iat || a.order - b.order);
  for (const { nonce } of aged.slice(0, excess)) clearTxCookie(headers, nonce);
}

// ── /api/auth/callback/mcp ───────────────────────────────────────────────────

async function exchangeGithubCode(code: string): Promise<string | null> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${issuer()}${GITHUB_CALLBACK_PATH}`,
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: unknown };
  return typeof data.access_token === "string" && data.access_token ? data.access_token : null;
}

/** Re-validate the client and redirect a transaction was created for. */
export async function txClient(tx: Tx): Promise<{ client: ResolvedClient; redirect: ValidRedirect } | null> {
  const resolved = await resolveClient(tx.client_id);
  if (!resolved.ok) return null;
  const redirect = matchRedirect(resolved.client, tx.redirect_uri);
  return redirect ? { client: resolved.client, redirect } : null;
}

export async function handleGithubCallback(req: NextRequest): Promise<Response> {
  const gated = mcpGate(req);
  if (gated) return gated;
  labelGitHubRoute("auth/callback/mcp");

  const q = req.nextUrl.searchParams;
  const nonce = q.get("state");
  const tx = await readTx(req, nonce);
  if (!tx || !nonce) return errorPage(400, "This sign-in expired or was started in another browser.");

  const target = await txClient(tx);
  if (!target) return errorPage(400, "This app can no longer be verified.");
  const headers = pageHeaders();
  clearTxCookie(headers, nonce);
  const deny = (description: string) =>
    clientRedirect(target.redirect, { error: "access_denied", error_description: description, state: tx.state }, headers);

  if (q.get("error")) return deny(ACCESS_DENIED_DESCRIPTION);
  const code = q.get("code");
  if (!code || code.length > 256) return errorPage(400, "GitHub did not return a sign-in code.");

  let gh: string | null;
  try {
    gh = await exchangeGithubCode(code);
  } catch {
    return errorPage(502, "GitHub could not be reached to finish signing in.");
  }
  if (!gh) return errorPage(502, "GitHub did not accept the sign-in code. Start again from your app.");

  let who: Awaited<ReturnType<typeof lookupWhoAmI>>;
  try {
    who = await lookupWhoAmI(gh);
  } catch (err) {
    return statusOf(err) === 401
      ? errorPage(502, "GitHub rejected the new sign-in. Start again from your app.")
      : errorPage(503, "GitHub is not reachable right now. Try again in a moment.");
  }
  if (!who.allowed) return deny(ACCESS_DENIED_DESCRIPTION);

  try {
    await upsertUser({ id: who.identity.id, login: who.identity.login, avatar_url: who.identity.avatar_url });
  } catch {
    return errorPage(503, "GitDash can't reach its database right now. Try again in a moment.");
  }

  const ttl = txRemaining(tx);
  const resealed = await seal("mcp.tx", { ...stripClaims(tx), gh, id: who.identity.id, login: who.identity.login }, ttl);
  const next = pageHeaders();
  setTxCookie(next, nonce, resealed, ttl);
  return redirectTo(`/oauth/consent?tx=${nonce}`, next);
}

/** A transaction payload without the claims `seal` adds. */
export function stripClaims(tx: Tx) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { typ, iat, exp, ...rest } = tx;
  return rest;
}
