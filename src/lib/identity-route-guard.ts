/**
 * Shared gate for the account-link admin routes: admin (re-checked in the
 * handler), organization mode, and a database. Links are global, so standalone
 * mode — where every visitor counts as admin — must never write them.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "./permissions";
import { isStandaloneMode } from "./mode";

/** Null to proceed, else the response to send. */
export async function guardIdentityRoute(req: NextRequest | null): Promise<NextResponse | null> {
  const denied = await requireAccess(req, "admin");
  if (denied) return denied;
  if (isStandaloneMode()) {
    return NextResponse.json({ error: "Account links are available in organization mode only." }, { status: 403 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Account links need the database (DATABASE_URL)." }, { status: 503 });
  }
  return null;
}
