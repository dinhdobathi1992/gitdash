import type { NextRequest } from "next/server";
import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";
import { issuer, mcpGate, RESOURCE_PATH, resourceUrl } from "@/lib/mcp/oauth/config";
import { addCors, corsJson } from "@/lib/mcp/oauth/headers";

/**
 * RFC 9728 metadata for /mcp/me, at the path-inserted URL
 * /.well-known/oauth-protected-resource/mcp/me. The resource URL is explicit
 * (from NEXT_PUBLIC_APP_URL), never derived from forwarded headers.
 */
type Ctx = { params: Promise<{ path: string[] }> };

async function gate(req: NextRequest, ctx: Ctx): Promise<Response | null> {
  const gated = mcpGate(req);
  if (gated) return addCors(gated);
  const { path } = await ctx.params;
  if (`/${path.join("/")}` !== RESOURCE_PATH) return corsJson({ error: "not_found" }, 404);
  return null;
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const denied = await gate(req, ctx);
  if (denied) return denied;
  return protectedResourceHandler({ authServerUrls: [issuer()], resourceUrl: resourceUrl() })(req);
}

export async function OPTIONS(req: NextRequest, ctx: Ctx): Promise<Response> {
  return (await gate(req, ctx)) ?? metadataCorsOptionsRequestHandler()();
}
