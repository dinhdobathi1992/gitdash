/**
 * HTTP edges shared by the MCP endpoints: CORS (MCP clients may run in a
 * browser) and the rate-limit response. These routes are excluded from the
 * global headers in next.config.ts, so these are the only CORS headers sent.
 */

export const MCP_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  // The 2026-07-28 revision mirrors request fields into headers (Mcp-Method,
  // Mcp-Name, Mcp-Param-*), so allow any header; "*" never covers
  // Authorization, which is listed explicitly. No credentials are involved.
  "Access-Control-Allow-Headers": "Authorization, *",
  "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

/** Copy a response, adding the MCP CORS headers. */
export function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(MCP_CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
}

/** JSON-RPC error body with HTTP 429; the request id is unknown at this point. */
export function tooManyRequests(retryAfterMs: number | undefined): Response {
  return withCors(
    new Response(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests. Slow down and retry." } }),
      {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": String(Math.ceil((retryAfterMs ?? 60_000) / 1000)) },
      },
    ),
  );
}
