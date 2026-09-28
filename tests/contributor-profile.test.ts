import { describe, it, expect, vi, beforeEach } from "vitest";
import { aggregateContributorProfile, buildContributorProfile, serverTiming, type ProfileInput, type StepTiming } from "@/lib/contributor-profile";
import { __resetCacheForTests } from "@/lib/cache";

const NOW = new Date("2026-09-28T12:00:00Z");
const daysAgo = (d: number, hour = 10) => new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10) + `T${String(hour).padStart(2, "0")}:00:00Z`;
const user = { login: "alice", avatar_url: "a", name: "Alice", bio: null, company: null, location: null, html_url: "h" };

function input(over: Partial<ProfileInput> = {}): ProfileInput {
  return {
    user,
    prs: [
      { number: 1, title: "fast", created_at: daysAgo(10), merged_at: daysAgo(9), closed_at: daysAgo(9), additions: 30, deletions: 10, repo: "acme/api", language: "Go", reviews: [{ author: "bob", state: "APPROVED" }] },
      { number: 2, title: "abandoned", created_at: daysAgo(60), merged_at: null, closed_at: daysAgo(55), additions: 5, deletions: 5, repo: "acme/web", language: "TypeScript", reviews: [{ author: "bob", state: "CHANGES_REQUESTED" }] },
      { number: 3, title: "open", created_at: daysAgo(2), merged_at: null, closed_at: null, additions: 1, deletions: 0, repo: "acme/api", language: "Go", reviews: [{ author: "alice", state: "COMMENTED" }] },
      { number: 4, title: "too old", created_at: daysAgo(120), merged_at: daysAgo(119), closed_at: daysAgo(119), additions: 999, deletions: 0, repo: "acme/api", language: "Go", reviews: [] },
    ],
    reviews: [
      { pr_number: 9, pr_title: "x", pr_created_at: daysAgo(5, 8), repo: "acme/api", state: "APPROVED", submitted_at: daysAgo(5, 10) },
      { pr_number: 8, pr_title: "y", pr_created_at: daysAgo(70, 8), repo: "acme/web", state: "COMMENTED", submitted_at: daysAgo(70, 12) },
    ],
    commits: [
      { date: daysAgo(1, 10), repo: "acme/api", language: "Go" },
      { date: daysAgo(1, 22), repo: "acme/api", language: "Go" },
      { date: daysAgo(40, 3), repo: "acme/infra", language: "HCL" },
    ],
    totalCommits: 3,
    partial: false,
    requests: { attempted: 5, fetched: 5 },
    ...over,
  };
}

describe("aggregateContributorProfile", () => {
  const p = aggregateContributorProfile(input(), NOW);

  it("counts PRs in the 90-day window with real sizes", () => {
    expect(p.prs_opened).toBe(3);
    expect(p.prs_merged).toBe(1);
    expect(p.prs_closed_without_merge).toBe(1);
    expect(p.avg_pr_size).toBe(40);
    expect(p.avg_hours_to_merge).toBe(24);
    expect(p.recent_prs.map((r) => r.number)).toEqual([3, 1, 2]);
  });

  it("builds the funnel from reviews other people left on the person's PRs", () => {
    // PR 3's only review is the author's own comment, so it does not count as reviewed.
    expect(p.funnel).toEqual({ opened: 3, reviewed: 2, approved: 1, merged: 1 });
  });

  it("computes review turnaround and period halves", () => {
    expect(p.reviews_given).toBe(2);
    expect(p.avg_review_turnaround_hours).toBe(3);
    expect(p.period_comparison).toMatchObject({ prs_opened_recent: 2, prs_opened_prior: 1, reviews_given_recent: 1, reviews_given_prior: 1 });
  });

  it("derives commit activity, after-hours share and languages", () => {
    expect(p.total_commits_90d).toBe(3);
    expect(p.after_hours_pct).toBe(67); // 22:00 and 03:00 of three
    expect(p.commit_hour_distribution[22]).toBe(1);
    expect(p.active_days_per_week[0]).toBe(1);
    expect(p.languages[0]).toEqual({ name: "Go", count: 2 });
    expect(p.repos_contributed.sort()).toEqual(["acme/api", "acme/infra", "acme/web"]);
    expect(p.activity_calendar).toHaveLength(365);
    expect(p.weekly_commits).toHaveLength(12);
  });

  it("uses the search's exact total when the fetched commits are capped", () => {
    expect(aggregateContributorProfile(input({ totalCommits: 1200 }), NOW).total_commits_90d).toBe(1200);
  });

  it("falls back to PR repository languages when there are no commits", () => {
    const q = aggregateContributorProfile(input({ commits: [], totalCommits: 0 }), NOW);
    expect(q.languages[0].name).toBe("Go");
  });
});

