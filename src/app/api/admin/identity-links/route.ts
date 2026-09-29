/**
 * Account links (organization mode, admins only).
 *
 * GET    /api/admin/identity-links              → { links, distinct }
 * POST   /api/admin/identity-links  { alias, primary }
 * DELETE /api/admin/identity-links?alias=
 *
 * A link makes every team metric count two GitHub logins as one person. It
 * changes numbers, never access. Every change is audited per affected alias.
 * There is deliberately no non-admin endpoint: data routes apply links
 * server-side and only return the linked logins present in their response.
 */

import { NextRequest, NextResponse } from "next/server";
import { currentIdentity } from "@/lib/permissions";
import { guardIdentityRoute } from "@/lib/identity-route-guard";
import { linkIdentity, listIdentityDistinct, listIdentityLinks, unlinkIdentity } from "@/lib/db";
import { normalizeLogin } from "@/lib/identity-links";
import { noStoreHeaders } from "@/lib/http-cache";
import { safeError } from "@/lib/validation";

export interface IdentityLinksResponse {
  links: { alias_login: string; primary_login: string; created_by: string | null; created_at: string | null }[];
  distinct: { login_a: string; login_b: string; created_by: string | null; created_at: string | null }[];
}

export async function GET(req: NextRequest) {
  const denied = await guardIdentityRoute(req);
  if (denied) return denied;
  try {
    const [links, distinct] = await Promise.all([listIdentityLinks(), listIdentityDistinct()]);
    return NextResponse.json({ links, distinct } satisfies IdentityLinksResponse, { headers: noStoreHeaders() });
  } catch (e) {
    return safeError(e, "Failed to load account links");
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
  const alias = normalizeLogin(body.alias);
  const primary = normalizeLogin(body.primary);
  if (!alias || !primary) return NextResponse.json({ error: "alias and primary must be GitHub logins" }, { status: 400 });
  if (alias === primary) return NextResponse.json({ error: "A login cannot be linked to itself" }, { status: 400 });
  try {
    const actor = await currentIdentity();
    const r = await linkIdentity(actor, alias, primary);
    if (!r.ok) {
      return NextResponse.json({ error: `${primary} is already linked to ${alias}.` }, { status: 409 });
    }
    return NextResponse.json({ ok: true, alias, primary: r.primary }, { headers: noStoreHeaders() });
  } catch (e) {
    return safeError(e, "Failed to link accounts");
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await guardIdentityRoute(req);
  if (denied) return denied;
  const alias = normalizeLogin(req.nextUrl.searchParams.get("alias"));
  if (!alias) return NextResponse.json({ error: "alias must be a GitHub login" }, { status: 400 });
  try {
    const actor = await currentIdentity();
    const r = await unlinkIdentity(actor, alias);
    if (r.isPrimary) {
      return NextResponse.json({ error: `${alias} is the main login of other accounts — unlink its aliases first.` }, { status: 400 });
    }
    if (r.notLinked) return NextResponse.json({ error: `${alias} is not linked.` }, { status: 404 });
    return NextResponse.json({ ok: true, alias, before: r.before }, { headers: noStoreHeaders() });
  } catch (e) {
    return safeError(e, "Failed to unlink account");
  }
}
