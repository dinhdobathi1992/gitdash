import { describe, it, expect } from "vitest";
import {
  AGE_BUCKETS, MERGED_REVIEW_SAMPLE, computeOpenPrHealth, mergedReviewSample, percentile,
  type PullWithReviews, type RawPull, type RawReview,
} from "@/lib/pr-health";
import { buildOpenPrHealthMain } from "./fixtures/pr-health-main";
import { sampleOctokit } from "./fixtures/sample-octokit";
import { SAMPLE_NOW, SAMPLE_REPO } from "@/lib/playground/source";

const NOW = Date.parse("2026-09-30T10:00:00Z");
const H = 3_600_000;
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * H).toISOString();

function pr(n: number, opts: Partial<RawPull> & { hoursAgo?: number } = {}): RawPull {
  return {
    number: n, title: `PR ${n}`, user: { login: opts.user?.login ?? "dev-a", avatar_url: "" },
    created_at: opts.created_at ?? at(opts.hoursAgo ?? 1), merged_at: opts.merged_at ?? null,
    draft: opts.draft, html_url: `https://example.com/${n}`,
  };
}
const review = (state: string, submitted_at: string | null): RawReview => ({ state, submitted_at });

describe("percentile", () => {
  it("interpolates linearly and is 0 for empty input", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([10], 0.9)).toBe(10);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([0, 10], 0.9)).toBe(9);
  });
});

describe("mergedReviewSample", () => {
  it("keeps merged PRs only, capped at the sample size, in input order", () => {
    const closed = Array.from({ length: 40 }, (_, i) => pr(i, { merged_at: i % 4 === 0 ? null : at(i) }));
    const sample = mergedReviewSample(closed);
    expect(sample).toHaveLength(MERGED_REVIEW_SAMPLE);
    expect(sample.every((p) => p.merged_at)).toBe(true);
    expect(sample[0].number).toBe(1);
  });
});

describe("computeOpenPrHealth", () => {
  it("returns zeros for an empty repo", () => {
    const h = computeOpenPrHealth({ open: [], closedPrs: [], merged: [], now: NOW });
    expect(h.total_open).toBe(0);
    expect(h.abandon_rate).toBe(0);
    expect(h.time_to_first_review_p50_hours).toBe(0);
    expect(h.age_distribution.map((b) => b.bucket)).toEqual(AGE_BUCKETS.map((b) => b.label));
    expect(h.review_round_distribution).toEqual([
      { rounds: "0", count: 0 }, { rounds: "1", count: 0 }, { rounds: "2", count: 0 }, { rounds: "3+", count: 0 },
    ]);
  });

  it("computes ages, review rounds, buckets and concurrent PRs for open PRs", () => {
    const open: PullWithReviews[] = [
      { pr: pr(1, { hoursAgo: 2 }), reviews: [] },
      { pr: pr(2, { hoursAgo: 30, user: { login: "dev-b", avatar_url: "" } }), reviews: [review("COMMENTED", at(20)), review("PENDING", null)] },
      { pr: pr(3, { hoursAgo: 400, draft: true }), reviews: [review("APPROVED", at(300))] },
    ];
    const h = computeOpenPrHealth({ open, closedPrs: [], merged: [], now: NOW });
    expect(h.open_prs.map((p) => p.number)).toEqual([3, 2, 1]); // oldest first
    expect(h.open_prs[0]).toMatchObject({ age_hours: 400, draft: true, has_review: true, review_rounds: 1 });
    expect(h.open_prs[1]).toMatchObject({ has_review: true, review_rounds: 1 }); // pending review has no submitted_at
    expect(h.age_distribution.find((b) => b.bucket === "< 1 day")?.count).toBe(1);
    expect(h.age_distribution.find((b) => b.bucket === "1-3 days")?.count).toBe(1);
    expect(h.age_distribution.find((b) => b.bucket === "2+ weeks")?.count).toBe(1);
    expect(h.concurrent_prs_by_author).toEqual([{ login: "dev-a", count: 2 }, { login: "dev-b", count: 1 }]);
  });

  it("computes review-time percentiles, round distribution and abandon rate from closed PRs", () => {
    const m1 = pr(10, { created_at: at(100), merged_at: at(60) });
    const m2 = pr(11, { created_at: at(50), merged_at: at(10) });
    const merged: PullWithReviews[] = [
      // first review 10h after open; approval 20h after open → merged 20h after approval
      { pr: m1, reviews: [review("APPROVED", at(80)), review("COMMENTED", at(90))] },
      // first review 4h after open; no approval
      { pr: m2, reviews: [review("COMMENTED", at(46)), review("COMMENTED", at(45)), review("CHANGES_REQUESTED", at(44))] },
    ];
    const closedPrs = [m1, m2, pr(12, { hoursAgo: 5 }), pr(13, { hoursAgo: 6 })];
    const h = computeOpenPrHealth({ open: [], closedPrs, merged, now: NOW });
    expect(h.time_to_first_review_p50_hours).toBe(7); // median of [4, 10]
    expect(h.time_to_first_review_p90_hours).toBe(9.4);
    expect(h.time_approval_to_merge_p50_hours).toBe(20);
    expect(h.review_round_distribution).toEqual([
      { rounds: "0", count: 0 }, { rounds: "1", count: 0 }, { rounds: "2", count: 1 }, { rounds: "3+", count: 1 },
    ]);
    expect(h.abandon_rate).toBe(50);
    expect(h.closed_prs_analysed).toBe(4);
  });
});

describe("open PR health: refactor preserves main's output", () => {
  it("route math over the sample repo equals the pre-extraction implementation", async () => {
    const octokit = sampleOctokit();
    const expected = await buildOpenPrHealthMain(octokit, SAMPLE_REPO.owner, SAMPLE_REPO.repo, SAMPLE_NOW);

    // Same inputs the route now hands to computeOpenPrHealth.
    const { data: openPrs } = await octokit.rest.pulls.list({ owner: "o", repo: "r", state: "open", per_page: 100, sort: "created", direction: "desc" });
    const { data: closedPrs } = await octokit.rest.pulls.list({ owner: "o", repo: "r", state: "closed", per_page: 60, sort: "updated", direction: "desc" });
    const withReviews = (prs: typeof openPrs) => Promise.all(prs.map(async (p) => ({
      pr: p, reviews: (await octokit.rest.pulls.listReviews({ owner: "o", repo: "r", pull_number: p.number, per_page: 100 })).data,
    })));
    const merged = mergedReviewSample(closedPrs);
    const actual = {
      ...computeOpenPrHealth({ open: await withReviews(openPrs), closedPrs, merged: await withReviews(merged), now: SAMPLE_NOW }),
      partial: false,
      fetched_prs: openPrs.length + merged.length,
      total_prs_attempted: openPrs.length + merged.length,
    };
    expect(actual).toEqual(expected);
    expect(expected.total_open).toBeGreaterThan(0);
  });
});
