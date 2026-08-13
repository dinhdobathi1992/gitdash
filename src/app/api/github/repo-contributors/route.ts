import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";
import { getOctokit } from "@/lib/github";
import { pLimitSettled } from "@/lib/concurrency";

const CACHE_TTL = 300; // 5 minutes
const CONCURRENCY = 10;

// ── Response types ────────────────────────────────────────────────────────────

export interface ContributorRow {
  login: string;
  avatar_url: string;
  prs_merged: number;
  prs_opened: number;
  avg_hours_to_merge: number;
  avg_pr_size: number;
  reviews_given: number;
  avg_review_turnaround_hours: number;
  first_pass_approval_rate: number; // 0-100
  self_merge_count: number;
  comment_count: number;
}

export interface ReviewerLoadCell {
  author: string;
  reviewer: string;
  count: number;
}

export interface RepoContributorsResponse {
  contributors: ContributorRow[];
  reviewer_matrix: ReviewerLoadCell[];
  total_prs_analysed: number;
  period_days: number;
  bus_factor: number; // contributors responsible for >=80% of recent commits
  /** True if some per-PR review/comment fetches were rate-limited or failed */
  partial: boolean;
  fetched_prs: number;
  total_prs_attempted: number;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
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
    const octokit = getOctokit(token);

