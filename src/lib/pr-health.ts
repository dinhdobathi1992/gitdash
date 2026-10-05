/**
 * Open PR health — pure math over raw GitHub REST responses.
 *
 * Inputs are the REST shapes `GET /repos/{o}/{r}/pulls` (open and closed) and
 * `GET /repos/{o}/{r}/pulls/{n}/reviews`. No I/O and no server-only imports:
 * the /api/github/open-pr-health route fetches and calls this, and the public
 * API playground runs the same function in the browser.
 */

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

  /** True if some per-PR review fetches were rate-limited or failed */
  partial: boolean;
  /** PRs (open + sampled merged) successfully fetched */
  fetched_prs: number;
  /** PRs attempted (open_prs.length + min(merged, 30)) */
  total_prs_attempted: number;
}

/** The fetch-status fields the route adds; everything else comes from computeOpenPrHealth. */
export type OpenPrHealthMetrics = Omit<OpenPrHealthResponse, "partial" | "fetched_prs" | "total_prs_attempted">;

/** The fields of a `GET /repos/{o}/{r}/pulls` item the PR-health math reads. */
export interface RawPull {
  number: number;
  title: string;
  user: { login: string; avatar_url: string } | null;
  created_at: string;
  merged_at: string | null;
  draft?: boolean;
  html_url: string;
}

/** The fields of a `GET /repos/{o}/{r}/pulls/{n}/reviews` item the PR-health math reads. */
export interface RawReview {
  state: string;
  submitted_at?: string | null;
}

export interface PullWithReviews {
  pr: RawPull;
  reviews: RawReview[];
}

/** Recently merged PRs whose reviews are fetched for the review-time percentiles. */
export const MERGED_REVIEW_SAMPLE = 30;

/** The merged PRs (most recent first) whose reviews feed the percentiles. */
export function mergedReviewSample<T extends { merged_at: string | null }>(closedPrs: T[]): T[] {
  return closedPrs.filter((pr) => pr.merged_at != null).slice(0, MERGED_REVIEW_SAMPLE);
}

/** Linear-interpolated percentile of an ascending array; 0 when empty. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export const AGE_BUCKETS = [
  { label: "< 1 day", max: 24 },
  { label: "1-3 days", max: 72 },
  { label: "3-7 days", max: 168 },
  { label: "1-2 weeks", max: 336 },
  { label: "2+ weeks", max: Infinity },
];

/**
 * Open PR health from raw REST data.
 *  - `open`: open PRs with their reviews (only the ones whose review fetch succeeded)
 *  - `closedPrs`: the recently closed PR page (abandon rate denominator)
 *  - `merged`: the sampled merged PRs with their reviews (only successful fetches)
 *  - `now`: injectable clock for PR age
 */
export function computeOpenPrHealth(input: {
  open: PullWithReviews[];
  closedPrs: RawPull[];
  merged: PullWithReviews[];
  now: number;
}): OpenPrHealthMetrics {
  const { open, closedPrs, merged, now } = input;

  // ── Open PR info with review status ───────────────────────────────────
  const openPrInfos: OpenPrInfo[] = open.map(({ pr, reviews }) => {
    const ageHours = (now - new Date(pr.created_at).getTime()) / 3_600_000;
    return {
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
    };
  });

  // ── Time-to-first-review / approval-to-merge from merged PRs ──────────
  const timeToFirstReview: number[] = [];
  const timeApprovalToMerge: number[] = [];
  const reviewRoundCounts: number[] = [];

  for (const { pr, reviews } of merged) {
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

  const sortedTTFR = [...timeToFirstReview].sort((a, b) => a - b);
  const sortedATM = [...timeApprovalToMerge].sort((a, b) => a - b);

  // ── Age distribution ──────────────────────────────────────────────────
  const ageDistribution = AGE_BUCKETS.map((bucket) => ({ bucket: bucket.label, count: 0 }));
  for (const pr of openPrInfos) {
    for (let b = 0; b < AGE_BUCKETS.length; b++) {
      const prevMax = b > 0 ? AGE_BUCKETS[b - 1].max : 0;
      if (pr.age_hours >= prevMax && pr.age_hours < AGE_BUCKETS[b].max) {
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

  return {
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
}
