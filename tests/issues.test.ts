import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The headline test here is the pull-request filter. GitHub's issues API
 * returns PRs as well as issues, and forgetting to exclude them would report
 * delivery throughput as triage throughput — wrong in a direction that looks
 * entirely plausible.
 */

const listForRepo = vi.fn();

vi.mock("@/lib/github", () => ({
  getOctokit: () => ({ rest: { issues: { listForRepo: (...a: unknown[]) => listForRepo(...a) } } }),
}));

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function issue(over: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: "Something is broken",
    state: "open",
    created_at: daysAgo(5),
    updated_at: daysAgo(1),
    closed_at: null,
    comments: 2,
    html_url: "https://github.com/o/r/issues/1",
    labels: [{ name: "bug", color: "d73a4a" }],
    assignees: [],
    ...over,
  };
}

/** A pull request as the issues API returns it — note the `pull_request` key. */
function pr(over: Record<string, unknown> = {}) {
  return issue({ pull_request: { url: "https://api.github.com/..." }, ...over });
}

function page(items: unknown[]) {
  listForRepo.mockResolvedValue({ data: items });
}

beforeEach(() => {
  listForRepo.mockReset().mockResolvedValue({ data: [] });
});

async function run(days = 30) {
  const { getIssuesSummary } = await import("@/lib/issues");
  return getIssuesSummary("tok", "o", "r", days);
}

describe("getIssuesSummary — pull requests are not issues", () => {
  it("excludes pull requests from every count", async () => {
    page([
      issue({ number: 1 }),
      pr({ number: 2 }),
      pr({ number: 3 }),
      issue({ number: 4 }),
    ]);
    const r = await run();
    expect(r.total_analysed).toBe(2);
    expect(r.open_count).toBe(2);
  });

  it("reports an empty summary for a repo that only has pull requests", async () => {
    page([pr({ number: 1 }), pr({ number: 2 })]);
    const r = await run();
    expect(r.total_analysed).toBe(0);
    expect(r.open_count).toBe(0);
    expect(r.median_days_to_close).toBeNull();
  });

  it("does not let a merged PR inflate the close-time metric", async () => {
    page([
      pr({ number: 1, state: "closed", created_at: daysAgo(20), closed_at: daysAgo(19) }),
      issue({ number: 2, state: "closed", created_at: daysAgo(10), closed_at: daysAgo(0) }),
    ]);
    const r = await run();
    expect(r.closed_in_period).toBe(1);
    expect(r.median_days_to_close).toBeCloseTo(10, 0); // the issue, not the PR
  });
});

describe("getIssuesSummary — backlog direction", () => {
  it("reports a positive delta when more arrive than are closed", async () => {
    page([
      issue({ number: 1, created_at: daysAgo(3) }),
      issue({ number: 2, created_at: daysAgo(4) }),
      issue({ number: 3, created_at: daysAgo(5), state: "closed", closed_at: daysAgo(1) }),
    ]);
    const r = await run();
    expect(r.opened_in_period).toBe(3);
    expect(r.closed_in_period).toBe(1);
    expect(r.backlog_delta).toBe(2);
  });

  it("reports a negative delta when the backlog is draining", async () => {
    page([
      issue({ number: 1, created_at: daysAgo(60), state: "closed", closed_at: daysAgo(2) }),
      issue({ number: 2, created_at: daysAgo(80), state: "closed", closed_at: daysAgo(3) }),
    ]);
    const r = await run(30);
    expect(r.opened_in_period).toBe(0); // both opened before the window
    expect(r.closed_in_period).toBe(2);
    expect(r.backlog_delta).toBe(-2);
  });

  it("ignores closures that fall outside the window", async () => {
    page([issue({ number: 1, state: "closed", created_at: daysAgo(90), closed_at: daysAgo(60) })]);
    const r = await run(30);
    expect(r.closed_in_period).toBe(0);
    expect(r.median_days_to_close).toBeNull();
  });
});

