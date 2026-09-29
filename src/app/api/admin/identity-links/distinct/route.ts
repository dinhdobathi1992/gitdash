/**
 * "Different people" (organization mode, admins only).
 *
 * POST   /api/admin/identity-links/distinct  { a, b }  — never suggest linking this pair again
 * DELETE /api/admin/identity-links/distinct?a=&b=     — undo (Settings → Account links)
 */

import { NextRequest, NextResponse } from "next/server";
import { currentIdentity } from "@/lib/permissions";
import { setIdentityDistinct } from "@/lib/db";
import { normalizeLogin } from "@/lib/identity-links";
import { noStoreHeaders } from "@/lib/http-cache";
import { safeError } from "@/lib/validation";
import { guardIdentityRoute } from "@/lib/identity-route-guard";

async function apply(a: string | null, b: string | null, distinct: boolean) {
  if (!a || !b) return NextResponse.json({ error: "a and b must be GitHub logins" }, { status: 400 });
  if (a === b) return NextResponse.json({ error: "Pick two different logins" }, { status: 400 });
  try {
    const actor = await currentIdentity();
    const r = await setIdentityDistinct(actor, a, b, distinct);
    if (!r.ok) return NextResponse.json({ error: `${a} and ${b} are linked — unlink them first.` }, { status: 409 });
    return NextResponse.json({ ok: true, changed: r.changed }, { headers: noStoreHeaders() });
  } catch (e) {
    return safeError(e, "Failed to save");
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardIdentityRoute(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  return apply(normalizeLogin(body.a), normalizeLogin(body.b), true);
}

export async function DELETE(req: NextRequest) {
  const denied = await guardIdentityRoute(req);
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  return apply(normalizeLogin(q.get("a")), normalizeLogin(q.get("b")), false);
}
