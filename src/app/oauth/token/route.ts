import type { NextRequest } from "next/server";
import { handleToken } from "@/lib/mcp/oauth/token";
import { addCors, corsPreflight } from "@/lib/mcp/oauth/headers";
import { mcpGate } from "@/lib/mcp/oauth/config";

/** OAuth 2.1 token endpoint: authorization_code (PKCE) and refresh_token grants. */
export function POST(req: NextRequest): Promise<Response> {
  return handleToken(req);
}

export function OPTIONS(req: NextRequest): Response {
  const gated = mcpGate(req);
  return gated ? addCors(gated) : corsPreflight();
}
