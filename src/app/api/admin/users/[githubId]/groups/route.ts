/**
 * PUT /api/admin/users/:githubId/groups  body { groups: Group[] }
 * Replaces a user's groups (audited). Bootstrap admins (GITDASH_ADMIN_GITHUB_IDS)
 * are admins regardless, so "admin" is implicit for them and never stored.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAccess, currentIdentity, isGroup } from "@/lib/permissions";
import { parseAdminIds } from "@/lib/identity";
import { setUserGroups, userExists } from "@/lib/db";
import { cacheDeleteByPrefix } from "@/lib/cache";
import { noStoreHeaders } from "@/lib/http-cache";
import { safeError } from "@/lib/validation";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ githubId: string }> }) {
  const denied = await requireAccess(req, "admin");
  if (denied) return denied;

  const { githubId: raw } = await ctx.params;
  const githubId = Number(raw);
  if (!/^\d{1,15}$/.test(raw) || !Number.isSafeInteger(githubId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  let groups: unknown;
  try {
    groups = (await req.json())?.groups;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!Array.isArray(groups) || !groups.every(isGroup)) {
    return NextResponse.json({ error: "groups must be a list of: devops, security, dev, pm, admin" }, { status: 400 });
  }

  try {
    if (!(await userExists(githubId))) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const bootstrap = parseAdminIds();
    const wanted = bootstrap.includes(githubId) ? groups.filter((g) => g !== "admin") : groups;
    const actor = await currentIdentity();
    const result = await setUserGroups(actor.id, githubId, wanted, bootstrap);
    if (!result.ok) {
      return NextResponse.json({ error: "This change would leave GitDash without any admin." }, { status: 409 });
    }
    cacheDeleteByPrefix("perm:"); // this instance now; others within the 60s TTL
    return NextResponse.json({ ok: true, before: result.before, after: result.after }, { headers: noStoreHeaders() });
  } catch (e) {
    return safeError(e, "Failed to update groups");
  }
}
