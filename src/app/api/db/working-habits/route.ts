/**
 * GET /api/db/working-habits?owner=X[&repo=Y][&login=Z]&days=30|90
 *
 * Commit and PR size per engineer, from merged PRs in the window (see
 * src/lib/working-habits.ts for the rules). One endpoint for the Team
 * insights section (whole repo or owner) and the contributor profile (login).
 *
 * Access, checked here whatever GITDASH_RBAC_ENFORCE says:
 *  - admins, users granted `workingHabits`, and standalone mode see everyone;
 *  - anyone else may read only their own numbers (login = their GitHub login).
 * Plus repo/owner visibility, because the data was synced with the service token.
 *
 * Account links merge a person's logins for granted views only. A self-view
 * stays the viewer's own login: logins can be renamed and reused, so a link
 * must never widen what someone without the grant can read.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { isStandaloneMode } from "@/lib/mode";
import { resolveAccess, resolveIdentity } from "@/lib/permissions";
import { listSyncedRepos } from "@/lib/db";
import { canSeeOwner, canSeeRepo } from "@/lib/repo-access";
import { safeError, validateOwner, validateRepo } from "@/lib/validation";
import { privateCacheHeaders } from "@/lib/http-cache";
import { computeWorkingHabits, type WorkingHabitsResponse } from "@/lib/working-habits";
import { DEFAULT_THRESHOLDS, getThresholds } from "@/lib/working-habits-settings";
import { loadCanonical, loginsOf, noLinks } from "@/lib/identity-links";

const VALID_DAYS = [30, 90];

function empty(from: Date, to: Date, thresholds = DEFAULT_THRESHOLDS): Omit<WorkingHabitsResponse, "available"> {
  return {
    thresholds,
    window: { from: from.toISOString(), to: to.toISOString() },
    coverage: { mergedPrs: 0, analysedPrs: 0, complete: true, lastSyncedAt: null },
    people: [], commits: [], prs: [],
    totals: { commits: 0, oversizedCommits: 0, prs: 0, oversizedPrs: 0 },
  };
}

/** Who may see what: everyone (`full`), or only `viewerLogin`'s own numbers. */
async function viewerScope(token: string): Promise<{ full: boolean; viewerLogin: string | null } | NextResponse> {
  if (isStandaloneMode()) return { full: true, viewerLogin: null };
  try {
    const { identity, allowed } = await resolveIdentity(token);
    if (!allowed) return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    const access = await resolveAccess(identity.id);
    return { full: access.isAdmin || access.flags.includes("workingHabits"), viewerLogin: identity.login };
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Service unavailable", code: "authz_unavailable" }, { status: 503 });
  }
}

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;
  const owner = ownerResult.data;
  const rawRepo = searchParams.get("repo");
  const repoResult = rawRepo === null ? null : validateRepo(rawRepo);
  if (repoResult && !repoResult.ok) return repoResult.response;
  const repoName = repoResult?.data ?? null;
  const rawLogin = searchParams.get("login");
  // GitHub logins follow the same rule as owners.
  const loginResult = rawLogin === null ? null : validateOwner(rawLogin);
  if (loginResult && !loginResult.ok) {
    return NextResponse.json({ error: "Invalid login parameter" }, { status: 400 });
  }
  let login = loginResult?.data ?? null;
  const days = Number(searchParams.get("days") ?? "30");
  if (!VALID_DAYS.includes(days)) {
    return NextResponse.json({ error: "days must be 30 or 90" }, { status: 400 });
  }

  const scope = await viewerScope(token);
  if (scope instanceof NextResponse) return scope;
  if (!scope.full) {
    // Self-view: without the grant, only your own numbers.
    if (!login || !scope.viewerLogin || login.toLowerCase() !== scope.viewerLogin.toLowerCase()) {
      return NextResponse.json({ error: "Forbidden", code: "forbidden", flag: "workingHabits" }, { status: 403 });
    }
    login = scope.viewerLogin;
  }

  try {
    const visible = repoName ? await canSeeRepo(token, owner, repoName) : await canSeeOwner(token, owner);
    if (!visible) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    // Short, so a threshold change shows on the next load.
    const headers = privateCacheHeaders(30);

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ available: false, ...empty(from, to) } satisfies WorkingHabitsResponse, { headers });
    }

    const prefix = `${owner.toLowerCase()}/`;
    const tracked = (await listSyncedRepos()).map((r) => r.repo).filter((r) => r.toLowerCase().startsWith(prefix));
    // Owner scope: only repos the viewer's own token can open — org membership
    // alone would expose commit SHAs and PR numbers of restricted private repos.
    const repos = repoName
      ? tracked.filter((r) => r.toLowerCase() === `${prefix}${repoName.toLowerCase()}`)
      : (await Promise.all(tracked.map(async (r) => ((await canSeeRepo(token, owner, r.split("/")[1])) ? r : null))))
          .filter((r): r is string => r !== null);
    if (repoName && repos.length === 0) {
      const body: WorkingHabitsResponse = { available: true, untrackedRepo: true, ...empty(from, to, await getThresholds()) };
      return NextResponse.json(body, { headers });
    }

    if (!repoName && repos.length === 0) {
      const body: WorkingHabitsResponse = { available: true, noTrackedRepos: true, ...empty(from, to, await getThresholds()) };
      return NextResponse.json(body, { headers });
    }

    // Links are read uncached, after every cache, so a change shows on the next load.
    const { canonical, links } = scope.full ? await loadCanonical() : { canonical: noLinks, links: [] };
    const logins = login ? (scope.full ? loginsOf(login, links) : [login]) : null;
    const result = await computeWorkingHabits({ repos, from, to, logins, canonical });
    return NextResponse.json({ available: true, ...result } satisfies WorkingHabitsResponse, { headers });
  } catch (e) {
    return safeError(e, "Failed to load working habits");
  }
}
