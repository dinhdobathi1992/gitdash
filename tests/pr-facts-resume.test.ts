import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { __setDbClientForTests, ensureSchema, updateSyncCursor, getPrSyncCursor } from "@/lib/db";
import { fetchAndUpsertPrFacts } from "@/lib/sync";
import { createPgliteClient } from "./setup/pglite";

const REPO = "acme/api";
let pg: PGlite;

/** PRs 1..n, PR n updated most recently. `bump` moves a PR to the top. */
function fakeGithub(n: number) {
  const base = Date.parse("2026-09-01T00:00:00Z");
  const updated = new Map<number, number>();
  for (let i = 1; i <= n; i++) updated.set(i, base + i * 60_000);
  const listPages: number[] = [];
  const details: number[] = [];
  const pr = (i: number) => ({
    number: i, user: { login: "alice" }, created_at: new Date(base).toISOString(),
    merged_at: new Date(updated.get(i)!).toISOString(), closed_at: null, state: "closed",
    updated_at: new Date(updated.get(i)!).toISOString().replace(".000Z", "Z"),
  });
  const octokit = {
    rest: {
      pulls: {
        list: vi.fn(async ({ page, per_page }: { page: number; per_page: number }) => {
          listPages.push(page);
          const sorted = [...updated.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => pr(i));
          return { data: sorted.slice((page - 1) * per_page, page * per_page) };
        }),
        listReviews: vi.fn(async () => ({ data: [] })),
        get: vi.fn(async ({ pull_number }: { pull_number: number }) => {
          details.push(pull_number);
          return { data: { additions: 1, deletions: 1, commits: 2, changed_files: 1 } };
        }),
      },
    },
  };
  return {
    octokit: octokit as never, listPages, details,
    bump: (i: number, at: string) => updated.set(i, Date.parse(at)),
    newest: () => new Date(Math.max(...updated.values())).toISOString(),
  };
}

async function count() {
  return (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM pr_facts WHERE repo = $1`, [REPO])).rows[0].n;
}

beforeEach(async () => {
  pg = new PGlite();
  __setDbClientForTests(createPgliteClient(pg));
  await ensureSchema();
  await updateSyncCursor(REPO, 1);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  __setDbClientForTests(null);
  vi.restoreAllMocks();
});

describe("fetchAndUpsertPrFacts — backfill resume and incremental", () => {
  it("a backfill that fits in one run completes and sets the high-water mark", async () => {
    const gh = fakeGithub(250);
    const r = await fetchAndUpsertPrFacts(gh.octokit, "acme", "api");
    expect(r).toMatchObject({ processed: 250, backfillComplete: true, stoppedAtDeadline: false });
    expect(await getPrSyncCursor(REPO)).toEqual({ cursor: gh.newest(), backfillComplete: true, backfillPage: null });
  });

  it("a run cut by the deadline resumes at the next page", async () => {
    const gh = fakeGithub(250);
    // The clock passes the deadline while the first page is in flight.
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const list = (gh.octokit as unknown as { rest: { pulls: { list: ReturnType<typeof vi.fn> } } }).rest.pulls.list;
    const real = list.getMockImplementation() as (a: unknown) => Promise<{ data: unknown[] }>;
    list.mockImplementation(async (args) => { clock = 10; return real(args); });
    const r1 = await fetchAndUpsertPrFacts(gh.octokit, "acme", "api", 5);
    expect(r1).toMatchObject({ processed: 100, backfillComplete: false, stoppedAtDeadline: true });
    expect(await getPrSyncCursor(REPO)).toMatchObject({ backfillComplete: false, backfillPage: 2, cursor: gh.newest() });

    vi.mocked(Date.now).mockRestore();
    list.mockImplementation(real);
    gh.listPages.length = 0;
    const r2 = await fetchAndUpsertPrFacts(gh.octokit, "acme", "api");
    expect(gh.listPages).toEqual([2, 3]);
    expect(r2).toMatchObject({ processed: 150, backfillComplete: true });
    expect(await count()).toBe(250);
    expect(await getPrSyncCursor(REPO)).toMatchObject({ backfillComplete: true, backfillPage: null, cursor: gh.newest() });
  });

  it("the page cap no longer traps big repos: the next run continues", async () => {
    const gh = fakeGithub(1_050);
    const r1 = await fetchAndUpsertPrFacts(gh.octokit, "acme", "api");
    expect(r1).toMatchObject({ processed: 1_000, backfillComplete: false });
    expect((await getPrSyncCursor(REPO)).backfillPage).toBe(11);
    const r2 = await fetchAndUpsertPrFacts(gh.octokit, "acme", "api");
    expect(r2).toMatchObject({ processed: 50, backfillComplete: true });
    expect(await count()).toBe(1_050);
  });

  it("incremental runs fetch details only for PRs updated after the mark", async () => {
    const gh = fakeGithub(250);
    await fetchAndUpsertPrFacts(gh.octokit, "acme", "api");
    gh.details.length = 0;
    gh.bump(7, "2026-09-20T00:00:00Z");
    gh.bump(42, "2026-09-21T00:00:00Z");
    const r = await fetchAndUpsertPrFacts(gh.octokit, "acme", "api");
    expect(gh.details.sort((a, b) => a - b)).toEqual([7, 42]);
    expect(r).toMatchObject({ processed: 2, backfillComplete: true, apiCallCount: 1 + 2 * 2 });
    expect((await getPrSyncCursor(REPO)).cursor).toBe("2026-09-21T00:00:00.000Z");

    gh.details.length = 0;
    const idle = await fetchAndUpsertPrFacts(gh.octokit, "acme", "api");
    expect(idle).toMatchObject({ processed: 0, apiCallCount: 1 });
    expect(gh.details).toEqual([]);
  });

  it("an incremental run cut by the deadline keeps the old mark", async () => {
    const gh = fakeGithub(50);
    await fetchAndUpsertPrFacts(gh.octokit, "acme", "api");
    const before = (await getPrSyncCursor(REPO)).cursor;
    gh.bump(3, "2026-09-25T00:00:00Z");
    vi.spyOn(Date, "now").mockReturnValue(100);
    const r = await fetchAndUpsertPrFacts(gh.octokit, "acme", "api", 50);
    expect(r).toMatchObject({ processed: 0, stoppedAtDeadline: true, backfillComplete: true });
    expect((await getPrSyncCursor(REPO)).cursor).toBe(before);
  });
});
