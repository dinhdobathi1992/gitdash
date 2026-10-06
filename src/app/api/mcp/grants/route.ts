/**
 * GET /api/mcp/grants — the signed-in user's connected AI apps and personal
 * MCP keys (redeemed, active grants). `?all=1` returns every user's grants;
 * admins only, re-checked here, and never in standalone mode (no admins
 * there: each person brings their own PAT). 404 when MCP is disabled.
 */
import { NextRequest, NextResponse } from "next/server";
import { currentIdentity, requireAccess } from "@/lib/permissions";
import { isStandaloneMode } from "@/lib/mode";
import { getTokenFromSession } from "@/lib/session";
import { mcpResourceEnabled } from "@/lib/mcp/oauth/config";
import { listGrants } from "@/lib/mcp/oauth/grants";
import { listAllActiveGrants } from "@/lib/mcp/oauth/grants-admin";
import { noStoreHeaders } from "@/lib/http-cache";
import { safeError } from "@/lib/validation";

export async function GET(req: NextRequest) {
  if (!mcpResourceEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStoreHeaders() });
  const all = req.nextUrl.searchParams.get("all") === "1";
  if (isStandaloneMode()) {
    // requireAccess lets every standalone request through; this API still needs a session.
    if (!(await getTokenFromSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders() });
    if (all) return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403, headers: noStoreHeaders() });
  }
  const denied = await requireAccess(req, all ? "admin" : "auth");
  if (denied) return denied;
  try {
    if (all) return NextResponse.json({ grants: await listAllActiveGrants() }, { headers: noStoreHeaders() });
    const { id } = await currentIdentity();
    return NextResponse.json({ grants: await listGrants(id) }, { headers: noStoreHeaders() });
  } catch (e) {
    if ((e as { status?: number } | null)?.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders() });
    }
    return safeError(e, "Failed to list connected apps");
  }
}
