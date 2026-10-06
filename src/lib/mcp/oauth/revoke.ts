/**
 * /oauth/revoke (RFC 7009). Accepts a refresh token, an access token or a
 * personal MCP key and revokes the whole grant. Unknown, invalid or foreign tokens still get 200, as the RFC
 * requires; only a database outage answers 503 (RFC 7009 §2.2.1), so a client
 * never believes a revocation happened when it did not.
 */

import type { NextRequest } from "next/server";
import { getRateLimitKey, rateLimit } from "@/lib/ratelimit";
import { revokeGrant } from "./grants";
import { auditMcp } from "./audit";
import { open } from "./tokens";
import { mcpGate } from "./config";
import { addCors, corsJson, oauthError, readBodyCapped } from "./headers";

const IP_LIMIT = { limit: 120, windowMs: 60_000 };
const MAX_BODY = 32 * 1024;

const ok = () => corsJson({}, 200);

export async function handleRevoke(req: NextRequest): Promise<Response> {
  const gated = mcpGate(req);
  if (gated) return addCors(gated);

  const rl = rateLimit(getRateLimitKey(req, "mcp:revoke"), IP_LIMIT.limit, IP_LIMIT.windowMs);
  if (!rl.allowed) {
    return oauthError("temporarily_unavailable", "Too many requests.", 429, { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)) });
  }

  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "Send application/x-www-form-urlencoded parameters.");
  }
  const body = await readBodyCapped(req, MAX_BODY);
  if (!body.ok) {
    return body.status === 413
      ? oauthError("invalid_request", "Request too large.", 413)
      : oauthError("invalid_request", "Unreadable request body.");
  }
  const form = new URLSearchParams(body.text);
  const token = form.get("token");
  if (!token) return oauthError("invalid_request", "token is required");
  const clientId = form.get("client_id");

  const hint = form.get("token_type_hint");
  const order = hint === "access_token" ? (["mcp.access", "mcp.refresh"] as const) : (["mcp.refresh", "mcp.access"] as const);
  let found: { grant_id: string; client_id: string | null; id: number } | null = null;
  for (const typ of order) {
    found = await open(typ, token);
    if (found) break;
  }
  if (!found) {
    // A personal key has no OAuth client: whoever holds it may revoke it, so
    // the client_id check below does not apply to it.
    const key = await open("mcp.key", token);
    if (key) found = { grant_id: key.grant_id, client_id: null, id: key.id };
  }
  // A token issued to another client is not this caller's to revoke.
  if (!found || (clientId && found.client_id !== null && clientId !== found.client_id)) return ok();

  try {
    if (await revokeGrant(found.grant_id, "client_revoked")) {
      await auditMcp("mcp.grant_revoked", found.id, found.grant_id, { reason: "client_revoked" }).catch((err: Error) =>
        console.error(`[mcp] audit mcp.grant_revoked failed: ${err.name}`),
      );
    }
  } catch {
    return oauthError("temporarily_unavailable", "Try again shortly.", 503, { "Retry-After": "5" });
  }
  return ok();
}
