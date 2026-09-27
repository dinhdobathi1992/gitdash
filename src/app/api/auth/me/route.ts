import { NextResponse } from "next/server";
import { getSession, sessionToken } from "@/lib/session";
import { getAppMode, isStandaloneMode } from "@/lib/mode";
import { getOctokit } from "@/lib/github";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { resolveAccess, resolveIdentity, rbacEnforced, FLAG_KEYS } from "@/lib/permissions";

/** Standalone mode has no permission model: every flag is available. */
const STANDALONE_ACCESS = { groups: [], grantedFlags: FLAG_KEYS, isAdmin: false, enforce: false };

export async function GET() {
  labelGitHubRoute("auth/me");
  const mode = getAppMode();

  if (isStandaloneMode()) {
    try {
      const session = await getSession();
      if (!session.pat) {
        return NextResponse.json({ user: null, mode }, { status: 401 });
      }
      // Use cached user from session if available; otherwise re-fetch
      if (session.user) {
        return NextResponse.json({ user: session.user, mode, ...STANDALONE_ACCESS });
      }
      // Re-hydrate from GitHub (e.g. session was created without user cached)
      const octokit = getOctokit(session.pat);
      const { data } = await octokit.rest.users.getAuthenticated();
      const user = {
        id: data.id,
        login: data.login,
        name: data.name ?? null,
        avatar_url: data.avatar_url,
        email: data.email ?? null,
      };
      session.user = user;
      await session.save();
      return NextResponse.json({ user, mode, ...STANDALONE_ACCESS });
    } catch {
      return NextResponse.json({ user: null, mode }, { status: 401 });
    }
  }

  // Organization mode: identity comes from GitHub for the token in use (cached
  // 60s), so sessions created before numeric ids were stored keep working.
  // Only a token GitHub rejects is a 401 (the client then restarts sign-in);
  // outages are a 503 so the client never reload-loops on them.
  try {
    const session = await getSession();
    const token = sessionToken(session);
    if (!token) {
      return NextResponse.json({ user: null, mode }, { status: 401 });
    }
    const { identity, allowed } = await resolveIdentity(token);
    if (!allowed) {
      return NextResponse.json({ user: null, mode, code: "org_not_allowed" }, { status: 403 });
    }
    const access = await resolveAccess(identity.id);
    const enforce = rbacEnforced();
    return NextResponse.json({
      user: identity,
      mode,
      groups: access.groups,
      // With enforcement off everyone keeps today's access, so every flag is granted.
      grantedFlags: enforce ? access.flags : FLAG_KEYS,
      isAdmin: access.isAdmin,
      enforce,
    });
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ user: null, mode }, { status: 401 });
    }
    return NextResponse.json({ user: null, mode, code: "authz_unavailable" }, { status: 503 });
  }
}
