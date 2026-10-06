import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { __setDbClientForTests, ensureSchema, type DbClient } from "@/lib/db";
import { l2Get, l2Set, l2Delete, l2Purge, isL2Enabled, __resetL2ForTests } from "@/lib/cache-l2";
import { createPgliteClient } from "./setup/pglite";

let pg: PGlite;

async function rowCount(): Promise<number> {
  const r = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM api_cache`);
  return r.rows[0].n;
}

beforeEach(async () => {
  pg = new PGlite();
  __setDbClientForTests(createPgliteClient(pg));
  await ensureSchema();
  __resetL2ForTests();
  process.env.DATABASE_URL = "postgres://test@localhost/test";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  __setDbClientForTests(null);
  delete process.env.DATABASE_URL;
  vi.restoreAllMocks();
});

describe("cache-l2", () => {
  it("is disabled without DATABASE_URL and never touches a DB", async () => {
    delete process.env.DATABASE_URL;
    expect(isL2Enabled()).toBe(false);
    await l2Set("github/repos:abc", [1], 60);
    expect(await l2Get("github/repos:abc")).toBeUndefined();
  });

  it("round-trips a value with its remaining TTL", async () => {
    await l2Set("github/repos:abc", { repos: ["a", "b"] }, 60);
    const hit = await l2Get<{ repos: string[] }>("github/repos:abc");
    expect(hit?.value).toEqual({ repos: ["a", "b"] });
    expect(hit!.ttlSeconds).toBeGreaterThan(55);
    expect(hit!.ttlSeconds).toBeLessThanOrEqual(67); // +10% jitter max
  });

  it("upserts on conflict instead of failing", async () => {
    await l2Set("k:1", { v: 1 }, 60);
    await l2Set("k:1", { v: 2 }, 60);
    expect((await l2Get<{ v: number }>("k:1"))?.value).toEqual({ v: 2 });
    expect(await rowCount()).toBe(1);
  });

  it("treats an expired row as a miss and deletes it", async () => {
    await l2Set("k:old", { v: 1 }, 60);
    await pg.query(`UPDATE api_cache SET expires_at = NOW() - interval '1 second' WHERE key = 'k:old'`);
    expect(await l2Get("k:old")).toBeUndefined();
    expect(await rowCount()).toBe(0);
  });

  it("skips values above the size limit", async () => {
    await l2Set("big:1", { blob: "x".repeat(600 * 1024) }, 60);
    expect(await rowCount()).toBe(0);
  });

  it("deletes by key", async () => {
    await l2Set("a:1", 1, 60);
    await l2Set("b:2", 2, 60);
    await l2Delete("a:1");
    const keys = (await pg.query<{ key: string }>(`SELECT key FROM api_cache ORDER BY key`)).rows.map((r) => r.key);
    expect(keys).toEqual(["b:2"]);
  });

  it("GITDASH_L2_CACHE=0 turns the layer off", async () => {
    process.env.GITDASH_L2_CACHE = "0";
    try {
      expect(isL2Enabled()).toBe(false);
      await l2Set("off:1", 1, 60);
      expect(await rowCount()).toBe(0);
    } finally {
      delete process.env.GITDASH_L2_CACHE;
    }
  });

  it("purges a backlog larger than one batch", async () => {
    await pg.query(
      `INSERT INTO api_cache (key, value, expires_at)
       SELECT 'old:' || g, '1'::jsonb, NOW() - interval '1 minute' FROM generate_series(1, 2500) g`,
    );
    // Seed directly: l2Set may run its own 1%-sampled purge and remove the backlog first.
    await pg.query(`INSERT INTO api_cache (key, value, expires_at) VALUES ('keep:1', '1'::jsonb, NOW() + interval '1 minute')`);
    expect(await l2Purge(10_000)).toBe(2500);
    expect(await rowCount()).toBe(1);
  });

  it("ignores values with no JSON form instead of throwing", async () => {
    await expect(l2Set("u:1", undefined, 60)).resolves.toBeUndefined();
    expect(await rowCount()).toBe(0);
  });

  it("purges only expired rows", async () => {
    await l2Set("a:1", 1, 60);
    await l2Set("a:2", 2, 60);
    await pg.query(`UPDATE api_cache SET expires_at = NOW() - interval '1 second' WHERE key = 'a:1'`);
    expect(await l2Purge()).toBe(1);
    expect(await rowCount()).toBe(1);
  });

  it("a hanging database costs one bounded wait, then the breaker skips L2", async () => {
    const hang = () => new Promise(() => {});
    __setDbClientForTests(Object.assign(hang, { query: hang, transaction: hang }) as unknown as DbClient);
    let t = Date.now();
    expect(await l2Get("k")).toBeUndefined();
    expect(Date.now() - t).toBeLessThan(2_500); // schema-check budget
    t = Date.now();
    expect(await l2Get("k")).toBeUndefined();
    await l2Set("k", 1, 60);
    expect(Date.now() - t).toBeLessThan(50); // breaker open: no DB wait at all
  });

  it("a failing database is a miss / no-op, never a thrown error", async () => {
    const broken = Object.assign(() => Promise.reject(new Error("db down")), {
      query: () => Promise.reject(new Error("db down")),
      transaction: () => Promise.reject(new Error("db down")),
    }) as unknown as DbClient;
    __setDbClientForTests(broken);
    await expect(l2Get("k")).resolves.toBeUndefined();
    await expect(l2Set("k", 1, 60)).resolves.toBeUndefined();
    await expect(l2Delete("k")).resolves.toBeUndefined();
    await expect(l2Purge()).resolves.toBe(0);
  });
});

describe("withCache with the shared layer", () => {
  it("a second instance (cold L1) is served from L2 without running the factory", async () => {
    const { withCache, __resetCacheForTests } = await import("@/lib/cache");
    const factory = vi.fn(async () => ({ repos: 3 }));
    await withCache("github/org-overview:tok:acme:10", 900, factory, { shared: true });
    __resetCacheForTests(); // instance B: empty in-memory cache, same database
    const b = await withCache("github/org-overview:tok:acme:10", 900, factory, { shared: true });
    expect(b).toEqual({ repos: 3 });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("non-shared keys (settings/secrets pattern) never reach api_cache", async () => {
    const { withCache } = await import("@/lib/cache");
    await withCache("ai-provider:settings", 60, async () => ({ apiKey: "sk-test-not-real" }));
    await withCache("email-provider:settings", 60, async () => ({ apiKey: "re-test-not-real" }));
    expect(await rowCount()).toBe(0);
  });

  it("refresh overwrites the shared entry for every instance", async () => {
    const { withCache, __resetCacheForTests } = await import("@/lib/cache");
    await withCache("github/repos:tok", 60, async () => "old", { shared: true });
    await withCache("github/repos:tok", 60, async () => "new", { shared: true, refresh: true });
    __resetCacheForTests();
    expect(await withCache("github/repos:tok", 60, async () => "factory", { shared: true })).toBe("new");
  });

  it("a partial result is stored with the short TTL", async () => {
    const { withCache, partialAwareTtl } = await import("@/lib/cache");
    await withCache("github/repo-dora:tok:o:r", 300, async () => ({ partial: true }), {
      shared: true,
      ttlFor: partialAwareTtl(300),
    });
    const hit = await l2Get("github/repo-dora:tok:o:r");
    expect(hit!.ttlSeconds).toBeLessThanOrEqual(33);
  });

  it("with the database down, the factory result is still returned", async () => {
    const { withCache } = await import("@/lib/cache");
    __setDbClientForTests(
      Object.assign(() => Promise.reject(new Error("down")), {
        query: () => Promise.reject(new Error("down")),
        transaction: () => Promise.reject(new Error("down")),
      }) as unknown as DbClient,
    );
    await expect(withCache("github/x:tok", 60, async () => 42, { shared: true })).resolves.toBe(42);
  });

  it("without DATABASE_URL (standalone default) the database is never touched", async () => {
    const { withCache } = await import("@/lib/cache");
    delete process.env.DATABASE_URL;
    const q = vi.fn(() => Promise.reject(new Error("must not be called")));
    __setDbClientForTests(Object.assign(q, { query: q, transaction: q }) as unknown as DbClient);
    await withCache("github/y:tok", 60, async () => 1, { shared: true });
    expect(q).not.toHaveBeenCalled();
  });
});

describe("shared-layer usage (static scan)", () => {
  it("only /api/github routes opt into the shared layer", async () => {
    const { readdirSync, readFileSync, statSync } = await import("fs");
    const { join } = await import("path");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
      });
    const src = join(__dirname, "..", "src");
    const offenders = walk(src)
      .filter((f) => {
        const code = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
        return code.some((l) => /shared:\s*true/.test(l));
      })
      // The loaders hold the cache calls of the /api/github routes.
      .filter((f) => !f.includes(join("src", "app", "api", "github")) && !f.includes(join("src", "lib", "loaders")));
    expect(offenders).toEqual([]);
  });
});
