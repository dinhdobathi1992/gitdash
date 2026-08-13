import { describe, it, expect } from "vitest";
import { generateTalkingPoints } from "../src/lib/one-on-one";
import type { ContributorProfileResponse } from "../src/app/api/github/contributor-profile/route";

function makeProfile(overrides: Partial<ContributorProfileResponse> = {}): ContributorProfileResponse {
  return {
    login: "alice",
    avatar_url: "",
    name: "Alice",
    bio: null,
    company: null,
    location: null,
    html_url: "https://github.com/alice",
    prs_opened: 10,
    prs_merged: 8,
    prs_closed_without_merge: 2,
    pr_merge_rate: 80,
    avg_hours_to_merge: 20,
    avg_pr_size: 100,
    recent_prs: [],
    reviews_given: 5,
    avg_review_turnaround_hours: 10,
    recent_reviews: [],
    total_commits_90d: 30,
    activity_calendar: [],
    weekly_commits: [],
    commit_hour_distribution: Array(24).fill(0),
    active_days_per_week: [3, 3, 3, 3],
    after_hours_pct: 10,
    funnel: { opened: 10, reviewed: 8, approved: 6, merged: 8 },
    languages: [],
    repos_contributed: ["org/repo"],
    partial: false,
    fetched_requests: 10,
    total_requests_attempted: 10,
    period_comparison: {
      window_days: 45,
      prs_opened_recent: 5,
      prs_opened_prior: 5,
      prs_merged_recent: 4,
      prs_merged_prior: 4,
      reviews_given_recent: 3,
      reviews_given_prior: 3,
      avg_hours_to_merge_recent: 20,
      avg_hours_to_merge_prior: 20,
      ...overrides.period_comparison,
    },
    ...overrides,
  };
}

describe("generateTalkingPoints", () => {
  it("flags a merge-rate drop as a watch item", () => {
    const points = generateTalkingPoints(makeProfile({
      period_comparison: {
        window_days: 45,
        prs_opened_recent: 1, prs_opened_prior: 5,
        prs_merged_recent: 1, prs_merged_prior: 5,
        reviews_given_recent: 3, reviews_given_prior: 3,
        avg_hours_to_merge_recent: 20, avg_hours_to_merge_prior: 20,
      },
    }));
    expect(points.some((p) => p.tone === "watch" && p.text.includes("dropped"))).toBe(true);
  });

  it("flags a merge surge as positive", () => {
    const points = generateTalkingPoints(makeProfile({
      period_comparison: {
        window_days: 45,
        prs_opened_recent: 10, prs_opened_prior: 4,
        prs_merged_recent: 9, prs_merged_prior: 4,
        reviews_given_recent: 3, reviews_given_prior: 3,
        avg_hours_to_merge_recent: 20, avg_hours_to_merge_prior: 20,
      },
    }));
    expect(points.some((p) => p.tone === "positive" && p.text.includes("up"))).toBe(true);
  });

  it("flags sustained after-hours work", () => {
    const points = generateTalkingPoints(makeProfile({ after_hours_pct: 45, total_commits_90d: 20 }));
    expect(points.some((p) => p.tone === "watch" && p.text.includes("outside 9"))).toBe(true);
  });

  it("flags a slower merge-time trend", () => {
    const points = generateTalkingPoints(makeProfile({
      period_comparison: {
        window_days: 45,
        prs_opened_recent: 4, prs_opened_prior: 4,
        prs_merged_recent: 4, prs_merged_prior: 4,
        reviews_given_recent: 3, reviews_given_prior: 3,
        avg_hours_to_merge_recent: 60, avg_hours_to_merge_prior: 20,
      },
    }));
    expect(points.some((p) => p.tone === "watch" && p.text.includes("longer to land"))).toBe(true);
  });

  it("falls back to a neutral point when nothing is notable", () => {
    const points = generateTalkingPoints(makeProfile());
    expect(points).toHaveLength(1);
    expect(points[0].tone).toBe("neutral");
  });

  it("ignores small-sample noise (prior < 2)", () => {
    const points = generateTalkingPoints(makeProfile({
      period_comparison: {
        window_days: 45,
        prs_opened_recent: 0, prs_opened_prior: 1,
        prs_merged_recent: 0, prs_merged_prior: 1,
        reviews_given_recent: 3, reviews_given_prior: 3,
        avg_hours_to_merge_recent: 20, avg_hours_to_merge_prior: 20,
      },
    }));
    expect(points.some((p) => p.text.includes("dropped"))).toBe(false);
  });
});
