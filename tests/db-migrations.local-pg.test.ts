/**
 * Integration check of ensureSchema() through the real @neondatabase/serverless
 * HTTP driver against a real Postgres — the local stack from
 * docker-compose.local-db.yml. Proves what the PGlite tests cannot: DDL inside
 * Neon HTTP transactions and advisory-lock serialization under true concurrency.
 *
 * Destructive: drops and recreates the `public` schema of the target database
 * first, so every run migrates from scratch. It refuses to run unless the
 * database name ends in `_test` (never the dev database). One-time setup:
 *   docker exec gitdash-local-db-postgres-1 createdb -U postgres gitdash_test
 * Skipped unless both variables are set:
 *
 *   LOCAL_PG_URL=postgres://postgres:postgres@localhost:55432/gitdash_test \
 *   NEON_LOCAL_FETCH_ENDPOINT=http://localhost:4444/sql \
 *   pnpm vitest run tests/db-migrations.local-pg.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const url = process.env.LOCAL_PG_URL;
const endpoint = process.env.NEON_LOCAL_FETCH_ENDPOINT;

describe.skipIf(!url || !endpoint)("ensureSchema against local Postgres (real Neon driver)", () => {
  beforeAll(async () => {
    if (!/@(localhost|127\.0\.0\.1):/.test(url!)) throw new Error("LOCAL_PG_URL must target localhost");
    if (!/\/[\w-]+_test(\?|$)/.test(url!)) throw new Error("LOCAL_PG_URL must name a *_test database (this test drops its schema)");
    const { neon, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.fetchEndpoint = endpoint!;
    const sql = neon(url!);
    await sql.transaction([sql.query("DROP SCHEMA public CASCADE"), sql.query("CREATE SCHEMA public")]);
    process.env.DATABASE_URL = url;
  });

  afterAll(() => {
    delete process.env.DATABASE_URL;
  });

  it("concurrent first-time runs from separate module instances both succeed", async () => {
    // Two independent module graphs = two app instances with their own
    // client and schema flag, racing on one empty database.
    vi.resetModules();
    const a = await import("@/lib/db");
    vi.resetModules();
    const b = await import("@/lib/db");
    expect(a).not.toBe(b);

    await expect(Promise.all([a.ensureSchema(), b.ensureSchema()])).resolves.toBeDefined();

    const { neon } = await import("@neondatabase/serverless");
    const rows = (await neon(url!)`SELECT version FROM schema_migrations ORDER BY version`) as { version: number }[];
    expect(rows.map((r) => r.version)).toEqual(a.MIGRATIONS.map((m) => m.version));
  });

  it("two admins demoting each other at the same moment cannot leave zero admins", async () => {
    vi.resetModules();
    const a = await import("@/lib/db");
    vi.resetModules();
    const b = await import("@/lib/db");
    await a.ensureSchema();
    for (const id of [101, 102]) await a.upsertUser({ id, login: `race${id}`, avatar_url: null });
    await a.setUserGroups(101, 101, ["admin"], []);
    await a.setUserGroups(101, 102, ["admin"], []);
    const results = await Promise.all([a.setUserGroups(101, 102, ["dev"], []), b.setUserGroups(102, 101, ["dev"], [])]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const { neon } = await import("@neondatabase/serverless");
    const rows = (await neon(url!)`SELECT count(*)::int AS n FROM user_groups WHERE group_name = 'admin'`) as { n: number }[];
    expect(rows[0].n).toBe(1);
  });

  it("working-habits helpers: commit facts insert, first PR keeps a shared sha, settings round-trip", async () => {
    vi.resetModules();
    const db = await import("@/lib/db");
    await db.ensureSchema();
    const repo = "acme/habits";
    const pr = (n: number, merged: string, commits: number | null) => ({
      repo, pr_number: n, author: "alice", created_at: "2026-09-01T00:00:00Z", merged_at: merged,
      closed_at: merged, first_review_at: null, approved_at: null, additions: 1, deletions: 1,
      review_count: 0, state: "closed", commit_count: commits, changed_files: 3,
    });
    await db.upsertPrFacts([pr(2, "2026-09-10T00:00:00Z", 5), pr(1, "2026-09-05T00:00:00Z", null)]);
    // A later REST run without a detail value keeps the stored count.
    await db.upsertPrFacts([pr(2, "2026-09-10T00:00:00Z", null)]);

    const pending = await db.listPrsNeedingCommitSync(repo, new Date("2026-08-01T00:00:00Z"));
    expect(pending.map((p) => p.pr_number)).toEqual([1, 2]);

    const commit = (sha: string, n: number, files: number | null) => ({
      repo, sha, pr_number: n, author: "alice", author_linked: files !== null, files,
      additions: 10, deletions: 2, is_merge: false, committed_at: null,
    });
    expect(await db.upsertPrCommitFacts([commit("a1", 1, 4), commit("shared", 1, null)])).toBe(2);
    expect(await db.upsertPrCommitFacts([commit("shared", 2, 9), commit("b1", 2, 1)])).toBe(1);
    await db.markPrCommitsSynced(repo, [{ pr_number: 1, total_count: 2 }, { pr_number: 2, total_count: 99 }]);

    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url!);
    const shared = (await sql`SELECT pr_number, files, author_linked FROM pr_commit_facts WHERE repo = ${repo} AND sha = 'shared'`) as { pr_number: number; files: number | null; author_linked: boolean }[];
    expect(shared).toEqual([{ pr_number: 1, files: null, author_linked: false }]);
    const counts = (await sql`SELECT pr_number, commit_count FROM pr_facts WHERE repo = ${repo} ORDER BY pr_number`) as { pr_number: number; commit_count: number }[];
    expect(counts).toEqual([{ pr_number: 1, commit_count: 2 }, { pr_number: 2, commit_count: 5 }]);
    expect(await db.listPrsNeedingCommitSync(repo, new Date("2026-08-01T00:00:00Z"))).toEqual([]);

    expect(await db.getWorkingHabitsSettings()).toBeNull();
    await db.saveWorkingHabitsSettings({ max_commit_files: 5, max_commit_lines: 100, max_pr_commits: 8, updated_by: "admin" });
    await db.saveWorkingHabitsSettings({ max_commit_files: 6, max_commit_lines: 100, max_pr_commits: 8, updated_by: "admin" });
    expect(await db.getWorkingHabitsSettings()).toMatchObject({ max_commit_files: 6, max_commit_lines: 100, max_pr_commits: 8, updated_by: "admin" });
  });
});
