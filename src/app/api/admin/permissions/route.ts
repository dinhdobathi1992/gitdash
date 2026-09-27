/**
 * GET /api/admin/permissions — the group × flag matrix.
 * PUT /api/admin/permissions  body { group, flag, granted } — toggle one cell (audited).
 * Admin only. The admin group implicitly has every flag and is not editable.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  requireAccess,
  currentIdentity,
  GROUPS,
  GRANTABLE_GROUPS,
  FLAG_KEYS,
  isFlagKey,
  rbacEnforced,
  type Group,
} from "@/lib/permissions";
import { listGrants, setGrant } from "@/lib/db";
import { cacheDeleteByPrefix } from "@/lib/cache";
import { noStoreHeaders } from "@/lib/http-cache";
import { safeError } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const denied = await requireAccess(req, "admin");
  if (denied) return denied;
  try {
    const grants = Object.fromEntries(GROUPS.map((g) => [g, g === "admin" ? [...FLAG_KEYS] : []])) as Record<Group, string[]>;
    for (const row of await listGrants()) {
      if (row.group_name in grants && row.group_name !== "admin") grants[row.group_name as Group].push(row.flag_key);
    }
    return NextResponse.json({ groups: GROUPS, flags: FLAG_KEYS, grants, enforce: rbacEnforced() }, { headers: noStoreHeaders() });
  } catch (e) {
    return safeError(e, "Failed to load permissions");
  }
}

export async function PUT(req: NextRequest) {
  const denied = await requireAccess(req, "admin");
  if (denied) return denied;

  let body: { group?: unknown; flag?: unknown; granted?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { group, flag, granted } = body;
  if (typeof group !== "string" || !(GRANTABLE_GROUPS as string[]).includes(group)) {
    return NextResponse.json({ error: "group must be one of: devops, security, dev, pm (admin has every flag)" }, { status: 400 });
  }
  if (!isFlagKey(flag) || typeof granted !== "boolean") {
    return NextResponse.json({ error: "Unknown flag or missing granted:boolean" }, { status: 400 });
  }

  try {
    const actor = await currentIdentity();
    const { before } = await setGrant(actor.id, group, flag, granted);
    cacheDeleteByPrefix("perm:"); // this instance now; others within the 60s TTL
    return NextResponse.json({ ok: true, before, after: granted }, { headers: noStoreHeaders() });
  } catch (e) {
    return safeError(e, "Failed to update permission");
  }
}
