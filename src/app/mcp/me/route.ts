import type { NextRequest } from "next/server";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { handleMeRequest } from "@/lib/mcp/server";
import { preflight, tooManyRequests, withCors } from "@/lib/mcp/http";
import { authUnavailable, bearerToken, touchGrant, unauthorized, verifyToken } from "@/lib/mcp/auth";
import { mcpGate } from "@/lib/mcp/oauth/config";
import { getRateLimitKey, rateLimit } from "@/lib/ratelimit";

/**
 * Signed-in MCP endpoint (Streamable HTTP, stateless): docs tools plus the
 * read-only data tools. This wrapper owns the status codes:
 *  - no bearer token        -> 401 with WWW-Authenticate resource_metadata (starts OAuth)
 *  - invalid token          -> 401 error="invalid_token"
 *  - grant store unavailable -> 503 Retry-After (never a fake 401)
 * Limits (per instance, best effort): 60 requests a minute per grant; 120 a
 * minute per IP for requests without a valid token.
 */
const GRANT_LIMIT = { limit: 60, windowMs: 60_000 };
const IP_LIMIT = { limit: 120, windowMs: 60_000 };

function unauthenticatedLimited(req: NextRequest): Response | null {
  const rl = rateLimit(getRateLimitKey(req, "mcp:me:anon"), IP_LIMIT.limit, IP_LIMIT.windowMs);
  return rl.allowed ? null : tooManyRequests(rl.retryAfterMs);
}

async function handle(req: NextRequest): Promise<Response> {
  const gated = mcpGate(req);
  if (gated) return withCors(gated);

  const token = bearerToken(req);
  if (token === null) return unauthenticatedLimited(req) ?? unauthorized(false);

  const v = token ? await verifyToken(token) : ({ ok: false, reason: "invalid" } as const);
  if (!v.ok) {
    if (v.reason === "unavailable") return authUnavailable();
    return unauthenticatedLimited(req) ?? unauthorized(true);
  }

  const rl = rateLimit(`mcp:me:grant:${v.authInfo.extra.grant_id}`, GRANT_LIMIT.limit, GRANT_LIMIT.windowMs);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  touchGrant(v.authInfo.extra.grant_id);
  // mcp-handler passes `req.auth` to the SDK, which exposes it as ctx.http.authInfo.
  (req as NextRequest & { auth?: AuthInfo }).auth = v.authInfo;
  return withCors(await handleMeRequest(req, req.nextUrl.origin));
}

export { handle as GET, handle as POST, handle as DELETE };

export function OPTIONS(req: NextRequest): Response {
  const gated = mcpGate(req);
  return gated ? withCors(gated) : preflight();
}
