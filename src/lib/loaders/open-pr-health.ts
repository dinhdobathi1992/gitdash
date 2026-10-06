import { validateOwner, validateRepo } from "@/lib/validation";
import { getOctokit } from "@/lib/github";
import { pLimitSettled } from "@/lib/concurrency";
import { withCache, hashKey, partialAwareTtl } from "@/lib/cache";
import { computeOpenPrHealth, mergedReviewSample, type OpenPrHealthResponse, type PullWithReviews } from "@/lib/pr-health";
import { applyLabel, loaderOk, validationFailure, type LoaderOptions, type LoaderResult } from "./types";

const CACHE_TTL = 300; // 5 minutes
const CONCURRENCY = 5;

export async function loadOpenPrHealth(
  token: string,
  owner: string | null,
  repo: string | null,
  opts?: LoaderOptions,
): Promise<LoaderResult<OpenPrHealthResponse>> {
  applyLabel(opts);
  const ownerResult = validateOwner(owner);
  if (!ownerResult.ok) return validationFailure(ownerResult);
  const repoResult = validateRepo(repo);
  if (!repoResult.ok) return validationFailure(repoResult);

  const validOwner = ownerResult.data;
  const validRepo = repoResult.data;

  const response = await withCache(
    `github/open-pr-health:${hashKey(token)}:${validOwner}:${validRepo}`,
    CACHE_TTL,
    () => buildOpenPrHealth(token, validOwner, validRepo),
    { shared: true, ttlFor: partialAwareTtl(CACHE_TTL) },
  );
  return loaderOk(response);
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