describe("buildContributorProfile", () => {
  beforeEach(() => __resetCacheForTests());

  function mockOctokit(opts: { ownerType?: string; failReviewed?: boolean; commitTotal?: number } = {}) {
    const graphql = vi.fn(async (query: string, vars: { q: string; cursor: string | null }) => {
      if (query.includes("reviews(author:") && opts.failReviewed) throw new Error("boom");
      const page = vars.cursor ? 2 : 1;
      return {
        search: {
          pageInfo: { hasNextPage: page === 1 && query.includes("reviews(first: 30)"), endCursor: "c1" },
          nodes: query.includes("reviews(author:")
            ? [{ number: 7, title: "t", createdAt: daysAgo(3, 8), repository: { nameWithOwner: "acme/api" }, reviews: { nodes: [{ state: "APPROVED", submittedAt: daysAgo(3, 9) }] } }, {}]
            : [{ number: page, title: "p", createdAt: daysAgo(5), mergedAt: null, closedAt: null, additions: 1, deletions: 1, repository: { nameWithOwner: "acme/api", primaryLanguage: null }, reviews: { nodes: [] } }],
        },
      };
    });
    const commits = vi.fn(async ({ page }: { page: number }) => ({
      data: {
        total_count: opts.commitTotal ?? 150,
        incomplete_results: false,
        items: Array.from({ length: page === 1 ? 100 : 50 }, () => ({ commit: { author: { date: daysAgo(2) }, committer: null }, repository: { full_name: "acme/api", language: "Go" } })),
      },
    }));
    const getByUsername = vi.fn(async ({ username }: { username: string }) => ({
      data: { login: username, type: username === "acme" ? opts.ownerType ?? "Organization" : "User", avatar_url: "a", name: null, bio: null, company: null, location: null, html_url: "h" },
    }));
    return { octokit: { graphql, rest: { search: { commits }, users: { getByUsername } } }, graphql, commits };
  }

  it("runs three searches scoped to the owner and pages through results", async () => {
    const m = mockOctokit();
    const p = await buildContributorProfile(m.octokit as never, "acme", "alice", NOW);
    const queries = m.graphql.mock.calls.map((c) => (c[1] as { q: string }).q);
    expect(queries.some((q) => q.startsWith("type:pr author:alice org:acme created:>="))).toBe(true);
    expect(queries.some((q) => q.startsWith("type:pr reviewed-by:alice -author:alice org:acme"))).toBe(true);
    expect(m.commits.mock.calls[0][0]).toMatchObject({ q: expect.stringMatching(/^author:alice org:acme author-date:>=/) });
    expect(m.commits).toHaveBeenCalledTimes(2); // 150 commits → 2 pages
    expect(p.prs_opened).toBe(2); // two authored pages
    expect(p.reviews_given).toBe(1);
    expect(p.total_commits_90d).toBe(150);
    expect(p.partial).toBe(false);
    expect(p.total_requests_attempted).toBe(p.fetched_requests);
  });

  it("scopes to user: for personal accounts", async () => {
    const m = mockOctokit({ ownerType: "User" });
    await buildContributorProfile(m.octokit as never, "acme", "alice", NOW);
    expect((m.graphql.mock.calls[0][1] as { q: string }).q).toContain("user:acme");
  });

  it("marks the profile partial when a search fails, keeping the rest", async () => {
    const m = mockOctokit({ failReviewed: true });
    const p = await buildContributorProfile(m.octokit as never, "acme", "alice", NOW);
    expect(p.partial).toBe(true);
    expect(p.reviews_given).toBe(0);
    expect(p.prs_opened).toBe(2);
    expect(p.fetched_requests).toBeLessThan(p.total_requests_attempted);
  });
});

describe("profile build order and timing", () => {
  beforeEach(() => __resetCacheForTests());

  function octo(userDelay: number) {
    const order: string[] = [];
    let releaseUser!: () => void;
    const userGate = new Promise<void>((r) => (releaseUser = r));
    const getByUsername = vi.fn(async ({ username }: { username: string }) => {
      order.push(`user:${username}`);
      if (username === "alice") { if (userDelay) await userGate; }
      return { data: { login: username, type: username === "acme" ? "Organization" : "User", avatar_url: "a", name: null, bio: null, company: null, location: null, html_url: "h" } };
    });
    const graphql = vi.fn(async () => {
      order.push("search");
      if (userDelay) releaseUser();
      return { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } };
    });
    const commits = vi.fn(async () => ({ data: { total_count: 0, incomplete_results: false, items: [] } }));
    return { octokit: { graphql, rest: { search: { commits }, users: { getByUsername } } } as never, order, getByUsername };
  }

  it("starts the searches while the person lookup is still pending", async () => {
    const m = octo(1);
    // The user lookup only resolves once a search has run; the old order deadlocks here.
    await buildContributorProfile(m.octokit, "acme", "alice", NOW);
    expect(m.order.indexOf("search")).toBeGreaterThan(-1);
  });

  it("caches the owner's account type across builds", async () => {
    const m = octo(0);
    await buildContributorProfile(m.octokit, "acme", "alice", NOW);
    await buildContributorProfile(m.octokit, "acme", "bob", NOW);
    expect(m.getByUsername.mock.calls.filter(([a]) => (a as { username: string }).username === "acme")).toHaveLength(1);
  });

  it("records one timing per step with page and row counts", async () => {
    const m = octo(0);
    const steps: StepTiming[] = [];
    await buildContributorProfile(m.octokit, "acme", "alice", NOW, steps);
    expect(steps.map((s) => s.name).sort()).toEqual(["commits", "owner", "prs", "reviews", "user"]);
    expect(steps.find((s) => s.name === "prs")?.desc).toBe("1 pages, 0 PRs");
    expect(steps.every((s) => s.ms >= 0)).toBe(true);
  });

  it("formats Server-Timing and strips quotes from descriptions", () => {
    expect(serverTiming([{ name: "total", ms: 12.345 }, { name: "cache", ms: 0, desc: 'mi"ss' }])).toBe('total;dur=12.3, cache;dur=0.0;desc="miss"');
  });
});
