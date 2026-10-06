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

// DELETE (legacy session teardown) also goes to the handler, which answers 405 —
// the server is stateless — but with CORS headers a browser client can read.
export { handle as GET, handle as POST, handle as DELETE };

export function OPTIONS(): Response {
  return preflight();
}
