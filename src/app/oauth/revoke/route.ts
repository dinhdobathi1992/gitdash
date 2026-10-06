import type { NextRequest } from "next/server";
import { handleRevoke } from "@/lib/mcp/oauth/revoke";
import { addCors, corsPreflight } from "@/lib/mcp/oauth/headers";
import { mcpGate } from "@/lib/mcp/oauth/config";

/** RFC 7009 token revocation. */
export function POST(req: NextRequest): Promise<Response> {
  return handleRevoke(req);
}

export function OPTIONS(req: NextRequest): Response {
  const gated = mcpGate(req);
  return gated ? addCors(gated) : corsPreflight();
}
