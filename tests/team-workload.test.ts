import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { computeWorkloadRiskMain } from "./fixtures/workload-risk-main";
import { computeWorkload, fetchCommitCounters, type WorkloadCounters } from "@/lib/team-workload";
import { DEFAULT_WORKDAY, LEGACY_UTC_WORKDAY, type Workday } from "@/lib/team-settings";
import { makeCanonical, noLinks } from "@/lib/identity-links";
import { __resetCacheForTests, cacheSet, hashKey } from "@/lib/cache";

const NOW = Date.parse("2026-09-29T00:00:00Z");

type Commit = { author: { login: string; avatar_url: string; type?: string } | null; commit: { author: { name: string; date: string } | null; committer: { date: string } | null } };

/** Deterministic commits over the last 42 days: several people, a bot, an unlinked git name. */
function syntheticCommits(): Commit[] {
  const people = [
    { login: "alice", n: 40, hourSkew: 20 },   // late UTC hours
    { login: "bob", n: 25, hourSkew: 3 },      // early UTC hours
    { login: "bob-work", n: 9, hourSkew: 11 },
    { login: "carol", n: 6, hourSkew: 10, onlyOld: true },
    { login: "dependabot[bot]", n: 7, hourSkew: 6, type: "Bot" },
    { login: null, name: "Some Laptop", n: 5, hourSkew: 22 },
  ];
  const out: Commit[] = [];
  let seq = 0;
  for (const p of people) {
    for (let i = 0; i < p.n; i++) {
      seq++;
      const daysAgo = p.onlyOld ? 20 + (i % 20) : (seq * 7) % 41;
      const t = NOW - daysAgo * 86_400_000 - ((p.hourSkew + i) % 24) * 3_600_000 - (seq % 60) * 60_000;
      const date = new Date(t).toISOString();
      out.push({
        author: p.login ? { login: p.login, avatar_url: `https://avatars/${p.login}`, ...(p.type ? { type: p.type } : {}) } : null,
        commit: { author: { name: p.name ?? p.login!, date }, committer: { date } },
      });
    }
  }
  return out.sort((a, b) => b.commit.author!.date.localeCompare(a.commit.author!.date));
}

function fakeOctokit(commits: Commit[], openPrs: { user: { login: string } | null }[]) {
  const listCommits = vi.fn(async ({ page }: { page: number }) => ({ data: commits.slice((page - 1) * 100, page * 100) }));
  const pullsList = vi.fn(async () => ({ data: openPrs }));
  return { rest: { repos: { listCommits }, pulls: { list: pullsList } }, graphql: vi.fn() } as never as import("@octokit/rest").Octokit & {
    rest: { repos: { listCommits: typeof listCommits } };
  };
}

const openPrs = [
  ...Array.from({ length: 3 }, () => ({ user: { login: "bob" } })),
  ...Array.from({ length: 2 }, () => ({ user: { login: "bob-work" } })),
  { user: { login: "alice" } },
  { user: null },
];

describe("legacy workload = main 4.6.2 (no links, UTC 09–18)", () => {
  it("synthetic fixture", async () => {
    const commits = syntheticCommits();
    const expected = await computeWorkloadRiskMain(fakeOctokit(commits, openPrs), "o", "r", NOW);
    const counters = await fetchCommitCounters(fakeOctokit(commits, openPrs), "o", "r", { windowDays: 42, workday: LEGACY_UTC_WORKDAY, now: NOW });
    const LEGACY_KEYS = ["login", "avatar_url", "total_commits", "after_hours_pct", "weekend_pct", "open_pr_count",
      "prior_period_commits", "recent_period_commits", "flags", "risk_score"] as const;
    const people = computeWorkload(counters, noLinks).map((p) => Object.fromEntries(LEGACY_KEYS.map((k) => [k, p[k]])));
    expect({ people, window_days: 42, total_commits_analysed: counters.total_commits }).toEqual(expected);
    expect(expected.people.length).toBeGreaterThan(4);
  });

  it("the default Asia/Saigon 08–19 workday changes only after-hours/weekend figures", async () => {
    const commits = syntheticCommits();
    const utc = computeWorkload(await fetchCommitCounters(fakeOctokit(commits, openPrs), "o", "r", { windowDays: 42, workday: LEGACY_UTC_WORKDAY, now: NOW }), noLinks);
    const vn = computeWorkload(await fetchCommitCounters(fakeOctokit(commits, openPrs), "o", "r", { windowDays: 42, workday: DEFAULT_WORKDAY, now: NOW }), noLinks);
    const strip = (p: (typeof utc)[number]) => ({ login: p.login, total: p.total_commits, open: p.open_pr_count, recent: p.recent_period_commits, prior: p.prior_period_commits, cliff: p.flags.activity_cliff });
    const byLogin = (rows: typeof utc) => Object.fromEntries(rows.map((p) => [p.login, strip(p)]));
    expect(byLogin(vn)).toEqual(byLogin(utc));
    expect(vn.map((p) => p.after_hours_pct)).not.toEqual(utc.map((p) => p.after_hours_pct));
  });
});

