import { NextRequest } from "next/server";
import { docsHandler } from "@/lib/mcp/server";
import { preflight, tooManyRequests, withCors } from "@/lib/mcp/http";
import { getRateLimitKey, rateLimit } from "@/lib/ratelimit";

/**
 * Public MCP endpoint (Streamable HTTP, stateless): GitDash docs tools, no
 * sign-in. Rate limit is per IP and per instance, best effort, with a high
 * ceiling because hosted connectors share egress IPs.
 */
const RATE_LIMIT = { limit: 300, windowMs: 60_000 };

async function handle(req: NextRequest): Promise<Response> {
  const rl = rateLimit(getRateLimitKey(req, "mcp"), RATE_LIMIT.limit, RATE_LIMIT.windowMs);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);
  return withCors(await docsHandler(req.nextUrl.origin)(req));
}

export { handle as GET, handle as POST };

export function OPTIONS(): Response {
  return preflight();
}
