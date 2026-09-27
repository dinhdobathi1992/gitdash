/** GET /api/admin/audit?before=<id>&limit=50 — permission changes, newest first. Admin only. */
import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/permissions";
import { listAudit } from "@/lib/db";
import { noStoreHeaders } from "@/lib/http-cache";
import { safeError } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const denied = await requireAccess(req, "admin");
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const before = sp.get("before");
  try {
    const entries = await listAudit({
      before: before && /^\d+$/.test(before) ? Number(before) : undefined,
      limit: Number(sp.get("limit") ?? 50) || 50,
    });
    return NextResponse.json({ entries }, { headers: noStoreHeaders() });
  } catch (e) {
    return safeError(e, "Failed to load audit log");
  }
}
