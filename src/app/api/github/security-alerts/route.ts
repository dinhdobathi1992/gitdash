/**
 * GET /api/github/security-alerts — GitHub's own security findings.
 *
 * Complements /api/github/security-scan, which statically analyses workflow
 * YAML. This one reports what GitHub itself has found: vulnerable
 * dependencies, code scanning results, and exposed secrets.
 *
 * Never fails wholesale on a permission problem. Each source carries its own
 * status, because on a security page "we couldn't look" and "there's nothing
 * there" must never render the same way.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getSecurityAlerts } from "@/lib/security-alerts";
import { withCache, hashKey, partialAwareTtl } from "@/lib/cache";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";

import { privateCacheHeaders } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";

export type {
  SecurityAlertsResponse, SecurityAlert, SourceResult,
  AlertSeverity, AlertSource, SourceStatus,
} from "@/lib/security-alerts";

export const maxDuration = 60;

const CACHE_TTL = 300; // 5 min — six API calls, and alerts do not move minute to minute

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/security-alerts");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;
  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  try {
    const data = await withCache(
      `github/security-alerts:${hashKey(token)}:${ownerResult.data}/${repoResult.data}`,
      CACHE_TTL,
      () => getSecurityAlerts(token, ownerResult.data, repoResult.data),
      { shared: true, ttlFor: partialAwareTtl(CACHE_TTL) },
    );
    return NextResponse.json(data, {
      headers: privateCacheHeaders(CACHE_TTL),
    });
  } catch (e) {
    return safeError(e, "Failed to fetch security alerts");
  }
}