    // Fetch last 60 closed PRs (merged subset)
    const { data: prsData } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "closed",
      per_page: 60,
      sort: "updated",
      direction: "desc",
    });

    const mergedPrs = prsData.filter((pr) => pr.merged_at != null);

    if (mergedPrs.length === 0) {
      const empty: RepoContributorsResponse = {
        contributors: [],
        reviewer_matrix: [],
        total_prs_analysed: 0,
        period_days: 0,
        bus_factor: 0,
        partial: false,
        fetched_prs: 0,
        total_prs_attempted: 0,
      };
      return NextResponse.json(empty, {
        headers: { "Cache-Control": `private, max-age=${CACHE_TTL}, stale-while-revalidate=600` },
      });
    }

    // Period
    const dates = mergedPrs.map((pr) => new Date(pr.merged_at!).getTime());
    const periodDays = Math.max(
      1,
      Math.round((Math.max(...dates) - Math.min(...dates)) / 86_400_000)
    );

    // ── Per-author accumulators ──────────────────────────────────────────────
    interface AuthorAcc {
      login: string;
      avatar_url: string;
      prs_merged: number;
      prs_opened: number;
      merge_times: number[];
      pr_sizes: number[];
      reviews_given: number;
      review_turnarounds: number[];
      first_pass_approvals: number;
      total_reviewed_prs: number;
      self_merges: number;
      comments: number;
    }

    const authorMap = new Map<string, AuthorAcc>();
    const reviewMatrix: ReviewerLoadCell[] = [];
    const reviewMatrixMap = new Map<string, number>(); // "author::reviewer" -> count

    function getAuthor(login: string, avatar: string): AuthorAcc {
      if (!authorMap.has(login)) {
        authorMap.set(login, {
          login,
          avatar_url: avatar,
          prs_merged: 0,
          prs_opened: 0,
          merge_times: [],
          pr_sizes: [],
          reviews_given: 0,
          review_turnarounds: [],
          first_pass_approvals: 0,
          total_reviewed_prs: 0,
          self_merges: 0,
          comments: 0,
        });
      }
      return authorMap.get(login)!;
    }

    // Count PRs opened (from the full list, not just merged)
    for (const pr of prsData) {
      if (!pr.user) continue;
      const acc = getAuthor(pr.user.login, pr.user.avatar_url);
      acc.prs_opened++;
    }

    // Count merged PRs and basic metrics
    for (const pr of mergedPrs) {
      if (!pr.user) continue;
      const acc = getAuthor(pr.user.login, pr.user.avatar_url);
      acc.prs_merged++;

      const hoursToMerge =
        (new Date(pr.merged_at!).getTime() - new Date(pr.created_at).getTime()) / 3_600_000;
      if (hoursToMerge > 0) acc.merge_times.push(hoursToMerge);

      // PR size from list response (cast since Octokit types may not include it)
      const prAny = pr as unknown as { additions?: number; deletions?: number };
      const size = (prAny.additions ?? 0) + (prAny.deletions ?? 0);
      if (size > 0) acc.pr_sizes.push(size);

      // Self-merge check
      const mergedBy = (pr as unknown as { merged_by?: { login: string } | null }).merged_by;
      if (mergedBy && mergedBy.login === pr.user.login) {
        acc.self_merges++;
      }
    }

    // ── Fetch reviews for merged PRs (bounded worker pool) ──────────────────
    const detailPrs = mergedPrs.slice(0, 30); // limit to 30 for API budget

    const detailSettled = await pLimitSettled(
      detailPrs.map((pr) => async () => {
        const [reviewsRes, commentsRes] = await Promise.all([
          octokit.rest.pulls.listReviews({
            owner,
            repo,
            pull_number: pr.number,
            per_page: 100,
          }),
          octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number: pr.number,
            per_page: 100,
          }),
        ]);
        return { pr, reviews: reviewsRes.data, comments: commentsRes.data };
      }),
      { concurrency: CONCURRENCY },
    );

    let rejectedDetails = 0;
    for (const result of detailSettled) {
      if (result.status !== "fulfilled") { rejectedDetails++; continue; }
      {
        const { pr, reviews, comments } = result.value;
        const prAuthor = pr.user?.login;
        if (!prAuthor) continue;

        // Track reviews given by each reviewer
        const reviewersSeen = new Set<string>();
        let firstReviewWasApproval = false;
        let isFirstReview = true;

        const sorted = reviews
          .filter((r) => r.submitted_at != null && r.user?.login !== prAuthor)
          .sort(
            (a, b) =>
              new Date(a.submitted_at!).getTime() - new Date(b.submitted_at!).getTime()
          );

        for (const review of sorted) {
          const reviewer = review.user?.login;
          if (!reviewer) continue;

          // Reviewer accumulator
          const reviewerAcc = getAuthor(reviewer, review.user!.avatar_url);
          if (!reviewersSeen.has(reviewer)) {
            reviewerAcc.reviews_given++;
            reviewersSeen.add(reviewer);

            // Review turnaround
            const turnaround =
              (new Date(review.submitted_at!).getTime() -
                new Date(pr.created_at).getTime()) /
              3_600_000;
            if (turnaround > 0) reviewerAcc.review_turnarounds.push(turnaround);
          }

          // First-pass approval tracking
          if (isFirstReview) {
            firstReviewWasApproval = review.state === "APPROVED";
            isFirstReview = false;
          }

          // Reviewer load matrix
          const key = `${prAuthor}::${reviewer}`;
          reviewMatrixMap.set(key, (reviewMatrixMap.get(key) ?? 0) + 1);
        }

        // First-pass approval rate for the PR author
        if (sorted.length > 0) {
          const authorAcc = getAuthor(prAuthor, pr.user!.avatar_url);
          authorAcc.total_reviewed_prs++;
          if (firstReviewWasApproval) authorAcc.first_pass_approvals++;
        }

        // Comment counts per commenter
        for (const comment of comments) {
          if (!comment.user) continue;
          const commenterAcc = getAuthor(comment.user.login, comment.user.avatar_url);
          commenterAcc.comments++;
        }
      }
    }

    // ── Build response ──────────────────────────────────────────────────────
    const contributors: ContributorRow[] = Array.from(authorMap.values())
      .map((acc) => ({
        login: acc.login,
        avatar_url: acc.avatar_url,
        prs_merged: acc.prs_merged,
        prs_opened: acc.prs_opened,
        avg_hours_to_merge:
          acc.merge_times.length > 0
            ? Math.round(
                (acc.merge_times.reduce((s, h) => s + h, 0) / acc.merge_times.length) * 10
              ) / 10
            : 0,
        avg_pr_size:
          acc.pr_sizes.length > 0
            ? Math.round(acc.pr_sizes.reduce((s, sz) => s + sz, 0) / acc.pr_sizes.length)
            : 0,
        reviews_given: acc.reviews_given,
        avg_review_turnaround_hours:
          acc.review_turnarounds.length > 0
            ? Math.round(
                (acc.review_turnarounds.reduce((s, h) => s + h, 0) /
                  acc.review_turnarounds.length) *
                  10
              ) / 10
            : 0,
        first_pass_approval_rate:
          acc.total_reviewed_prs > 0
            ? Math.round((acc.first_pass_approvals / acc.total_reviewed_prs) * 100)
            : 0,
        self_merge_count: acc.self_merges,
        comment_count: acc.comments,
      }))
      .filter((c) => c.prs_merged > 0 || c.reviews_given > 0)
      .sort((a, b) => b.prs_merged - a.prs_merged);

    // Reviewer matrix
    for (const [key, count] of reviewMatrixMap) {
      const [author, reviewer] = key.split("::");
      reviewMatrix.push({ author, reviewer, count });
    }

    // Bus factor: contributors responsible for >=80% of merged PRs
    const totalMerged = mergedPrs.length;
    const sortedByMerged = [...contributors].sort((a, b) => b.prs_merged - a.prs_merged);
    let cumulative = 0;
    let busFactor = 0;
    for (const c of sortedByMerged) {
      cumulative += c.prs_merged;
      busFactor++;
      if (cumulative >= totalMerged * 0.8) break;
    }

    const response: RepoContributorsResponse = {
      contributors,
      reviewer_matrix: reviewMatrix,
      total_prs_analysed: mergedPrs.length,
      period_days: periodDays,
      bus_factor: busFactor,
      partial: rejectedDetails > 0,
      fetched_prs: detailPrs.length - rejectedDetails,
      total_prs_attempted: detailPrs.length,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": `private, max-age=${CACHE_TTL}, stale-while-revalidate=600`,
      },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch repo contributors");
  }
}
