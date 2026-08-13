/**
 * GitHub API data-fetching for repository-level DORA metrics.
 *
 * Strategy:
 *   1. Fetch the last 60 closed PRs → merged subset for lead time, CFR, scatter, throughput.
 *   2. Fetch the last 30 releases   → deployment frequency (preferred over PR count).
 *   3. For the most recent 20 merged PRs, fetch per-PR detail in batches of 5:
 *        - listCommits  → first_commit_at (true lead time start)
 *        - listReviews  → first_review_at + approved_at (cycle breakdown)
 *        - pulls.get    → additions + deletions (scatter LOC)
 */

import { getOctokit } from "@/lib/github";
import { calculateRepoDora } from "@/lib/dora";
import type { RepoDoraSummary, PrInput, PrDetailInput, ReleaseInput } from "@/lib/dora";
import { pLimitSettled } from "@/lib/concurrency";

const DETAIL_LIMIT = 20;
const CONCURRENCY = 10;

export type RepoDoraSummaryWithFetchStatus = RepoDoraSummary & {
  /** True if some per-PR detail fetches (commits/reviews/diff-stat) were rate-limited or failed */
  partial: boolean;
  fetched_prs: number;
  total_prs_attempted: number;
};

export async function getRepoDoraSummary(
  token: string,
  owner: string,
  repo: string,
): Promise<RepoDoraSummaryWithFetchStatus> {
  const octokit = getOctokit(token);

  // Kick off PRs and releases in parallel
  const [prsRes, releasesRes] = await Promise.all([
    octokit.rest.pulls.list({
      owner,
      repo,
      state: "closed",
      per_page: 60,
      sort: "updated",
      direction: "desc",
    }),
    octokit.rest.repos.listReleases({ owner, repo, per_page: 30 }),
  ]);

  const mergedPrs: PrInput[] = prsRes.data
    .filter(pr => pr.merged_at != null)
    .map(pr => ({
      number: pr.number,
      title: pr.title,
      created_at: pr.created_at,
      merged_at: pr.merged_at!,
      head_ref: pr.head.ref,
    }));

  const releases: ReleaseInput[] = releasesRes.data
    .filter(r => r.published_at != null)
    .map(r => ({ published_at: r.published_at! }));

  // Per-PR detail fetching for the most recent DETAIL_LIMIT merged PRs
  const detailPrs = mergedPrs.slice(0, DETAIL_LIMIT);
  const detailMap = new Map<number, PrDetailInput>();

  const results = await pLimitSettled(
    detailPrs.map(pr => async () => {
        const [commitsRes, reviewsRes, detailRes] = await Promise.all([
          octokit.rest.pulls.listCommits({
            owner,
            repo,
            pull_number: pr.number,
            per_page: 250,
          }),
          octokit.rest.pulls.listReviews({
            owner,
            repo,
            pull_number: pr.number,
            per_page: 100,
          }),
          octokit.rest.pulls.get({ owner, repo, pull_number: pr.number }),
        ]);

        const commits = commitsRes.data;
        const reviews = reviewsRes.data;

        // Oldest commit timestamp = true start of the change
        const commitDates = commits
          .map(c => c.commit.author?.date ?? c.commit.committer?.date)
          .filter(Boolean) as string[];
        const first_commit_at = commitDates.length > 0 ? commitDates.sort()[0] : null;

        // Reviews sorted chronologically
        const sortedReviews = reviews
          .filter(r => r.submitted_at != null)
          .sort(
            (a, b) =>
              new Date(a.submitted_at!).getTime() - new Date(b.submitted_at!).getTime(),
          );

        const first_review_at = sortedReviews[0]?.submitted_at ?? null;
        const approved_at =
          sortedReviews.find(r => r.state === "APPROVED")?.submitted_at ?? null;

        return {
          number: pr.number,
          first_commit_at,
          first_review_at,
          approved_at,
          additions: detailRes.data.additions,
          deletions: detailRes.data.deletions,
        } satisfies PrDetailInput;
    }),
    { concurrency: CONCURRENCY },
  );

  let rejected = 0;
  for (const r of results) {
    if (r.status === "fulfilled") detailMap.set(r.value.number, r.value);
    else rejected++;
  }

  const summary = calculateRepoDora(mergedPrs, releases, detailMap);
  return {
    ...summary,
    partial: rejected > 0,
    fetched_prs: detailPrs.length - rejected,
    total_prs_attempted: detailPrs.length,
  };
}
