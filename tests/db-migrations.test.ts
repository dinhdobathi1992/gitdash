import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { __setDbClientForTests, ensureSchema, MIGRATIONS } from "@/lib/db";
import { createPgliteClient } from "./setup/pglite";

let pg: PGlite;

async function tableExists(name: string): Promise<boolean> {
  const r = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = $1`,
    [name],
  );
  return r.rows[0].n === 1;
}

async function recordedVersions(): Promise<number[]> {
  const r = await pg.query<{ version: number }>(`SELECT version FROM schema_migrations ORDER BY version`);
  return r.rows.map((x) => x.version);
}

beforeEach(() => {
  pg = new PGlite();
  __setDbClientForTests(createPgliteClient(pg));
});

afterEach(() => {
  __setDbClientForTests(null);
});

describe("ensureSchema", () => {
  it("applies every migration and records each version once", async () => {
    await ensureSchema();
    expect(await recordedVersions()).toEqual(MIGRATIONS.map((m) => m.version));
    expect(await tableExists("workflow_runs")).toBe(true);
  });

  it("two instances re-running migrations are idempotent (no duplicate records)", async () => {
    // Two "instances" sharing one database, each with its own schema flag.
    // PGlite has a single connection and serializes queries, so this cannot
    // prove lock behaviour under true concurrency — that is covered by
    // tests/db-migrations.local-pg.test.ts against a real Postgres.
    const clientA = createPgliteClient(pg);
    const clientB = createPgliteClient(pg);
    __setDbClientForTests(clientA);
    const a = ensureSchema();
    __setDbClientForTests(clientB);
    const b = ensureSchema();
    await expect(Promise.all([a, b])).resolves.toBeDefined();
    expect(await recordedVersions()).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it("recovers when a migration's table already exists but the version was never recorded", async () => {
    await ensureSchema();
    await pg.query(`DELETE FROM schema_migrations WHERE version = $1`, [MIGRATIONS[0].version]);
    __setDbClientForTests(createPgliteClient(pg)); // fresh instance, schema flag reset
    await expect(ensureSchema()).resolves.toBeUndefined();
    expect(await recordedVersions()).toContain(MIGRATIONS[0].version);
  });

  it("a migration failing part-way leaves no partial tables and no version row", async () => {
    const bad = {
      version: 9_999,
      name: "test_partial_failure",
      up: [
        `CREATE TABLE IF NOT EXISTS partial_probe (id INT)`,
        `THIS IS NOT SQL`,
      ],
    };
    MIGRATIONS.push(bad);
    try {
      await expect(ensureSchema()).rejects.toThrow();
      expect(await tableExists("partial_probe")).toBe(false);
      expect(await recordedVersions()).not.toContain(bad.version);
    } finally {
      MIGRATIONS.pop();
    }
  });
});

describe("local Neon endpoint guard", () => {
  it("refuses a non-loopback NEON_LOCAL_FETCH_ENDPOINT so credentials never leave the machine", async () => {
    __setDbClientForTests(null);
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    process.env.NEON_LOCAL_FETCH_ENDPOINT = "http://db.example.com/sql";
    try {
      await expect(ensureSchema()).rejects.toThrow(/localhost or 127\.0\.0\.1/);
    } finally {
      delete process.env.DATABASE_URL;
      delete process.env.NEON_LOCAL_FETCH_ENDPOINT;
    }
  });
});
