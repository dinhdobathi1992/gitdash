/**
 * GET /api/github/issues — issue and triage health.
 *
 * Everything is derived from the issue list itself (three paginated calls, no
 * per-issue fan-out), so this is one of the cheaper analytics routes despite
 * covering a whole new surface.
 *
 * Pull requests are excluded in the library — GitHub's issues API returns
 * both, and counting PRs here would report delivery throughput as triage
 * throughput.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getIssuesSummary } from "@/lib/issues";
import { withCache, hashKey } from "@/lib/cache";
import { validateOwner, validateRepo, validatePerPage, safeError } from "@/lib/validation";

export type { IssuesSummary, IssueRef, LabelCount } from "@/lib/issues";

export const maxDuration = 60;

const CACHE_TTL = 300; // 5 min

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;
  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  const daysResult = validatePerPage(searchParams.get("days"), 30);
  if (!daysResult.ok) return daysResult.response;
  const periodDays = Math.min(Math.max(daysResult.data, 7), 90);

  try {
    const data = await withCache(
      `issues:${hashKey(token)}:${ownerResult.data}/${repoResult.data}:${periodDays}`,
      CACHE_TTL,
      () => getIssuesSummary(token, ownerResult.data, repoResult.data, periodDays),
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": `private, max-age=${CACHE_TTL}` },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch issue metrics");
  }
}
