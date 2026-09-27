/**
 * GET /api/admin/users?q=&group=&limit=&offset= — users with their groups,
 * pending (no group) first. Admin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/permissions";
import { parseAdminIds } from "@/lib/identity";
import { listUsers } from "@/lib/db";
import { noStoreHeaders } from "@/lib/http-cache";
import { safeError } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const denied = await requireAccess(req, "admin");
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  try {
    const bootstrap = new Set(parseAdminIds());
    const users = await listUsers({
      q: sp.get("q")?.slice(0, 100) || undefined,
      group: sp.get("group") || undefined,
      limit: Number(sp.get("limit") ?? 100) || 100,
      offset: Number(sp.get("offset") ?? 0) || 0,
    });
    return NextResponse.json(
      { users: users.map((u) => ({ ...u, isBootstrapAdmin: bootstrap.has(u.github_id) })) },
      { headers: noStoreHeaders() },
    );
  } catch (e) {
    return safeError(e, "Failed to list users");
  }
}