describe("computeWorkload", () => {
  const counters = (): WorkloadCounters => ({
    authors: [
      { login: "bob", avatar_url: "a/bob", total: 4, afterHours: 2, weekend: 0, recent: 4, prior: 0, unlinked_name: false, is_bot: false },
      { login: "bob-work", avatar_url: "a/bw", total: 6, afterHours: 3, weekend: 3, recent: 0, prior: 6, unlinked_name: false, is_bot: false },
      { login: "Bob", avatar_url: "", total: 3, afterHours: 3, weekend: 0, recent: 3, prior: 0, unlinked_name: true, is_bot: false },
      { login: "dependabot[bot]", avatar_url: "", total: 9, afterHours: 9, weekend: 0, recent: 9, prior: 0, unlinked_name: false, is_bot: true },
    ],
    open_prs: { bob: 2, "bob-work": 2 },
    total_commits: 22,
    partial: false,
    window_days: 30,
  });

  it("sums linked counters before percentages and flags", () => {
    const rows = computeWorkload(counters(), makeCanonical([{ alias_login: "bob-work", primary_login: "bob" }]));
    const bob = rows.find((r) => r.linked_logins)!;
    expect(bob.person_key).toBe(computeWorkload(counters(), noLinks).find((r) => r.login === "bob")!.person_key);
    expect(bob).toMatchObject({
      login: "bob-work", total_commits: 10, after_hours_pct: 50, weekend_pct: 30, open_pr_count: 4,
      recent_period_commits: 4, prior_period_commits: 6, linked_logins: ["bob", "bob-work"],
    });
    // Alone, neither login reaches the open-PR limit or the after-hours sample; merged, both flag.
    expect(bob.flags).toEqual({ after_hours: true, weekend: true, concurrent_pr_overload: true, activity_cliff: false });
    const alone = computeWorkload(counters(), noLinks).find((r) => r.login === "bob")!;
    expect(alone.flags.concurrent_pr_overload).toBe(false);
  });

  it("never merges a git author name row or a bot", () => {
    const rows = computeWorkload(counters(), makeCanonical([{ alias_login: "bob-work", primary_login: "bob" }]));
    expect(rows.find((r) => r.unlinked_name)).toMatchObject({ login: "Bob", total_commits: 3 });
    expect(rows.find((r) => r.is_bot)).toMatchObject({ login: "dependabot[bot]", total_commits: 9 });
    expect(rows).toHaveLength(3);
  });

  it("no activity cliff when told the window is partial", () => {
    expect(computeWorkload(counters(), noLinks).find((r) => r.login === "bob-work")!.flags.activity_cliff).toBe(true);
    expect(computeWorkload(counters(), noLinks, { cliff: false }).find((r) => r.login === "bob-work")!.flags.activity_cliff).toBe(false);
  });
});

describe("fetchCommitCounters", () => {
  it("reads more pages for longer windows and says when the cap was reached", async () => {
    const many: Commit[] = Array.from({ length: 2500 }, (_, i) => ({
      author: { login: `u${i % 3}`, avatar_url: "" },
      commit: { author: { name: "x", date: new Date(NOW - i * 3_000_000).toISOString() }, committer: null },
    }));
    const o30 = fakeOctokit(many, []);
    const c30 = await fetchCommitCounters(o30, "o", "r", { windowDays: 30, workday: DEFAULT_WORKDAY, now: NOW });
    expect(o30.rest.repos.listCommits).toHaveBeenCalledTimes(10);
    expect(c30).toMatchObject({ partial: true, total_commits: 1000 });
    const o90 = fakeOctokit(many, []);
    const c90 = await fetchCommitCounters(o90, "o", "r", { windowDays: 90, workday: DEFAULT_WORKDAY, now: NOW });
    expect(o90.rest.repos.listCommits).toHaveBeenCalledTimes(20);
    expect(c90).toMatchObject({ partial: true, total_commits: 2000 });
    const few = await fetchCommitCounters(fakeOctokit(many.slice(0, 150), []), "o", "r", { windowDays: 90, workday: DEFAULT_WORKDAY, now: NOW });
    expect(few.partial).toBe(false);
  });

  it("marks bots by API type and git-name rows as unlinked", async () => {
    const c = await fetchCommitCounters(fakeOctokit(syntheticCommits(), []), "o", "r", { windowDays: 42, workday: DEFAULT_WORKDAY, now: NOW });
    expect(c.authors.find((a) => a.login === "dependabot[bot]")?.is_bot).toBe(true);
    expect(c.authors.find((a) => a.login === "Some Laptop")?.unlinked_name).toBe(true);
    expect(c.authors.find((a) => a.login === "alice")).toMatchObject({ is_bot: false, unlinked_name: false });
  });
});

