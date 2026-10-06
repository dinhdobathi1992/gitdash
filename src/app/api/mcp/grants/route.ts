/**
 * GET /api/mcp/grants — the signed-in user's connected AI apps (redeemed,
 * active grants). `?all=1` returns every user's grants; admins only,
 * re-checked here. 404 when MCP is disabled.
 */
import { NextRequest, NextResponse } from "next/server";
import { currentIdentity, requireAccess } from "@/lib/permissions";
import { mcpEnabled } from "@/lib/mcp/oauth/config";
import { listGrants } from "@/lib/mcp/oauth/grants";
import { listAllActiveGrants } from "@/lib/mcp/oauth/grants-admin";
import { noStoreHeaders } from "@/lib/http-cache";
import { safeError } from "@/lib/validation";

export async function GET(req: NextRequest) {
  if (!mcpEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStoreHeaders() });
  const all = req.nextUrl.searchParams.get("all") === "1";
  const denied = await requireAccess(req, all ? "admin" : "auth");
  if (denied) return denied;
  try {
    if (all) return NextResponse.json({ grants: await listAllActiveGrants() }, { headers: noStoreHeaders() });
    const { id } = await currentIdentity();
    return NextResponse.json({ grants: await listGrants(id) }, { headers: noStoreHeaders() });
  } catch (e) {
    return safeError(e, "Failed to list connected apps");
  }
}
