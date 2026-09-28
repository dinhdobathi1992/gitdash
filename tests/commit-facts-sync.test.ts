import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { __setDbClientForTests, ensureSchema, upsertPrFacts } from "@/lib/db";
import {
  syncPrCommitFacts, mapPrCommits, buildChunkQuery, CHUNK_SIZE, type CommitNode, type PrCommitsNode,
} from "@/lib/commit-facts-sync";
import { createPgliteClient } from "./setup/pglite";

const REPO = "acme/api";
const NOW = new Date("2026-09-28T12:00:00Z");
let pg: PGlite;

const commit = (oid: string, o: Partial<CommitNode["commit"]> = {}): CommitNode => ({
  commit: {
    oid, additions: 10, deletions: 5, changedFilesIfAvailable: 2, committedDate: "2026-09-01T00:00:00Z",
    parents: { totalCount: 1 }, author: { user: { login: "alice" } }, ...o,
  },
});

const prNode = (nodes: CommitNode[], o: Partial<PrCommitsNode["commits"]> = {}, author = "alice"): PrCommitsNode => ({
  author: { login: author },
  commits: { totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes, ...o },
});

async function seedPrs(prs: { n: number; mergedDaysAgo: number | null; author?: string }[]) {
  await upsertPrFacts(prs.map(({ n, mergedDaysAgo, author }) => {
    const merged = mergedDaysAgo === null ? null : new Date(NOW.getTime() - mergedDaysAgo * 86_400_000).toISOString();
    return {
      repo: REPO, pr_number: n, author: author ?? "alice", created_at: "2026-06-01T00:00:00Z", merged_at: merged,
      closed_at: merged, first_review_at: null, approved_at: null, additions: 1, deletions: 1, review_count: 0,
      state: merged ? "closed" : "open", commit_count: null, changed_files: null,
    };
  }));
}

/** Fake octokit whose graphql answers from a PR-number → node map; records the numbers asked per call. */
function fakeOctokit(nodes: Record<number, PrCommitsNode | null | "error">, pages: Record<string, CommitNode[]> = {}) {
  const calls: number[][] = [];
  const graphql = vi.fn(async (query: string, vars: Record<string, unknown>) => {
    if (typeof vars.cursor === "string") {
      const rest = pages[`${vars.number}:${vars.cursor}`];
      if (!rest) throw new Error("page failed");
      return { repository: { pullRequest: { commits: { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: rest } } } };
    }
    const numbers = [...query.matchAll(/p(\d+): pullRequest/g)].map((m) => Number(m[1]));
    calls.push(numbers);
    const repository: Record<string, PrCommitsNode | null> = {};
    let hasError = false;
    for (const n of numbers) {
      const v = nodes[n];
      if (v === "error" || v === undefined) { repository[`p${n}`] = null; hasError = true; } else repository[`p${n}`] = v;
    }
    if (hasError) throw Object.assign(new Error("partial"), { name: "GraphqlResponseError", data: { repository } });
    return { repository };
  });
  return { octokit: { graphql } as never, graphql, calls };
}

async function stored() {
  const r = await pg.query<{ sha: string; pr_number: number; author: string; author_linked: boolean; files: number | null; is_merge: boolean }>(
    `SELECT sha, pr_number, author, author_linked, files, is_merge FROM pr_commit_facts WHERE repo = $1 ORDER BY sha`, [REPO]);
  return r.rows;
}
async function syncedPrs() {
  const r = await pg.query<{ pr_number: number; commit_count: number | null }>(
    `SELECT pr_number, commit_count FROM pr_facts WHERE repo = $1 AND commits_synced_at IS NOT NULL ORDER BY pr_number`, [REPO]);
  return r.rows;
}

beforeEach(async () => {
  pg = new PGlite();
  __setDbClientForTests(createPgliteClient(pg));
  await ensureSchema();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  __setDbClientForTests(null);
  vi.restoreAllMocks();
});

describe("mapPrCommits", () => {
  it("uses the linked login, else the PR author with author_linked=false", () => {
    const rows = mapPrCommits(REPO, 7, "pr-owner", [
      commit("a"),
      commit("b", { author: { user: null } }),
      commit("c", { author: null }),
    ]);
    expect(rows.map((r) => [r.sha, r.author, r.author_linked])).toEqual([
      ["a", "alice", true], ["b", "pr-owner", false], ["c", "pr-owner", false],
    ]);
  });

  it("flags merge commits and keeps null file counts", () => {
    const [row] = mapPrCommits(REPO, 7, null, [commit("m", { parents: { totalCount: 2 }, changedFilesIfAvailable: null })]);
    expect(row).toMatchObject({ is_merge: true, files: null, additions: 10, deletions: 5, pr_number: 7 });
  });
});

