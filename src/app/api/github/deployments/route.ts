/**
 * GET /api/github/deployments — measured delivery metrics.
 *
 * Returns source: "deployments" when the repo actually uses GitHub's
 * Deployments API, and "none" when it does not. The caller keeps its existing
 * release/PR estimates in the latter case — this never silently replaces one
 * with the other, because knowing whether a figure was measured or inferred
 * matters more than the figure.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getDeploymentsSummary } from "@/lib/deployments";
import { withCache, hashKey } from "@/lib/cache";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";

export type {
  DeploymentsSummary, DeploymentRecord, EnvironmentStat, DeployMetricSource,
} from "@/lib/deployments";

export const maxDuration = 60;

const CACHE_TTL = 600; // 10 min — up to 41 API calls on a miss

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;
  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  try {
    const data = await withCache(
      `deployments:${hashKey(token)}:${ownerResult.data}/${repoResult.data}`,
      CACHE_TTL,
      () => getDeploymentsSummary(token, ownerResult.data, repoResult.data),
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": `private, max-age=${CACHE_TTL}` },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch deployments");
  }
}
