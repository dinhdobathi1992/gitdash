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
});
