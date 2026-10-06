import type { NextRequest } from "next/server";
import { handleGithubCallback } from "@/lib/mcp/oauth/authorize";

/**
 * GitHub OAuth callback for the MCP sign-in (a second, explicit callback URL on
 * the OAuth App). Never reads or writes the web session cookie.
 */
export function GET(req: NextRequest): Promise<Response> {
  return handleGithubCallback(req);
}
