/**
 * /oauth/token: authorization_code (PKCE S256) and refresh_token grants.
 *
 * Codes are validated in full before they are consumed, so a wrong verifier
 * cannot burn the real client's code; a code presented twice revokes its
 * grant. A refresh re-checks the user with GitHub first: a revoked GitHub
 * token or a user who left the allowed organizations revokes the grant, and
 * an outage answers 503 rather than a fake invalid_grant.
 *
 * Every response is no-store and carries CORS headers.
 */

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { lookupWhoAmI } from "@/lib/identity";
import { getRateLimitKey, rateLimit } from "@/lib/ratelimit";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { consumeJti, redeemGrant, revokeGrant, rotateRefresh, type RevokeReason } from "./grants";
import { auditMcp, type McpAuditAction } from "./audit";
import { CLOCK_TOLERANCE_SEC, open, seal, TOKEN_TTL_SEC } from "./tokens";
import { MCP_SCOPE, isOurResource, mcpGate, normalizeUrl } from "./config";
import { addCors, corsJson, oauthError } from "./headers";

const IP_LIMIT = { limit: 120, windowMs: 60_000 };
const GRANT_LIMIT = { limit: 60, windowMs: 60_000 };
const MAX_BODY = 32 * 1024;
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const RETRY_AFTER = { "Retry-After": "5" };

const unavailable = () => oauthError("temporarily_unavailable", "Try again shortly.", 503, RETRY_AFTER);
const invalidGrant = (d: string) => oauthError("invalid_grant", d);

/** Best effort: an audit failure never blocks the protocol, but is logged (without content). */
async function audit(action: McpAuditAction, actor: number, grantId: string, details: Record<string, string> = {}): Promise<void> {
  try {
    await auditMcp(action, actor, grantId, details);
  } catch (err) {
    console.error(`[mcp] audit ${action} failed: ${(err as Error).name}`);
  }
}

/** Revoke and audit; database errors propagate (the caller answers 503). */
async function revokeWithAudit(grantId: string, actor: number, reason: RevokeReason, action: McpAuditAction): Promise<void> {
  await revokeGrant(grantId, reason);
  await audit(action, actor, grantId, { reason });
}

