/**
 * DELETE /api/mcp/grants/[id] — revoke a connected AI app. Owners revoke their
 * own grant or personal key (`user_revoked`); admins may revoke any
 * (`admin_revoked`). Standalone mode has no admins (each person brings their
 * own PAT), so there only owners revoke. The
 * grant store caches active grants for up to 60 s per instance, which bounds
 * how long another instance can still accept the app's token. 404 when MCP is
 * disabled or the grant is unknown or already inactive.
 */
import { NextRequest, NextResponse } from "next/server";
import { currentIdentity, isCurrentUserAdmin, requireAccess } from "@/lib/permissions";
import { isStandaloneMode } from "@/lib/mode";
import { getTokenFromSession } from "@/lib/session";
import { mcpResourceEnabled } from "@/lib/mcp/oauth/config";
import { revokeGrant } from "@/lib/mcp/oauth/grants";
import { getActiveGrantOwner } from "@/lib/mcp/oauth/grants-admin";
import { auditMcp } from "@/lib/mcp/oauth/audit";
import { noStoreHeaders } from "@/lib/http-cache";
import { safeError } from "@/lib/validation";
import { isSameOrigin } from "@/lib/url";

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404, headers: noStoreHeaders() });

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!mcpResourceEnabled()) return notFound();
  // A state-changing call from the Settings screens only: refuse cross-site
  // requests outright (standalone mode's proxy does not check them).
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden", code: "cross_origin" }, { status: 403, headers: noStoreHeaders() });
  }
  // requireAccess lets every standalone request through; this API still needs a session.
  if (isStandaloneMode() && !(await getTokenFromSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders() });
  }
  const denied = await requireAccess(req, "auth");
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const me = await currentIdentity();
    const owner = await getActiveGrantOwner(id);
    if (!owner) return notFound();

    const own = owner.github_id === me.id;
    // isCurrentUserAdmin() is true for everyone in standalone mode: never use it there.
    if (!own && (isStandaloneMode() || !(await isCurrentUserAdmin()))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: noStoreHeaders() });
    }
    const reason = own ? "user_revoked" : "admin_revoked";
    // False: another request revoked it between the lookup and here. Nothing left to do or audit.
    if (!(await revokeGrant(id, reason))) return notFound();

    try {
      await auditMcp("mcp.grant_revoked", me.id, id.toLowerCase(), {
        reason,
        owner_github_id: owner.github_id,
        client_name: owner.client_name,
        redirect_host: owner.redirect_host,
      });
    } catch (e) {
      // The revocation took effect; failing the response would tell the user it did not.
      console.error("[mcp] grant revoked but the audit row could not be written:", e instanceof Error ? e.message : e);
    }
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
  } catch (e) {
    if ((e as { status?: number } | null)?.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders() });
    }
    return safeError(e, "Failed to revoke the app");
  }
}