describe("buildChunkQuery", () => {
  it("aliases each PR", () => {
    const q = buildChunkQuery([3, 12]);
    expect(q).toContain("p3: pullRequest(number: 3)");
    expect(q).toContain("p12: pullRequest(number: 12)");
  });
});

describe("syncPrCommitFacts", () => {
  const far = () => Date.now() + 60_000;

  it("stores commits of merged PRs in the window only, oldest first", async () => {
    await seedPrs([{ n: 1, mergedDaysAgo: 10 }, { n: 2, mergedDaysAgo: 30 }, { n: 3, mergedDaysAgo: null }, { n: 4, mergedDaysAgo: 120 }]);
    const { octokit, calls } = fakeOctokit({ 1: prNode([commit("a1")]), 2: prNode([commit("b1"), commit("b2")]) });
    const r = await syncPrCommitFacts(octokit, "acme", "api", far(), NOW);
    expect(calls).toEqual([[2, 1]]);
    expect(r).toMatchObject({ prs_synced: 2, rows: 3, failed: 0, remaining: 0, graphql_calls: 1 });
    expect(await syncedPrs()).toEqual([{ pr_number: 1, commit_count: 1 }, { pr_number: 2, commit_count: 2 }]);
  });

  it("a commit shared by stacked PRs stays with the earlier-merged PR", async () => {
    await seedPrs([{ n: 5, mergedDaysAgo: 2 }, { n: 4, mergedDaysAgo: 3 }]);
    const { octokit } = fakeOctokit({
      4: prNode([commit("base")]),
      5: prNode([commit("base"), commit("top")]),
    });
    await syncPrCommitFacts(octokit, "acme", "api", far(), NOW);
    expect((await stored()).map((r) => [r.sha, r.pr_number])).toEqual([["base", 4], ["top", 5]]);
  });

  it("a later run does not move a stored commit to another PR", async () => {
    await seedPrs([{ n: 4, mergedDaysAgo: 3 }]);
    await syncPrCommitFacts(fakeOctokit({ 4: prNode([commit("base")]) }).octokit, "acme", "api", far(), NOW);
    await seedPrs([{ n: 5, mergedDaysAgo: 1 }]);
    await syncPrCommitFacts(fakeOctokit({ 5: prNode([commit("base"), commit("top")]) }).octokit, "acme", "api", far(), NOW);
    expect((await stored()).map((r) => [r.sha, r.pr_number])).toEqual([["base", 4], ["top", 5]]);
  });

  it("a partial GraphQL error keeps the PRs that resolved", async () => {
    await seedPrs([{ n: 1, mergedDaysAgo: 5 }, { n: 2, mergedDaysAgo: 4 }]);
    const { octokit } = fakeOctokit({ 1: "error", 2: prNode([commit("b1")]) });
    const r = await syncPrCommitFacts(octokit, "acme", "api", far(), NOW);
    expect(r).toMatchObject({ prs_synced: 1, failed: 1, remaining: 1 });
    expect((await syncedPrs()).map((p) => p.pr_number)).toEqual([2]);
  });

  it("a network error leaves the whole chunk for the next run", async () => {
    await seedPrs([{ n: 1, mergedDaysAgo: 5 }]);
    const octokit = { graphql: vi.fn().mockRejectedValue(new Error("ECONNRESET")) } as never;
    const r = await syncPrCommitFacts(octokit, "acme", "api", far(), NOW);
    expect(r).toMatchObject({ prs_synced: 0, failed: 1, remaining: 1 });
    expect(await syncedPrs()).toEqual([]);
  });

  it("fetches further pages for PRs with more than 100 commits", async () => {
    await seedPrs([{ n: 9, mergedDaysAgo: 1 }]);
    const first = Array.from({ length: 100 }, (_, i) => commit(`c${i}`));
    const { octokit } = fakeOctokit(
      { 9: prNode(first, { totalCount: 102, pageInfo: { hasNextPage: true, endCursor: "X" } }) },
      { "9:X": [commit("c100"), commit("c101")] },
    );
    const r = await syncPrCommitFacts(octokit, "acme", "api", far(), NOW);
    expect(r).toMatchObject({ prs_synced: 1, rows: 102, graphql_calls: 2 });
    expect(await syncedPrs()).toEqual([{ pr_number: 9, commit_count: 102 }]);
  });

  it("a failed extra page leaves that PR unsynced with no rows", async () => {
    await seedPrs([{ n: 9, mergedDaysAgo: 1 }]);
    const { octokit } = fakeOctokit({
      9: prNode([commit("c0")], { totalCount: 150, pageInfo: { hasNextPage: true, endCursor: "Y" } }),
    });
    const r = await syncPrCommitFacts(octokit, "acme", "api", far(), NOW);
    expect(r).toMatchObject({ prs_synced: 0, failed: 1 });
    expect(await stored()).toEqual([]);
  });

  it("a null commit node leaves that PR unsynced; its chunk-mates are stored", async () => {
    await seedPrs([{ n: 1, mergedDaysAgo: 5 }, { n: 2, mergedDaysAgo: 4 }]);
    const { octokit } = fakeOctokit({ 1: prNode([commit("a"), null as unknown as CommitNode]), 2: prNode([commit("b")]) });
    const r = await syncPrCommitFacts(octokit, "acme", "api", far(), NOW);
    expect(r).toMatchObject({ prs_synced: 1, failed: 1 });
    expect((await stored()).map((x) => x.sha)).toEqual(["b"]);
  });

  it("a chunk that throws does not abort the repo", async () => {
    await seedPrs([{ n: 1, mergedDaysAgo: 5 }]);
    const octokit = { graphql: vi.fn().mockResolvedValue({ repository: { p1: { author: null, commits: null } } }) } as never;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = { graphql: vi.fn().mockResolvedValue({ repository: { p1: { author: null, commits: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [{ commit: { oid: "x", parents: null } }] } } } }) } as never;
    await expect(syncPrCommitFacts(bad, "acme", "api", far(), NOW)).resolves.toMatchObject({ prs_synced: 0, failed: 1 });
    await expect(syncPrCommitFacts(octokit, "acme", "api", far(), NOW)).resolves.toMatchObject({ failed: 1 });
  });

  it("a merged PR with zero commits is marked synced", async () => {
    await seedPrs([{ n: 1, mergedDaysAgo: 1 }]);
    const r = await syncPrCommitFacts(fakeOctokit({ 1: prNode([]) }).octokit, "acme", "api", far(), NOW);
    expect(r).toMatchObject({ prs_synced: 1, rows: 0 });
    expect(await syncedPrs()).toEqual([{ pr_number: 1, commit_count: 0 }]);
  });

  it("stops starting new chunks at the deadline and resumes next run", async () => {
    const prs = Array.from({ length: CHUNK_SIZE + 3 }, (_, i) => ({ n: i + 1, mergedDaysAgo: 50 - i }));
    await seedPrs(prs);
    const all = Object.fromEntries(prs.map(({ n }) => [n, prNode([commit(`s${n}`)])]));
    let fake = fakeOctokit(all);
    // The clock passes the deadline while the first chunk is in flight.
    let clock = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const graphql = fake.graphql.getMockImplementation()!;
    fake.graphql.mockImplementation(async (q, v) => { clock = 10; return graphql(q, v); });
    const r1 = await syncPrCommitFacts(fake.octokit, "acme", "api", 5, NOW);
    expect(r1).toMatchObject({ prs_synced: CHUNK_SIZE, remaining: 3, stopped_at_deadline: true });
    nowSpy.mockRestore();
    fake = fakeOctokit(all);
    const r2 = await syncPrCommitFacts(fake.octokit, "acme", "api", far(), NOW);
    expect(r2).toMatchObject({ prs_synced: 3, remaining: 0 });
    expect(await syncedPrs()).toHaveLength(CHUNK_SIZE + 3);
  });

  it("the REST owner of commit_count is not overwritten by GraphQL", async () => {
    await upsertPrFacts([{
      repo: REPO, pr_number: 1, author: "alice", created_at: "2026-09-01T00:00:00Z", merged_at: "2026-09-27T00:00:00Z",
      closed_at: null, first_review_at: null, approved_at: null, additions: 1, deletions: 1, review_count: 0,
      state: "closed", commit_count: 7, changed_files: 3,
    }]);
    await syncPrCommitFacts(fakeOctokit({ 1: prNode([commit("a")]) }).octokit, "acme", "api", far(), NOW);
    expect(await syncedPrs()).toEqual([{ pr_number: 1, commit_count: 7 }]);
  });
});
