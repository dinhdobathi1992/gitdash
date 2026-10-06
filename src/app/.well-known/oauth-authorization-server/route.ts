import type { NextRequest } from "next/server";
import { authorizationServerMetadata, mcpGate } from "@/lib/mcp/oauth/config";
import { addCors, corsJson, corsPreflight } from "@/lib/mcp/oauth/headers";

/** RFC 8414 metadata for the MCP authorization server. 404 unless MCP is enabled. */
export function GET(req: NextRequest): Response {
  const gated = mcpGate(req);
  if (gated) return addCors(gated);
  return corsJson(authorizationServerMetadata(), 200, { "Cache-Control": "public, max-age=3600" }, false);
}

export function OPTIONS(req: NextRequest): Response {
  const gated = mcpGate(req);
  return gated ? addCors(gated) : corsPreflight();
}
