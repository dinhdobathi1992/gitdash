import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";
import { getOctokit } from "@/lib/github";

const CACHE_TTL = 300; // 5 minutes
const BATCH_SIZE = 5;

// ── Response types ────────────────────────────────────────────────────────────

export interface OpenPrInfo {
  number: number;
  title: string;
  author: string;
  author_avatar: string;
  created_at: string;
  /** Age in hours */
  age_hours: number;
  /** Has any review? */
  has_review: boolean;
  /** Number of review rounds (distinct review submissions) */
  review_rounds: number;
  /** Is draft? */
  draft: boolean;
  html_url: string;
}

export interface OpenPrHealthResponse {
  open_prs: OpenPrInfo[];
  total_open: number;
  /** Number of recently-closed PRs used for percentile benchmarks */
  closed_prs_analysed: number;

  /** P50/P90 time-to-first-review in hours (from recently merged PRs) */
  time_to_first_review_p50_hours: number;
  time_to_first_review_p90_hours: number;

  /** P50/P90 time from approval to merge in hours */
  time_approval_to_merge_p50_hours: number;
  time_approval_to_merge_p90_hours: number;

  /** PR age distribution buckets */
  age_distribution: { bucket: string; count: number }[];

  /** Review round distribution */
  review_round_distribution: { rounds: string; count: number }[];

  /** PR abandon rate (closed without merge / total closed) over recent history */
  abandon_rate: number;

  /** Concurrent open PRs per author */
  concurrent_prs_by_author: { login: string; count: number }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
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

    // ── Open PR info with review status ───────────────────────────────────
    const openPrInfos: OpenPrInfo[] = [];

    for (let i = 0; i < openPrs.length; i += BATCH_SIZE) {
      const batch = openPrs.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (pr) => {
          const { data: reviews } = await octokit.rest.pulls.listReviews({
            owner,
            repo,
            pull_number: pr.number,
            per_page: 100,
          });
          return { pr, reviews };
        })
      );

      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { pr, reviews } = result.value;
        const ageHours = (now - new Date(pr.created_at).getTime()) / 3_600_000;

        openPrInfos.push({
          number: pr.number,
          title: pr.title,
          author: pr.user?.login ?? "unknown",
          author_avatar: pr.user?.avatar_url ?? "",
          created_at: pr.created_at,
          age_hours: Math.round(ageHours * 10) / 10,
          has_review: reviews.length > 0,
          review_rounds: reviews.filter((r) => r.submitted_at).length,
          draft: pr.draft ?? false,
          html_url: pr.html_url,
        });
      }
    }

    // ── Time-to-first-review from merged PRs ──────────────────────────────
    const mergedPrs = closedPrs.filter((pr) => pr.merged_at != null);
    const timeToFirstReview: number[] = [];
    const timeApprovalToMerge: number[] = [];
    const reviewRoundCounts: number[] = [];

    for (let i = 0; i < Math.min(mergedPrs.length, 30); i += BATCH_SIZE) {
      const batch = mergedPrs.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (pr) => {
          const { data: reviews } = await octokit.rest.pulls.listReviews({
            owner,
            repo,
            pull_number: pr.number,
            per_page: 100,
          });
          return { pr, reviews };
        })
      );

      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { pr, reviews } = result.value;

        const sorted = reviews
          .filter((r) => r.submitted_at != null)
          .sort(
            (a, b) =>
              new Date(a.submitted_at!).getTime() - new Date(b.submitted_at!).getTime()
          );

        // Time to first review
        if (sorted.length > 0) {
          const ttfr =
            (new Date(sorted[0].submitted_at!).getTime() -
              new Date(pr.created_at).getTime()) /
            3_600_000;
          if (ttfr > 0) timeToFirstReview.push(ttfr);
        }

        // Time from approval to merge
        const approval = sorted.find((r) => r.state === "APPROVED");
        if (approval && pr.merged_at) {
          const ttm =
            (new Date(pr.merged_at).getTime() -
              new Date(approval.submitted_at!).getTime()) /
            3_600_000;
          if (ttm > 0) timeApprovalToMerge.push(ttm);
        }

        // Review rounds
        reviewRoundCounts.push(sorted.length);
      }
    }

    const sortedTTFR = [...timeToFirstReview].sort((a, b) => a - b);
    const sortedATM = [...timeApprovalToMerge].sort((a, b) => a - b);

    // ── Age distribution ──────────────────────────────────────────────────
    const ageBuckets = [
      { label: "< 1 day", max: 24 },
      { label: "1-3 days", max: 72 },
      { label: "3-7 days", max: 168 },
      { label: "1-2 weeks", max: 336 },
      { label: "2+ weeks", max: Infinity },
    ];

    const ageDistribution = ageBuckets.map((bucket) => ({
      bucket: bucket.label,
      count: 0,
    }));

    for (const pr of openPrInfos) {
      for (let b = 0; b < ageBuckets.length; b++) {
        const prevMax = b > 0 ? ageBuckets[b - 1].max : 0;
        if (pr.age_hours >= prevMax && pr.age_hours < ageBuckets[b].max) {
          ageDistribution[b].count++;
          break;
        }
      }
    }

    // ── Review round distribution ─────────────────────────────────────────
    const roundDist: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3+": 0 };
    for (const rounds of reviewRoundCounts) {
      if (rounds === 0) roundDist["0"]++;
      else if (rounds === 1) roundDist["1"]++;
      else if (rounds === 2) roundDist["2"]++;
      else roundDist["3+"]++;
    }

    // ── Abandon rate ──────────────────────────────────────────────────────
    const closedWithoutMerge = closedPrs.filter((pr) => pr.merged_at == null).length;
    const abandonRate =
      closedPrs.length > 0
        ? Math.round((closedWithoutMerge / closedPrs.length) * 100)
        : 0;

    // ── Concurrent PRs by author ──────────────────────────────────────────
    const authorCounts = new Map<string, number>();
    for (const pr of openPrInfos) {
      authorCounts.set(pr.author, (authorCounts.get(pr.author) ?? 0) + 1);
    }
    const concurrentPrsByAuthor = Array.from(authorCounts.entries())
      .map(([login, count]) => ({ login, count }))
      .sort((a, b) => b.count - a.count);

    const response: OpenPrHealthResponse = {
      open_prs: openPrInfos.sort((a, b) => b.age_hours - a.age_hours),
      total_open: openPrInfos.length,
      time_to_first_review_p50_hours: Math.round(percentile(sortedTTFR, 0.5) * 10) / 10,
      time_to_first_review_p90_hours: Math.round(percentile(sortedTTFR, 0.9) * 10) / 10,
      time_approval_to_merge_p50_hours: Math.round(percentile(sortedATM, 0.5) * 10) / 10,
      time_approval_to_merge_p90_hours: Math.round(percentile(sortedATM, 0.9) * 10) / 10,
      age_distribution: ageDistribution,
      review_round_distribution: Object.entries(roundDist).map(([rounds, count]) => ({
        rounds,
        count,
      })),
      abandon_rate: abandonRate,
      concurrent_prs_by_author: concurrentPrsByAuthor,
      closed_prs_analysed: closedPrs.length,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=600`,
      },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch open PR health");
  }
}
