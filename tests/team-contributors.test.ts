import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { PGlite } from "@electric-sql/pglite";
import type { RepoContributorsResponse } from "@/app/api/github/repo-contributors/route";
import {
  aggregateWindow, applyLinksToLegacy, fetchPrFactsWindow, MAX_SEARCH_PAGES, type PrFact, type PrFactsWindow,
} from "@/lib/team-contributors";
import { makeCanonical, noLinks } from "@/lib/identity-links";

// ── Legacy post-pass ─────────────────────────────────────────────────────────

const row = (login: string, o: Partial<RepoContributorsResponse["contributors"][number]> = {}) => ({
  login, avatar_url: `a/${login}`, prs_merged: 0, prs_opened: 0, avg_hours_to_merge: 0, avg_pr_size: 0, reviews_given: 0,
  avg_review_turnaround_hours: 0, first_pass_approval_rate: 0, self_merge_count: 0, comment_count: 0, ...o,
});
const legacy = (): RepoContributorsResponse => ({
  contributors: [
    row("alice", { prs_merged: 6, prs_opened: 7, avg_hours_to_merge: 10, avg_pr_size: 100, first_pass_approval_rate: 50, comment_count: 2 }),
    row("alice-work", { prs_merged: 2, prs_opened: 2, avg_hours_to_merge: 2, avg_pr_size: 20, first_pass_approval_rate: 100, reviews_given: 3, avg_review_turnaround_hours: 4 }),
    row("bob", { reviews_given: 9, avg_review_turnaround_hours: 1 }),
  ],
  reviewer_matrix: [
    { author: "alice", reviewer: "bob", count: 5 },
    { author: "alice-work", reviewer: "bob", count: 2 },
    { author: "alice", reviewer: "alice-work", count: 3 },
  ],
  total_prs_analysed: 8, period_days: 30, bus_factor: 2, partial: false, fetched_prs: 8, total_prs_attempted: 8,
});

describe("applyLinksToLegacy", () => {
  it("returns the response untouched without links (identical to main)", () => {
    const r = legacy();
    expect(applyLinksToLegacy(r, noLinks)).toBe(r);
    expect(applyLinksToLegacy(r, makeCanonical([{ alias_login: "zed", primary_login: "amy" }]))).toBe(r);
  });

  it("merges linked rows: sums, weighted averages, matrix re-keyed, self cells dropped, bus factor recomputed", () => {
    const r = applyLinksToLegacy(legacy(), makeCanonical([{ alias_login: "alice-work", primary_login: "alice" }]));
    expect(r.contributors.map((c) => c.login)).toEqual(["alice", "bob"]);
    expect(r.contributors[0]).toEqual({
      login: "alice", avatar_url: "a/alice", prs_merged: 8, prs_opened: 9,
      avg_hours_to_merge: 8, // (10·6 + 2·2) / 8
      avg_pr_size: 80, // (100·6 + 20·2) / 8
      reviews_given: 3, avg_review_turnaround_hours: 4,
      first_pass_approval_rate: 63, // (50·6 + 100·2) / 8 = 62.5
      self_merge_count: 0, comment_count: 2,
    });
    expect(r.reviewer_matrix).toEqual([{ author: "alice", reviewer: "bob", count: 7 }]);
    expect(r.bus_factor).toBe(1);
  });
});

// ── Windowed aggregation ─────────────────────────────────────────────────────

const H = 3_600_000;
const T0 = Date.parse("2026-09-10T00:00:00Z");
const at = (h: number) => new Date(T0 + h * H).toISOString();
const pr = (n: number, author: string, mergedAfterH: number, reviews: PrFact["reviews"] = [], o: Partial<PrFact> = {}): PrFact => ({
  number: n, author, created_at: at(0), merged_at: at(mergedAfterH), merged_by: "maint", size: 10, reviews, ...o,
});
const rv = (reviewer: string, state: PrFact["reviews"][number]["state"], h: number | null) => ({ reviewer, state, submitted_at: h === null ? null : at(h) });
const people = (...logins: string[]) => Object.fromEntries(logins.map((l) => [l.toLowerCase(), { login: l, avatar_url: `a/${l}`, bot: l.endsWith("[bot]") }]));
const win = (facts: PrFact[], o: Partial<PrFactsWindow> = {}): PrFactsWindow => ({
  facts, people: people("alice", "bob", "carol", "maint", "alice-work", "github-advanced-security[bot]", "dependabot[bot]"),
  total_merged: facts.length, opened_in_window: 12, partial: false, capped: false, truncated_review_prs: 0, window_days: 30, graphql_cost: 1, ...o,
});