function pkceMatches(verifier: string, challenge: string): boolean {
  if (!VERIFIER_RE.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

async function readForm(req: NextRequest): Promise<URLSearchParams | null> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  return new URLSearchParams(text);
}

/** One value per parameter (RFC 6749 §3.2: parameters must not repeat). */
function single(form: URLSearchParams, name: string): string | null | undefined {
  const all = form.getAll(name);
  if (all.length > 1) return undefined;
  return all[0] ?? null;
}

async function issueTokens(p: {
  grant_id: string;
  client_id: string;
  aud: string;
  refresh_jti: string;
  gh: string;
  id: number;
  login: string;
}): Promise<Response> {
  const identity = { gh: p.gh, id: p.id, login: p.login };
  const accessTtl = TOKEN_TTL_SEC["mcp.access"];
  const [access, refresh] = await Promise.all([
    seal("mcp.access", { grant_id: p.grant_id, client_id: p.client_id, aud: p.aud, scope: MCP_SCOPE, ...identity }, accessTtl),
    seal("mcp.refresh", { jti: p.refresh_jti, grant_id: p.grant_id, client_id: p.client_id, aud: p.aud, ...identity }, TOKEN_TTL_SEC["mcp.refresh"]),
  ]);
  await audit("mcp.token_issued", p.id, p.grant_id);
  return corsJson({ access_token: access, token_type: "Bearer", expires_in: accessTtl, refresh_token: refresh, scope: MCP_SCOPE });
}

async function authorizationCode(form: URLSearchParams): Promise<Response> {
  const code = single(form, "code");
  const verifier = single(form, "code_verifier");
  const clientId = single(form, "client_id");
  const redirectUri = single(form, "redirect_uri");
  const resource = single(form, "resource");
  if (!code || !verifier || !clientId || !redirectUri) {
    return oauthError("invalid_request", "code, code_verifier, client_id and redirect_uri are required");
  }
  const c = await open("mcp.code", code);
  if (!c) return invalidGrant("The code is invalid or expired.");

  // Validate everything before consuming the code.
  if (c.client_id !== clientId) return invalidGrant("The code was issued to another client.");
  if (c.redirect_uri !== redirectUri) return invalidGrant("redirect_uri does not match the authorization request.");
  if (!isOurResource(resource) || normalizeUrl(resource) !== normalizeUrl(c.resource)) {
    return oauthError("invalid_target", "resource does not match the authorization request");
  }
  if (!pkceMatches(verifier, c.code_challenge)) return invalidGrant("code_verifier does not match the code_challenge.");

  try {
    const first = await consumeJti(c.jti, new Date((c.exp + CLOCK_TOLERANCE_SEC + 60) * 1000));
    if (!first) {
      await revokeWithAudit(c.grant_id, c.id, "code_reuse", "mcp.code_reuse");
      return invalidGrant("The code was already used; the connection has been revoked.");
    }
    if (!(await redeemGrant(c.grant_id, c.refresh_jti))) return invalidGrant("The connection is no longer active.");
  } catch {
    return unavailable();
  }
  return issueTokens({ grant_id: c.grant_id, client_id: c.client_id, aud: c.resource, refresh_jti: c.refresh_jti, gh: c.gh, id: c.id, login: c.login });
}

async function refreshToken(form: URLSearchParams): Promise<Response> {
  const token = single(form, "refresh_token");
  const clientId = single(form, "client_id");
  const resource = single(form, "resource");
  if (!token || !clientId) return oauthError("invalid_request", "refresh_token and client_id are required");
  const r = await open("mcp.refresh", token);
  if (!r || r.client_id !== clientId) return invalidGrant("The refresh token is invalid or expired.");
  if (resource !== null && resource !== undefined && (!isOurResource(resource) || normalizeUrl(resource) !== normalizeUrl(r.aud))) {
    return oauthError("invalid_target", "resource does not match the grant");
  }

  const rl = rateLimit(`mcp:token:${r.grant_id}`, GRANT_LIMIT.limit, GRANT_LIMIT.windowMs);
  if (!rl.allowed) {
    return oauthError("temporarily_unavailable", "Too many token requests.", 429, { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)) });
  }

  labelGitHubRoute("mcp/oauth-token");
  try {
    let who: Awaited<ReturnType<typeof lookupWhoAmI>>;
    try {
      who = await lookupWhoAmI(r.gh);
    } catch (err) {
      if ((err as { status?: number } | null)?.status === 401) {
        await revokeWithAudit(r.grant_id, r.id, "github_revoked", "mcp.github_revoked");
        return invalidGrant("GitHub no longer accepts this sign-in; the connection has been revoked.");
      }
      return unavailable();
    }
    if (who.identity.id !== r.id) {
      // The sealed GitHub token now answers for another account: never continue with it.
      await revokeWithAudit(r.grant_id, r.id, "github_revoked", "mcp.github_revoked");
      return invalidGrant("GitHub no longer accepts this sign-in; the connection has been revoked.");
    }
    if (!who.allowed) {
      await revokeWithAudit(r.grant_id, r.id, "org_removed", "mcp.org_removed");
      return invalidGrant("This GitHub account is no longer allowed on this GitDash; the connection has been revoked.");
    }

    const next = randomUUID();
    const rotated = await rotateRefresh(r.grant_id, r.jti, next);
    if (rotated.outcome === "reuse") {
      await audit("mcp.refresh_reuse", r.id, r.grant_id);
      return invalidGrant("The refresh token was already used; the connection has been revoked.");
    }
    if (rotated.outcome !== "ok") return invalidGrant("The connection is no longer active.");
    // A retry inside the grace window gets the id the first request issued, not a new one.
    return issueTokens({ grant_id: r.grant_id, client_id: r.client_id, aud: r.aud, refresh_jti: rotated.refreshJti, gh: r.gh, id: r.id, login: r.login });
  } catch {
    return unavailable();
  }
}

export async function handleToken(req: NextRequest): Promise<Response> {
  const gated = mcpGate(req);
  if (gated) return addCors(gated);

  const ipLimit = rateLimit(getRateLimitKey(req, "mcp:token"), IP_LIMIT.limit, IP_LIMIT.windowMs);
  if (!ipLimit.allowed) {
    return oauthError("temporarily_unavailable", "Too many token requests.", 429, { "Retry-After": String(Math.ceil((ipLimit.retryAfterMs ?? 60_000) / 1000)) });
  }

  let form: URLSearchParams | null;
  try {
    form = await readForm(req);
  } catch {
    form = null;
  }
  if (!form) return oauthError("invalid_request", "Send application/x-www-form-urlencoded parameters.");

  const grantType = single(form, "grant_type");
  if (grantType === "authorization_code") return authorizationCode(form);
  if (grantType === "refresh_token") return refreshToken(form);
  return oauthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
}