// ── Route ────────────────────────────────────────────────────────────────────

let octo: ReturnType<typeof fakeOctokit>;
let workday: Workday = LEGACY_UTC_WORKDAY;
let links: { alias_login: string; primary_login: string }[] = [];
vi.mock("@/lib/session", () => ({ getTokenFromSession: async () => "tok" }));
vi.mock("@/lib/github", () => ({ getOctokit: () => octo }));
vi.mock("@/lib/workday-setting", () => ({ getWorkday: async () => workday }));
vi.mock("@/lib/identity-links", async (orig) => {
  const real = await orig<typeof import("@/lib/identity-links")>();
  return { ...real, loadCanonical: async () => ({ canonical: real.makeCanonical(links), links }) };
});

async function call(qs: string) {
  const { GET } = await import("@/app/api/github/team-workload-risk/route");
  const res = await GET(new NextRequest(`http://localhost/api/github/team-workload-risk?${qs}`));
  return { status: res.status, body: await res.json() };
}

describe("GET /api/github/team-workload-risk", () => {
  beforeEach(() => {
    __resetCacheForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    octo = fakeOctokit(syntheticCommits(), openPrs);
    workday = LEGACY_UTC_WORKDAY;
    links = [];
  });
  afterEach(() => vi.useRealTimers());

  it("legacy (no days) output is main's, exactly", async () => {
    const expected = await computeWorkloadRiskMain(fakeOctokit(syntheticCommits(), openPrs), "o", "r", NOW);
    expect((await call("owner=o&repo=r")).body).toEqual(expected);
  });

  it("legacy path merges links on the next load without refetching", async () => {
    await call("owner=o&repo=r");
    links = [{ alias_login: "bob-work", primary_login: "bob" }];
    const { body } = await call("owner=o&repo=r");
    expect(octo.rest.repos.listCommits).toHaveBeenCalledTimes(1);
    expect(body.people.filter((p: { login: string }) => p.login.startsWith("bob"))).toHaveLength(1);
    expect(Object.keys(body.people[0]).sort()).toEqual(
      ["after_hours_pct", "avatar_url", "flags", "login", "open_pr_count", "prior_period_commits", "recent_period_commits", "risk_score", "total_commits", "weekend_pct"],
    );
  });

  it("windowed: thresholds, workday, partial and row markers", async () => {
    workday = DEFAULT_WORKDAY;
    const { status, body } = await call("owner=o&repo=r&days=30");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      window_days: 30, partial: false, workday: DEFAULT_WORKDAY,
      thresholds: { after_hours_pct: 30, weekend_pct: 25, open_prs: 4, min_sample: 5 },
    });
    expect(body.people.find((p: { unlinked_name: boolean }) => p.unlinked_name)).toBeTruthy();
    expect((await call("owner=o&repo=r&days=7")).status).toBe(400);
  });

  it("a workday change never serves counters computed under the old one", async () => {
    const utc = (await call("owner=o&repo=r&days=30")).body;
    workday = DEFAULT_WORKDAY;
    const vn = (await call("owner=o&repo=r&days=30")).body;
    expect(octo.rest.repos.listCommits).toHaveBeenCalledTimes(2);
    expect(vn.workday).toEqual(DEFAULT_WORKDAY);
    expect(vn.people.map((p: { after_hours_pct: number }) => p.after_hours_pct)).not.toEqual(utc.people.map((p: { after_hours_pct: number }) => p.after_hours_pct));
  });

  it("an old-shape row under the pre-v2 key is never read", async () => {
    cacheSet(`github/team-workload-risk:${hashKey("tok")}:o/r`, { people: [{ login: "stale" }], window_days: 42, total_commits_analysed: 1 }, 900);
    const { body } = await call("owner=o&repo=r");
    expect(body.people.some((p: { login: string }) => p.login === "stale")).toBe(false);
  });
});