describe("aggregateWindow", () => {
  it("human review: submitted, a real state, not a bot, not the author", () => {
    const r = aggregateWindow(win([
      pr(1, "alice", 2, [rv("bob", "APPROVED", 1)]),
      pr(2, "alice", 4, [rv("bob", "PENDING", null)]),
      pr(3, "alice", 6, [rv("bob", "DISMISSED", 1)]),
      pr(4, "alice", 8, [rv("github-advanced-security[bot]", "COMMENTED", 1)]),
      pr(5, "alice", 10, [rv("alice", "COMMENTED", 1)]),
      pr(6, "bob", 1, [rv("carol", "CHANGES_REQUESTED", 0.5), rv("carol", "APPROVED", 0.8)]),
    ]), noLinks);
    expect(r).toMatchObject({ prs_merged_total: 6, prs_human_reviewed: 2, prs_no_human_review: 4, bot_reviews: 1, prs_opened_in_window: 12 });
    expect(r.review_pairs).toEqual([
      { author: "alice", reviewer: "bob", prs: 1, bot: false, author_bot: false },
      { author: "bob", reviewer: "carol", prs: 1, bot: false, author_bot: false },
      { author: "alice", reviewer: "github-advanced-security[bot]", prs: 1, bot: true, author_bot: false },
    ]);
    // Heatmap cells count PRs, not review events (carol reviewed PR 6 twice).
    expect(r.reviewer_matrix).toEqual([
      { author: "alice", reviewer: "bob", count: 1 },
      { author: "bob", reviewer: "carol", count: 1 },
    ]);
    const bob = r.contributors.find((c) => c.login === "bob")!;
    expect(bob).toMatchObject({ reviews_given: 1, avg_review_turnaround_hours: 1, prs_merged: 1, first_pass_approval_rate: 0, reviewed_prs: 1 });
    expect(r.contributors.find((c) => c.login === "github-advanced-security[bot]")).toMatchObject({ is_bot: true, reviews_given: 1 });
  });

  it("true median over PRs (not the median of per-person averages)", () => {
    const r = aggregateWindow(win([pr(1, "alice", 1), pr(2, "alice", 2), pr(3, "alice", 3), pr(4, "bob", 100)]), noLinks);
    expect(r.median_hours_to_merge).toBe(2.5);
    expect(r.contributors.find((c) => c.login === "alice")!.median_hours_to_merge).toBe(2);
  });

  it("bot-authored PRs never count toward team numbers, nor do reviews of them", () => {
    const r = aggregateWindow(win([
      pr(1, "dependabot[bot]", 1, [rv("bob", "APPROVED", 0.5), rv("carol", "APPROVED", 0.5)]),
      pr(2, "alice", 5, [rv("bob", "APPROVED", 1)]),
    ]), noLinks);
    expect(r).toMatchObject({ prs_merged_total: 1, bot_prs_merged: 1, prs_human_reviewed: 1, prs_no_human_review: 0, median_hours_to_merge: 5 });
    // bob reviewed 1 human PR (not 2): reviews_given and the bus factor are over human-authored PRs only.
    expect(r.contributors.find((c) => c.login === "bob")!.reviews_given).toBe(1);
    expect(r.contributors.find((c) => c.login === "carol")).toBeUndefined();
    expect(r.review_pairs.filter((p) => p.author_bot).map((p) => p.reviewer).sort()).toEqual(["bob", "carol"]);
    expect(r.reviewer_matrix).toEqual([{ author: "alice", reviewer: "bob", count: 1 }]);
  });

  it("every row carries a person key: one per canonical person, stable across links", () => {
    const facts = [pr(1, "alice", 1), pr(2, "alice-work", 1)];
    const plain = aggregateWindow(win(facts), noLinks);
    const linked = aggregateWindow(win(facts), makeCanonical([{ alias_login: "alice-work", primary_login: "alice" }]));
    const keyOf = (r: typeof plain, l: string) => r.contributors.find((c) => c.login === l)!.person_key;
    expect(keyOf(plain, "alice")).not.toBe(keyOf(plain, "alice-work"));
    expect(linked.contributors).toHaveLength(1);
    expect(linked.contributors[0].person_key).toBe(keyOf(plain, "alice"));
    expect(keyOf(plain, "alice")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("reviews between linked logins are self-reviews, not human review; self-merge follows links", () => {
    const facts = [
      pr(1, "alice", 2, [rv("alice-work", "APPROVED", 1)], { merged_by: "alice-work" }),
      pr(2, "alice", 2, [rv("bob", "APPROVED", 1)]),
    ];
    const plain = aggregateWindow(win(facts), noLinks);
    expect(plain).toMatchObject({ prs_human_reviewed: 2, prs_self_merged: 0, linked_self_reviews: 0 });
    const linked = aggregateWindow(win(facts), makeCanonical([{ alias_login: "alice-work", primary_login: "alice" }]));
    expect(linked).toMatchObject({ prs_human_reviewed: 1, prs_no_human_review: 1, prs_self_merged: 1, linked_self_reviews: 1 });
    expect(linked.review_pairs).toEqual([{ author: "alice", reviewer: "bob", prs: 1, bot: false, author_bot: false }]);
    const alice = linked.contributors.find((c) => c.linked_logins)!;
    expect(alice).toMatchObject({ login: "alice", linked_logins: ["alice", "alice-work"], prs_merged: 2, self_merge_count: 1 });
  });

  it("coverage mirrors partial facts", () => {
    const r = aggregateWindow(win([pr(1, "alice", 1)], { partial: true, total_merged: 80, truncated_review_prs: 3 }), noLinks);
    expect(r.coverage).toEqual({ partial: true, capped: false, fetched_prs: 1, total_prs: 80, truncated_review_prs: 3 });
    expect(r.partial).toBe(true);
  });
});

// ── GraphQL fetch ────────────────────────────────────────────────────────────

type Node = Record<string, unknown>;
const node = (n: number, o: Node = {}): Node => ({
  number: n, createdAt: at(0), mergedAt: at(3), additions: 5, deletions: 1,
  author: { login: "Alice", avatarUrl: "a/Alice", __typename: "User" }, mergedBy: { login: "Alice", __typename: "User" },
  reviews: { totalCount: 1, nodes: [{ author: { login: "github-advanced-security", avatarUrl: "", __typename: "Bot" }, state: "COMMENTED", submittedAt: at(1) }] },
  ...o,
});
/** Pages are served by cursor (c0, c1, …) so parallel slices each walk the same list. */
function gqlOctokit(pages: Node[][], opts: { failAt?: number; remaining?: number } = {}) {
  const graphql = vi.fn(async (_q: string, vars: Record<string, unknown>) => {
    const i = vars.cursor ? Number(String(vars.cursor).slice(1)) + 1 : 0;
    if (opts.failAt === i) throw Object.assign(new Error("API rate limit exceeded"), { status: 403 });
    return {
      rateLimit: { cost: 1, remaining: opts.remaining ?? 4000 },
      ...(vars.first ? { opened: { issueCount: 7 } } : {}),
      search: { issueCount: pages.flat().length, pageInfo: { hasNextPage: i < pages.length - 1, endCursor: `c${i}` }, nodes: pages[i] ?? [] },
    };
  });
  const rest = new Proxy({}, { get: () => { throw new Error("REST must not be called"); } });
  return { graphql, rest } as never as import("@octokit/rest").Octokit & { graphql: typeof graphql };
}

describe("fetchPrFactsWindow", () => {
  beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it("pages through search with GraphQL only, never waiting on rate limits; normalizes bots", async () => {
    const o = gqlOctokit([[node(1), node(2)], [node(3)]]);
    await fetchPrFactsWindow(o, "acme", "api", 30, new Date("2026-09-29T00:00:00Z"));
    expect(o.graphql).toHaveBeenCalledTimes(2);
    const [, vars] = o.graphql.mock.calls[0];
    expect(vars).toMatchObject({
      q: "repo:acme/api is:pr is:merged merged:>=2026-08-30", opened: "repo:acme/api is:pr created:>=2026-08-30",
      first: true, cursor: null, request: { noRateLimitWait: true },
    });
  });

  it("reads 90 days as three non-overlapping 30-day slices in parallel, opened counted once", async () => {
    const o = gqlOctokit([[node(1)]]);
    const w = await fetchPrFactsWindow(o, "acme", "api", 90, new Date("2026-09-29T00:00:00Z"));
    const qs = o.graphql.mock.calls.map(([, v]) => [v.q, v.first]);
    expect(qs).toEqual([
      ["repo:acme/api is:pr is:merged merged:2026-07-01..2026-07-30", false],
      ["repo:acme/api is:pr is:merged merged:2026-07-31..2026-08-29", false],
      ["repo:acme/api is:pr is:merged merged:>=2026-08-30", true],
    ]);
    // The mock returns PR 1 in every slice: deduplicated, while the counts add up per slice.
    expect(w.facts).toHaveLength(1);
    expect(w).toMatchObject({ total_merged: 3, opened_in_window: 7, graphql_cost: 3 });
  });

  it("paging within a slice follows the cursor", async () => {
    const o = gqlOctokit([[node(1), node(2)], [node(3)]]);
    const w = await fetchPrFactsWindow(o, "acme", "api", 30);
    expect(o.graphql.mock.calls[1][1]).toMatchObject({ first: false, cursor: "c0" });
    expect(w).toMatchObject({ total_merged: 3, opened_in_window: 7, partial: false, capped: false, graphql_cost: 2 });
    expect(w.facts[0]).toMatchObject({ author: "alice", merged_by: "alice", size: 6, reviews: [{ reviewer: "github-advanced-security[bot]", state: "COMMENTED" }] });
    expect(w.people["github-advanced-security[bot]"]).toEqual({ login: "github-advanced-security[bot]", avatar_url: "", bot: true });
    expect(w.people.alice).toMatchObject({ login: "Alice", bot: false });
  });

  it("a failing page ends the fetch at once with partial data", async () => {
    const o = gqlOctokit([[node(1)], [node(2)], [node(3)]], { failAt: 1 });
    const w = await fetchPrFactsWindow(o, "acme", "api", 30);
    expect(o.graphql).toHaveBeenCalledTimes(2);
    expect(w).toMatchObject({ partial: true });
    expect(w.facts).toHaveLength(1);
  });

  it("stops at the page cap (capped, not partial) and when the GraphQL budget runs low (partial)", async () => {
    const many = Array.from({ length: MAX_SEARCH_PAGES + 2 }, (_, i) => [node(i)]);
    const capped = gqlOctokit(many);
    expect(await fetchPrFactsWindow(capped, "a", "b", 30)).toMatchObject({ capped: true, partial: false });
    expect(capped.graphql).toHaveBeenCalledTimes(MAX_SEARCH_PAGES);
    const low = gqlOctokit([[node(1)], [node(2)]], { remaining: 100 });
    expect((await fetchPrFactsWindow(low, "a", "b", 30)).partial).toBe(true);
    expect(low.graphql).toHaveBeenCalledTimes(1);
  });

  it("a PR with more reviews than read is counted, not partial", async () => {
    const o = gqlOctokit([[node(1, { reviews: { totalCount: 25, nodes: [] } })]]);
    const w = await fetchPrFactsWindow(o, "a", "b", 30);
    expect(w).toMatchObject({ partial: false, truncated_review_prs: 1 });
    expect(w.facts[0].reviews_truncated).toBe(true);
  });
});

// ── Route ────────────────────────────────────────────────────────────────────

let octo: ReturnType<typeof gqlOctokit>;
let token = "tok-a";
let visible = true;
let links: { alias_login: string; primary_login: string }[] = [];
vi.mock("@/lib/session", () => ({ getTokenFromSession: async () => token }));
vi.mock("@/lib/github", () => ({ getOctokit: () => octo }));
vi.mock("@/lib/repo-access", () => ({ canSeeRepo: async () => visible }));
vi.mock("@/lib/identity-links", async (orig) => {
  const real = await orig<typeof import("@/lib/identity-links")>();
  return { ...real, loadCanonical: async () => ({ canonical: real.makeCanonical(links), links }) };
});

async function call(qs: string) {
  const { GET } = await import("@/app/api/github/repo-contributors/route");
  const res = await GET(new NextRequest(`http://localhost/api/github/repo-contributors?${qs}`));
  return { status: res.status, body: await res.json() };
}

describe("GET /api/github/repo-contributors?days", () => {
  let pg: PGlite;
  beforeEach(async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const cache = await import("@/lib/cache");
    cache.__resetCacheForTests();
    const l2 = await import("@/lib/cache-l2");
    l2.__resetL2ForTests();
    const db = await import("@/lib/db");
    pg = new PGlite();
    db.__setDbClientForTests((await import("./setup/pglite")).createPgliteClient(pg));
    await db.ensureSchema();
    vi.stubEnv("DATABASE_URL", "postgres://test@localhost/test");
    octo = gqlOctokit([[node(1), node(2, { author: { login: "alice-work", __typename: "User" } })]]);
    token = "tok-a";
    visible = true;
    links = [];
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    (await import("@/lib/db")).__setDbClientForTests(null);
  });

  it("400 on a bad window; 404 when the viewer's token cannot see the repo", async () => {
    expect((await call("owner=acme&repo=api&days=7")).status).toBe(400);
    visible = false;
    expect((await call("owner=acme&repo=api&days=30")).status).toBe(404);
    expect(octo.graphql).not.toHaveBeenCalled();
  });

  it("facts are fetched once per repo and served to every viewer who can see it", async () => {
    expect((await call("owner=acme&repo=api&days=30")).body.prs_merged_total).toBe(2);
    token = "tok-b";
    expect((await call("owner=Acme&repo=API&days=30")).body.prs_merged_total).toBe(2);
    expect(octo.graphql).toHaveBeenCalledTimes(1);
  });

  it("links apply on the next load without refetching the facts", async () => {
    const before = (await call("owner=acme&repo=api&days=30")).body;
    expect(before.contributors.map((c: { login: string }) => c.login).sort()).toEqual(["Alice", "alice-work", "github-advanced-security[bot]"].sort());
    links = [{ alias_login: "alice-work", primary_login: "alice" }];
    const after = (await call("owner=acme&repo=api&days=30")).body;
    expect(after.contributors.find((c: { linked_logins?: string[] }) => c.linked_logins)).toMatchObject({ prs_merged: 2 });
    expect(octo.graphql).toHaveBeenCalledTimes(1);
  });

  it("an old-shape L2 row is never read by the windowed path", async () => {
    const { l2Set } = await import("@/lib/cache-l2");
    const { hashKey } = await import("@/lib/cache");
    await l2Set(`github/repo-contributors:${hashKey("tok-a")}:acme:api`, { contributors: [{ login: "stale" }] }, 300);
    await l2Set(`github/repo-contributors:facts:acme/api:30`, { facts: "old shape" }, 300);
    const { body } = await call("owner=acme&repo=api&days=30");
    expect(body.contributors.some((c: { login: string }) => c.login === "stale")).toBe(false);
    expect(body.coverage).toEqual({ partial: false, capped: false, fetched_prs: 2, total_prs: 2, truncated_review_prs: 0 });
    const rows = await pg.query<{ key: string }>(`SELECT key FROM api_cache WHERE key LIKE '%:v2:%'`);
    expect(rows.rows.map((r) => r.key)).toEqual(["github/repo-contributors:v2:facts:acme/api:30"]);
  });
});
