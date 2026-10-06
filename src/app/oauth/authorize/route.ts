import type { NextRequest } from "next/server";
import { handleAuthorize } from "@/lib/mcp/oauth/authorize";

/** OAuth 2.1 authorization endpoint for MCP clients (browser). */
export function GET(req: NextRequest): Promise<Response> {
  return handleAuthorize(req);
}
