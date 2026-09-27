import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { listWorkflows } from "@/lib/github";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";
import { privateCacheHeaders } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { withCache, hashKey } from "@/lib/cache";

const CACHE_TTL = 300;

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/workflows");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  try {
    const workflows = await withCache(
      `github/workflows:${hashKey(token)}:${ownerResult.data}:${repoResult.data}`,
      CACHE_TTL,
      () => listWorkflows(token, ownerResult.data, repoResult.data),
      { shared: true },
    );
    return NextResponse.json(workflows, {
      headers: privateCacheHeaders(0),
    });
  } catch (e) {
    return safeError(e, "Failed to fetch workflows");
  }
}