describe("getIssuesSummary — triage debt", () => {
  it("counts open issues with no labels", async () => {
    page([
      issue({ number: 1, labels: [] }),
      issue({ number: 2, labels: [{ name: "bug", color: "d73a4a" }] }),
      issue({ number: 3, labels: [] }),
    ]);
    expect((await run()).unlabelled_count).toBe(2);
  });

  it("treats an empty label name as unlabelled", async () => {
    page([issue({ number: 1, labels: [{ name: "", color: "fff" }] })]);
    expect((await run()).unlabelled_count).toBe(1);
  });

  it("counts stale issues by last activity, not age", async () => {
    page([
      issue({ number: 1, created_at: daysAgo(200), updated_at: daysAgo(1) }),  // old but active
      issue({ number: 2, created_at: daysAgo(40), updated_at: daysAgo(35) }),  // stale
    ]);
    expect((await run()).stale_count).toBe(1);
  });

  it("flags issues nobody has replied to, once they are old enough", async () => {
    page([
      issue({ number: 1, comments: 0, created_at: daysAgo(20) }), // neglected
      issue({ number: 2, comments: 0, created_at: daysAgo(3) }),  // too new to judge
      issue({ number: 3, comments: 5, created_at: daysAgo(40) }), // answered
    ]);
    const r = await run();
    expect(r.unanswered_count).toBe(1);
    expect(r.neglected[0].number).toBe(1);
  });

  it("excludes closed issues from triage debt", async () => {
    page([
      issue({ number: 1, state: "closed", closed_at: daysAgo(1), labels: [], comments: 0, created_at: daysAgo(40) }),
    ]);
    const r = await run();
    expect(r.unlabelled_count).toBe(0);
    expect(r.unanswered_count).toBe(0);
    expect(r.stale_count).toBe(0);
  });
});

describe("getIssuesSummary — distribution and grouping", () => {
  it("buckets the open backlog by age", async () => {
    page([
      issue({ number: 1, created_at: daysAgo(2) }),
      issue({ number: 2, created_at: daysAgo(14) }),
      issue({ number: 3, created_at: daysAgo(60) }),
      issue({ number: 4, created_at: daysAgo(200) }),
    ]);
    const r = await run();
    expect(r.age_buckets.map((b) => b.count)).toEqual([1, 1, 1, 1]);
  });

  it("counts labels across open issues only, ranked by frequency", async () => {
    page([
      issue({ number: 1, labels: [{ name: "bug", color: "d73a4a" }] }),
      issue({ number: 2, labels: [{ name: "bug", color: "d73a4a" }, { name: "p1", color: "111" }] }),
      issue({ number: 3, state: "closed", closed_at: daysAgo(1), labels: [{ name: "bug", color: "d73a4a" }] }),
    ]);
    const r = await run();
    expect(r.top_labels[0]).toEqual({ label: "bug", count: 2, color: "d73a4a" });
  });

  it("handles labels returned as bare strings", async () => {
    page([issue({ number: 1, labels: ["enhancement"] })]);
    const r = await run();
    expect(r.top_labels[0].label).toBe("enhancement");
    expect(r.unlabelled_count).toBe(0);
  });

  it("ranks assignees by open issue load", async () => {
    page([
      issue({ number: 1, assignees: [{ login: "alice" }] }),
      issue({ number: 2, assignees: [{ login: "alice" }, { login: "bob" }] }),
    ]);
    const r = await run();
    expect(r.assignee_load[0]).toEqual({ login: "alice", open: 2 });
  });

  it("tolerates a null assignees field", async () => {
    page([issue({ number: 1, assignees: null })]);
    expect((await run()).assignee_load).toEqual([]);
  });

  it("identifies the oldest open issue", async () => {
    page([
      issue({ number: 1, created_at: daysAgo(10) }),
      issue({ number: 2, created_at: daysAgo(300) }),
    ]);
    const r = await run();
    expect(r.oldest_open?.number).toBe(2);
    expect(r.oldest_open?.age_days).toBeGreaterThanOrEqual(299);
  });
});

describe("getIssuesSummary — sampling honesty", () => {
  it("flags partial when the page cap is reached", async () => {
    // A full page implies more may exist beyond the cap.
    listForRepo.mockResolvedValue({ data: Array.from({ length: 100 }, (_, i) => issue({ number: i + 1 })) });
    expect((await run()).partial).toBe(true);
  });

  it("does not flag partial when the last page is short", async () => {
    listForRepo.mockResolvedValue({ data: [issue({ number: 1 })] });
    expect((await run()).partial).toBe(false);
  });
});
