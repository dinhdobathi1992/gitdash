import type { NextRequest } from "next/server";
import { registerClient } from "@/lib/mcp/oauth/clients";
import { dcrEnabled, mcpGate } from "@/lib/mcp/oauth/config";
import { addCors, corsJson, corsPreflight, oauthError } from "@/lib/mcp/oauth/headers";
import { getRateLimitKey, rateLimit } from "@/lib/ratelimit";

/**
 * RFC 7591 Dynamic Client Registration, stateless. Only when
 * MCP_ALLOW_DCR=true (default off); otherwise 404 like any unknown route.
 */
const RATE_LIMIT = { limit: 10, windowMs: 60 * 60_000 };
const MAX_BODY = 16 * 1024;

function gate(req: NextRequest): Response | null {
  const gated = mcpGate(req);
  if (gated) return addCors(gated);
  if (!dcrEnabled()) return corsJson({ error: "not_found" }, 404);
  return null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = gate(req);
  if (denied) return denied;

  const rl = rateLimit(getRateLimitKey(req, "mcp:register"), RATE_LIMIT.limit, RATE_LIMIT.windowMs);
  if (!rl.allowed) {
    return oauthError("temporarily_unavailable", "Too many registrations.", 429, {
      "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
    });
  }
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return oauthError("invalid_client_metadata", "Send the client metadata as application/json.");
  }
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return oauthError("invalid_client_metadata", "Request too large.");
    body = JSON.parse(text);
  } catch {
    return oauthError("invalid_client_metadata", "The body is not valid JSON.");
  }
  const result = await registerClient(body);
  if (!result.ok) return oauthError(result.error, result.description);
  return corsJson(result.body, 201);
}

export function OPTIONS(req: NextRequest): Response {
  return gate(req) ?? corsPreflight();
}
