import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";
import { getOctokit } from "@/lib/github";
import { pLimitSettled } from "@/lib/concurrency";
import { gatedCacheHeaders } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { withCache, hashKey, partialAwareTtl } from "@/lib/cache";
import { computeOpenPrHealth, mergedReviewSample, type OpenPrHealthResponse, type PullWithReviews } from "@/lib/pr-health";

const CACHE_TTL = 300; // 5 minutes
const CONCURRENCY = 5;

// Response types and the metric math live in src/lib/pr-health.ts (pure,
// shared with the public API playground). Re-exported for existing importers.
export type { OpenPrInfo, OpenPrHealthResponse } from "@/lib/pr-health";

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/open-pr-health");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  const owner = ownerResult.data;
  const repo = repoResult.data;

  try {
    const response = await withCache(
      `github/open-pr-health:${hashKey(token)}:${owner}:${repo}`,
      CACHE_TTL,
      () => buildOpenPrHealth(token, owner, repo),
      { shared: true, ttlFor: partialAwareTtl(CACHE_TTL) },
    );
    return NextResponse.json(response, {
      headers: {
        ...gatedCacheHeaders(),
      },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch open PR health");
  }
}

async function buildOpenPrHealth(token: string, owner: string, repo: string): Promise<OpenPrHealthResponse> {
  const octokit = getOctokit(token);
  const now = Date.now();

  // Parallel: open PRs + recently closed PRs
  const [openRes, closedRes] = await Promise.all([
    octokit.rest.pulls.list({
      owner,
      repo,
      state: "open",
      per_page: 100,
      sort: "created",
      direction: "desc",
    }),
    octokit.rest.pulls.list({
      owner,
      repo,
      state: "closed",
      per_page: 60,
      sort: "updated",
      direction: "desc",
    }),
  ]);

  const openPrs = openRes.data;
  const closedPrs = closedRes.data;
  let rejectedCount = 0;

  // Reviews for every open PR (review status, rounds)
  const openSettled = await pLimitSettled(
    openPrs.map((pr) => async () => {
      const { data: reviews } = await octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100,
      });
      return { pr, reviews };
    }),
    { concurrency: CONCURRENCY },
  );
  const open: PullWithReviews[] = [];
  for (const result of openSettled) {
    if (result.status === "fulfilled") open.push(result.value);
    else rejectedCount++;
  }

  // Reviews for the recently merged sample (time-to-first-review, approval-to-merge)
  const mergedPrs = mergedReviewSample(closedPrs);
  const mergedSettled = await pLimitSettled(
    mergedPrs.map((pr) => async () => {
      const { data: reviews } = await octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100,
      });
      return { pr, reviews };
    }),
    { concurrency: CONCURRENCY },
  );
  const merged: PullWithReviews[] = [];
  for (const result of mergedSettled) {
    if (result.status === "fulfilled") merged.push(result.value);
    else rejectedCount++;
  }

  return {
    ...computeOpenPrHealth({ open, closedPrs, merged, now }),
    partial: rejectedCount > 0,
    fetched_prs: openPrs.length + mergedPrs.length - rejectedCount,
    total_prs_attempted: openPrs.length + mergedPrs.length,
  };
}
