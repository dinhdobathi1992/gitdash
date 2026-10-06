/**
 * MCP grant store, audit and retention against real Postgres.
 *
 * Always runs on PGlite (embedded Postgres) through the neon()-compatible
 * adapter. When LOCAL_PG_URL and NEON_LOCAL_FETCH_ENDPOINT are set, the same
 * suite also runs through the real @neondatabase/serverless HTTP driver
 * against the local stack (see tests/db-migrations.local-pg.test.ts for the
 * one-time setup). That backend is destructive: it drops the `public` schema
 * of a *_test database on localhost, and refuses anything else. Only there do
 * the parallel checks race on separate connections; PGlite serialises them.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi, type MockInstance } from "vitest";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createPgliteClient } from "./setup/pglite";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "s".repeat(24) + "-secret-for-mcp-grant-tests";
  delete process.env.MCP_PREVIOUS_SESSION_SECRET;
});

import { __setDbClientForTests, ensureSchema, getDb, MIGRATIONS, pruneMcpRetention, type DbClient } from "@/lib/db";
import {
  __clearGrantCacheForTests,
  consumeJti,
  createGrant,
  getActiveGrant,
  listGrants,
  pruneUnredeemed,
  redeemGrant,
  revokeGrant,
  rotateRefresh,
  sanitizeClientName,
} from "@/lib/mcp/oauth/grants";
import { auditMcp } from "@/lib/mcp/oauth/audit";
import { open, seal } from "@/lib/mcp/oauth/tokens";

const GH = "gho_FAKEtokenForGrantTests0123456789abc";
const USER = 4242;

type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

interface Backend {
  name: string;
  /** Create an empty database, point src/lib/db.ts at it, and return a raw query runner. */
  setup(): Promise<Query>;
  /** Point src/lib/db.ts at the same database again, as a fresh instance would. */
  attach(): void;
  teardown(): Promise<void>;
}

const pgliteBackend: Backend = (() => {
  let pg: PGlite | null = null;
  return {
    name: "PGlite",
    async setup() {
      pg = new PGlite();
      this.attach();
      return async (text, params = []) => (await pg!.query(text, params)).rows as Record<string, unknown>[];
    },
    attach() {
      __setDbClientForTests(createPgliteClient(pg!));
    },
    async teardown() {
      __setDbClientForTests(null);
      await pg?.close();
      pg = null;
    },
  };
})();

const url = process.env.LOCAL_PG_URL;
const endpoint = process.env.NEON_LOCAL_FETCH_ENDPOINT;

const localPgBackend: Backend = (() => {
  let client: DbClient | null = null;
  return {
    name: "local Postgres (real Neon driver)",
    async setup() {
      if (!/@(localhost|127\.0\.0\.1):/.test(url!)) throw new Error("LOCAL_PG_URL must target localhost");
      if (!/\/[\w-]+_test(\?|$)/.test(url!)) throw new Error("LOCAL_PG_URL must name a *_test database (this test drops its schema)");
      const { neon, neonConfig } = await import("@neondatabase/serverless");
      neonConfig.fetchEndpoint = endpoint!;
      const sql = neon(url!);
      await sql.transaction([sql.query("DROP SCHEMA public CASCADE"), sql.query("CREATE SCHEMA public")]);
      // neon() is typed per call options; db.ts holds the widened client type.
      client = sql as unknown as DbClient;
      this.attach();
      return async (text, params = []) => (await sql.query(text, params)) as Record<string, unknown>[];
    },
    attach() {
      __setDbClientForTests(client);
    },
    async teardown() {
      __setDbClientForTests(null);
      client = null;
    },
  };
})();

const backends: Backend[] = url && endpoint ? [pgliteBackend, localPgBackend] : [pgliteBackend];

const grantInput = { github_id: USER, client_id: "https://client.example/meta.json", client_name: "Claude", redirect_host: "claude.ai" };

describe.each(backends)("MCP grants on $name", (backend) => {
  let q: Query;
  let spies: MockInstance[] = [];

  beforeAll(async () => {
    q = await backend.setup();
    await ensureSchema();
  });

  afterAll(async () => {
    await backend.teardown();
  });

  beforeEach(() => {
    __clearGrantCacheForTests();
    spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
  });

  afterEach(() => {
    // No console output may ever carry the GitHub token or a sealed token.
    for (const s of spies) {
      for (const call of s.mock.calls) {
        const text = call.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" ");
        expect(text).not.toContain(GH);
        expect(text).not.toContain("Fe26.");
      }
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** rotateRefresh's outcome only. */
  const rot = async (g: string, presented: string, next: string) => (await rotateRefresh(g, presented, next)).outcome;

  async function redeemed() {
    const g = await createGrant(grantInput);
    expect(await redeemGrant(g.grant_id, g.current_refresh)).toBe(true);
    return g;
  }

  async function grantRow(id: string) {
    const [row] = await q(
      `SELECT current_refresh::text AS current_refresh, previous_refresh::text AS previous_refresh,
              revoked_at, revoked_reason FROM mcp_grants WHERE grant_id = $1`,
      [id],
    );
    return row as { current_refresh: string; previous_refresh: string | null; revoked_at: unknown; revoked_reason: string | null };
  }

  describe("migration 13", () => {
    it("records version 13 and creates both tables", async () => {
      const versions = (await q(`SELECT version FROM schema_migrations ORDER BY version`)).map((r) => Number(r.version));
      expect(versions).toContain(13);
      expect(versions).toEqual(MIGRATIONS.map((m) => m.version));
      const tables = await q(
        `SELECT table_name FROM information_schema.tables WHERE table_name IN ('mcp_grants','mcp_used_jti') ORDER BY 1`,
      );
      expect(tables.map((r) => r.table_name)).toEqual(["mcp_grants", "mcp_used_jti"]);
    });

    it("is idempotent: replaying its DDL and re-running ensureSchema change nothing", async () => {
      const g = await createGrant(grantInput);
      const m13 = MIGRATIONS.find((m) => m.version === 13)!;
      for (const sql of m13.up) await q(sql);
      await q(`DELETE FROM schema_migrations WHERE version = 13`);
      backend.attach();
      await ensureSchema();
      backend.attach();
      await ensureSchema();
      const rows = await q(`SELECT count(*)::int AS n FROM schema_migrations WHERE version = 13`);
      expect(rows[0].n).toBe(1);
      // Existing rows survive the replay.
      expect(await q(`SELECT 1 FROM mcp_grants WHERE grant_id = $1`, [g.grant_id])).toHaveLength(1);
    });
  });

  describe("consumeJti", () => {
    it("returns true once, then false", async () => {
      const jti = randomUUID();
      const exp = new Date(Date.now() + 60_000);
      expect(await consumeJti(jti, exp)).toBe(true);
      expect(await consumeJti(jti, exp)).toBe(false);
      expect(await consumeJti("not-a-uuid", exp)).toBe(false);
    });

    it("parallel consumers: exactly one wins", async () => {
      const jti = randomUUID();
      const exp = new Date(Date.now() + 60_000);
      const results = await Promise.all([consumeJti(jti, exp), consumeJti(jti, exp), consumeJti(jti, exp)]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  describe("createGrant / redeemGrant", () => {
    it("creates an unredeemed grant with a 30-day absolute expiry and a sanitised name", async () => {
      const g = await createGrant({ ...grantInput, client_name: "  Evil\u0000‮ App " + "x".repeat(200) });
      const days = (Date.parse(g.absolute_expiry) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThanOrEqual(30 + 1 / (24 * 60)); // database and test clocks may differ slightly
      const [row] = await q(`SELECT client_name, redeemed_at FROM mcp_grants WHERE grant_id = $1`, [g.grant_id]);
      expect(row.redeemed_at).toBeNull();
      const name = String(row.client_name);
      expect(name).toBe(sanitizeClientName("Evil App " + "x".repeat(200)));
      expect(name.startsWith("Evil App xxx")).toBe(true);
      expect(Array.from(name)).toHaveLength(80);
    });

    it("rejects invalid input", async () => {
      await expect(createGrant({ ...grantInput, github_id: 0 })).rejects.toThrow(TypeError);
      await expect(createGrant({ ...grantInput, client_name: "\u0000 " })).rejects.toThrow(TypeError);
      await expect(createGrant({ ...grantInput, redirect_host: "" })).rejects.toThrow(TypeError);
      await expect(createGrant({ ...grantInput, client_id: "" })).rejects.toThrow(TypeError);
    });

    it("redeems once, only with the current refresh id", async () => {
      const g = await createGrant(grantInput);
      expect(await redeemGrant(g.grant_id, randomUUID())).toBe(false);
      expect(await redeemGrant(g.grant_id, g.current_refresh)).toBe(true);
      expect(await redeemGrant(g.grant_id, g.current_refresh)).toBe(false);
    });

    it("does not redeem a revoked grant", async () => {
      const g = await createGrant(grantInput);
      expect(await revokeGrant(g.grant_id, "code_reuse")).toBe(true);
      expect(await redeemGrant(g.grant_id, g.current_refresh)).toBe(false);
    });

    it("only redeemed grants are listed or active", async () => {
      const g = await createGrant({ ...grantInput, github_id: 777 });
      expect(await listGrants(777)).toEqual([]);
      expect(await getActiveGrant(g.grant_id)).toBeNull();
      await redeemGrant(g.grant_id, g.current_refresh);
      // The pre-redeem miss was not cached.
      expect(await getActiveGrant(g.grant_id)).toMatchObject({ grant_id: g.grant_id, github_id: 777 });
      const list = await listGrants(777);
      expect(list.map((x) => x.grant_id)).toEqual([g.grant_id]);
      expect(Object.keys(list[0])).not.toContain("current_refresh");
    });
  });

  describe("rotateRefresh", () => {
    it("current -> ok, and the grant now expects the next id", async () => {
      const g = await redeemed();
      const next = randomUUID();
      expect(await rot(g.grant_id, g.current_refresh, next)).toBe("ok");
      const row = await grantRow(g.grant_id);
      expect(row.current_refresh).toBe(next);
      expect(row.previous_refresh).toBe(g.current_refresh);
    });

    it("previous within 30 s -> ok, and the grant stays valid", async () => {
      const g = await redeemed();
      await rot(g.grant_id, g.current_refresh, randomUUID());
      expect(await rot(g.grant_id, g.current_refresh, randomUUID())).toBe("ok");
      expect((await grantRow(g.grant_id)).revoked_at).toBeNull();
      expect(await getActiveGrant(g.grant_id)).not.toBeNull();
    });

    it("previous after 30 s -> reuse, and the grant is revoked", async () => {
      const g = await redeemed();
      await rot(g.grant_id, g.current_refresh, randomUUID());
      await q(`UPDATE mcp_grants SET rotated_at = NOW() - INTERVAL '31 seconds' WHERE grant_id = $1`, [g.grant_id]);
      expect(await getActiveGrant(g.grant_id)).not.toBeNull(); // warm this instance's cache
      expect(await rot(g.grant_id, g.current_refresh, randomUUID())).toBe("reuse");
      const row = await grantRow(g.grant_id);
      expect(row.revoked_at).not.toBeNull();
      expect(row.revoked_reason).toBe("refresh_reuse");
      // Reuse evicts the cache at once.
      expect(await getActiveGrant(g.grant_id)).toBeNull();
      // Nothing works afterwards, not even the current id.
      expect(await rot(g.grant_id, row.current_refresh, randomUUID())).toBe("revoked");
    });

    it("an unknown id -> reuse, and the grant is revoked", async () => {
      const g = await redeemed();
      expect(await rot(g.grant_id, randomUUID(), randomUUID())).toBe("reuse");
      expect((await grantRow(g.grant_id)).revoked_reason).toBe("refresh_reuse");
    });

    it("two parallel rotations with the same current id both succeed and do not revoke", async () => {
      const g = await redeemed();
      const results = await Promise.all([
        rot(g.grant_id, g.current_refresh, randomUUID()),
        rot(g.grant_id, g.current_refresh, randomUUID()),
      ]);
      expect(results).toEqual(["ok", "ok"]);
      expect((await grantRow(g.grant_id)).revoked_at).toBeNull();
    });

    it("the loser of a parallel refresh gets the winner's id, which stays valid after the grace window", async () => {
      const g = await redeemed();
      const [a, b] = await Promise.all([
        rotateRefresh(g.grant_id, g.current_refresh, randomUUID()),
        rotateRefresh(g.grant_id, g.current_refresh, randomUUID()),
      ]);
      expect(a.outcome).toBe("ok");
      expect(b.outcome).toBe("ok");
      const ja = a.outcome === "ok" ? a.refreshJti : "";
      const jb = b.outcome === "ok" ? b.refreshJti : "";
      expect(ja).toBe(jb);
      expect((await grantRow(g.grant_id)).current_refresh).toBe(ja);
      // Long after the window, whichever response the client kept still refreshes.
      await q(`UPDATE mcp_grants SET rotated_at = NOW() - INTERVAL '10 minutes' WHERE grant_id = $1`, [g.grant_id]);
      expect(await rot(g.grant_id, ja, randomUUID())).toBe("ok");
      expect((await grantRow(g.grant_id)).revoked_at).toBeNull();
    });

    it("a retry inside the grace window returns the already-issued id without rotating again", async () => {
      const g = await redeemed();
      const first = await rotateRefresh(g.grant_id, g.current_refresh, randomUUID());
      const retry = await rotateRefresh(g.grant_id, g.current_refresh, randomUUID());
      expect(first).toEqual(retry);
      const row = await grantRow(g.grant_id);
      expect(row.previous_refresh).toBe(g.current_refresh);
    });

    it("fails once absolute_expiry has passed, without recording reuse", async () => {
      const g = await redeemed();
      await q(`UPDATE mcp_grants SET absolute_expiry = NOW() - INTERVAL '1 second' WHERE grant_id = $1`, [g.grant_id]);
      expect(await rot(g.grant_id, g.current_refresh, randomUUID())).toBe("revoked");
      expect((await grantRow(g.grant_id)).revoked_reason).toBeNull();
      expect(await getActiveGrant(g.grant_id)).toBeNull();
    });

    it("a never-redeemed grant neither rotates nor gets revoked for reuse", async () => {
      const g = await createGrant(grantInput);
      expect(await rot(g.grant_id, g.current_refresh, randomUUID())).toBe("revoked");
      expect(await rot(g.grant_id, randomUUID(), randomUUID())).toBe("revoked");
      const [row] = await q(`SELECT revoked_at, redeemed_at FROM mcp_grants WHERE grant_id = $1`, [g.grant_id]);
      expect(row.revoked_at).toBeNull();
      // It can still be redeemed with its original refresh id.
      expect(await redeemGrant(g.grant_id, g.current_refresh)).toBe(true);
    });

    it("unknown grant or malformed ids -> revoked", async () => {
      expect(await rot(randomUUID(), randomUUID(), randomUUID())).toBe("revoked");
      expect(await rot("nope", randomUUID(), randomUUID())).toBe("revoked");
    });
  });

  describe("revokeGrant / getActiveGrant cache", () => {
    it("revokes once and evicts this instance's cache", async () => {
      const g = await redeemed();
      expect(await getActiveGrant(g.grant_id)).not.toBeNull();
      expect(await revokeGrant(g.grant_id, "user_revoked")).toBe(true);
      expect(await revokeGrant(g.grant_id, "user_revoked")).toBe(false);
      expect(await getActiveGrant(g.grant_id)).toBeNull();
      expect((await listGrants(USER)).map((x) => x.grant_id)).not.toContain(g.grant_id);
    });

    it("a revocation on another instance is seen within 60 s", async () => {
      const g = await redeemed();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date());
      expect(await getActiveGrant(g.grant_id)).not.toBeNull();
      await q(`UPDATE mcp_grants SET revoked_at = NOW(), revoked_reason = 'admin_revoked' WHERE grant_id = $1`, [g.grant_id]);
      expect(await getActiveGrant(g.grant_id)).not.toBeNull(); // still cached
      vi.setSystemTime(new Date(Date.now() + 61_000));
      expect(await getActiveGrant(g.grant_id)).toBeNull();
    });

    it("a lookup that started before a revocation cannot re-cache the grant as live", async () => {
      const g = await redeemed();
      const base = getDb();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let held = false;
      // Hold the result of getActiveGrant's SELECT until the revocation has committed.
      const slow = new Proxy(base, {
        apply(target, thisArg, args: unknown[]) {
          const result = Reflect.apply(target as (...a: unknown[]) => Promise<unknown>, thisArg, args) as Promise<unknown>;
          const text = Array.isArray(args[0]) ? (args[0] as string[]).join("") : "";
          if (!held && text.includes("AS redeemed")) {
            held = true;
            return result.then((rows) => gate.then(() => rows));
          }
          return result;
        },
      });
      __setDbClientForTests(slow as unknown as DbClient);
      try {
        await ensureSchema();
        const lookup = getActiveGrant(g.grant_id);
        await vi.waitFor(() => expect(held).toBe(true));
        expect(await revokeGrant(g.grant_id, "user_revoked")).toBe(true);
        release();
        expect(await lookup).not.toBeNull(); // it read the row before the revoke
        expect(await getActiveGrant(g.grant_id)).toBeNull(); // but did not cache it
      } finally {
        backend.attach();
      }
    });

    it("propagates database errors (callers map them to unavailable)", async () => {
      const g = await redeemed();
      const broken = Object.assign(() => Promise.reject(new Error("db down")), {
        query: () => Promise.reject(new Error("db down")),
        transaction: () => Promise.reject(new Error("db down")),
      });
      __setDbClientForTests(broken as unknown as DbClient);
      try {
        await expect(getActiveGrant(g.grant_id)).rejects.toThrow();
        await expect(rot(g.grant_id, g.current_refresh, randomUUID())).rejects.toThrow();
      } finally {
        backend.attach();
      }
    });
  });

  describe("retention", () => {
    it("pruneUnredeemed deletes only unredeemed grants older than 10 minutes", async () => {
      const stale = await createGrant(grantInput);
      const fresh = await createGrant(grantInput);
      const kept = await redeemed();
      for (const id of [stale.grant_id, kept.grant_id]) {
        await q(`UPDATE mcp_grants SET created_at = NOW() - INTERVAL '11 minutes' WHERE grant_id = $1`, [id]);
      }
      expect(await pruneUnredeemed()).toBeGreaterThanOrEqual(1);
      const ids = (await q(`SELECT grant_id::text AS id FROM mcp_grants`)).map((r) => r.id);
      expect(ids).not.toContain(stale.grant_id);
      expect(ids).toContain(fresh.grant_id);
      expect(ids).toContain(kept.grant_id);
    });

    it("pruneMcpRetention removes expired jti, stale unredeemed and long-revoked grants", async () => {
      const oldJti = randomUUID();
      const liveJti = randomUUID();
      const graceJti = randomUUID();
      await consumeJti(oldJti, new Date(Date.now() - 2 * 60_000));
      // Expired 30 s ago: still inside the one-minute margin past open()'s 5 s
      // tolerance, so the replay record must survive retention.
      await consumeJti(graceJti, new Date(Date.now() - 30_000));
      await consumeJti(liveJti, new Date(Date.now() + 60_000));
      const stale = await createGrant(grantInput);
      await q(`UPDATE mcp_grants SET created_at = NOW() - INTERVAL '11 minutes' WHERE grant_id = $1`, [stale.grant_id]);
      const old = await redeemed();
      const recent = await redeemed();
      await revokeGrant(old.grant_id, "user_revoked");
      await revokeGrant(recent.grant_id, "user_revoked");
      await q(`UPDATE mcp_grants SET revoked_at = NOW() - INTERVAL '91 days' WHERE grant_id = $1`, [old.grant_id]);
      await q(`UPDATE mcp_grants SET revoked_at = NOW() - INTERVAL '89 days' WHERE grant_id = $1`, [recent.grant_id]);

      const r = await pruneMcpRetention();
      expect(r.used_jti).toBeGreaterThanOrEqual(1);
      expect(r.unredeemed).toBeGreaterThanOrEqual(1);
      expect(r.revoked).toBeGreaterThanOrEqual(1);

      const jtis = (await q(`SELECT jti::text AS id FROM mcp_used_jti`)).map((x) => x.id);
      expect(jtis).not.toContain(oldJti);
      expect(jtis).toContain(liveJti);
      expect(jtis).toContain(graceJti);
      const ids = (await q(`SELECT grant_id::text AS id FROM mcp_grants`)).map((x) => x.id);
      expect(ids).not.toContain(stale.grant_id);
      expect(ids).not.toContain(old.grant_id);
      expect(ids).toContain(recent.grant_id);
    });

    it("pruneMcpRetention removes grants expired more than 90 days ago, even if never revoked", async () => {
      const expired = await redeemed();
      const lately = await redeemed();
      await q(`UPDATE mcp_grants SET absolute_expiry = NOW() - INTERVAL '91 days' WHERE grant_id = $1`, [expired.grant_id]);
      await q(`UPDATE mcp_grants SET absolute_expiry = NOW() - INTERVAL '10 days' WHERE grant_id = $1`, [lately.grant_id]);
      await pruneMcpRetention();
      const ids = (await q(`SELECT grant_id::text AS id FROM mcp_grants`)).map((x) => x.id);
      expect(ids).not.toContain(expired.grant_id);
      expect(ids).toContain(lately.grant_id);
    });
  });

  describe("auditMcp", () => {
    it("writes a permission_audit row", async () => {
      await auditMcp("mcp.grant_created", USER, "grant:abc", { client: "claude.ai" });
      const [row] = await q(
        `SELECT actor_github_id::text AS actor, action, target, details FROM permission_audit ORDER BY id DESC LIMIT 1`,
      );
      expect(row).toMatchObject({ actor: String(USER), action: "mcp.grant_created", target: "grant:abc" });
      expect(row.details).toEqual({ client: "claude.ai" });
    });

    it("refuses token-like details or targets and writes nothing", async () => {
      const count = async () => Number((await q(`SELECT count(*)::int AS n FROM permission_audit`))[0].n);
      const before = await count();
      const sealed = await seal(
        "mcp.access",
        { grant_id: randomUUID(), client_id: "c", aud: "a", scope: "s", gh: GH, id: USER, login: "octo" },
        60,
      );
      for (const bad of [GH, "ghp_abc", "ghs_abc", "ghu_abc", "ghr_abc", "github_pat_11ABC", sealed]) {
        await expect(auditMcp("mcp.token_issued", USER, "grant:x", { note: `x ${bad}` })).rejects.toThrow(/token-like/);
        await expect(auditMcp("mcp.token_issued", USER, bad, {})).rejects.toThrow(/token-like/);
      }
      await expect(auditMcp("mcp.nope" as never, USER, "t", {})).rejects.toThrow(TypeError);
      await expect(auditMcp("mcp.org_removed", 0, "t", {})).rejects.toThrow(TypeError);
      await expect(auditMcp("mcp.org_removed", USER, "t", { nested: { gh: GH } } as never)).rejects.toThrow(TypeError);
      expect(await count()).toBe(before);
    });
  });

  describe("no secrets at rest", () => {
    it("a full sign-in, exchange and refresh stores no GitHub token or sealed token", async () => {
      const resource = "https://gitdash.example/mcp/me";
      const client_id = "https://client.example/meta.json";
      const redirect_uri = "http://127.0.0.1:3333/cb";
      const code_challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
      const ident = { gh: GH, id: USER, login: "octo" };

      const tx = await seal("mcp.tx", { nonce: "n", client_id, redirect_uri, code_challenge, state: "st", resource, ...ident }, 600);
      expect(await open("mcp.tx", tx)).not.toBeNull();

      const g = await createGrant(grantInput);
      await auditMcp("mcp.grant_created", USER, `grant:${g.grant_id}`, { client_id, redirect_host: "claude.ai" });
      const code = await seal(
        "mcp.code",
        { jti: randomUUID(), grant_id: g.grant_id, refresh_jti: g.current_refresh, client_id, redirect_uri, code_challenge, resource, ...ident },
        60,
      );
      const c = (await open("mcp.code", code))!;
      expect(await consumeJti(c.jti, new Date(c.exp * 1000))).toBe(true);
      expect(await redeemGrant(c.grant_id, c.refresh_jti)).toBe(true);
      const access = await seal("mcp.access", { grant_id: g.grant_id, client_id, aud: resource, scope: "gitdash:read", ...ident }, 3600);
      const refresh = await seal("mcp.refresh", { jti: g.current_refresh, grant_id: g.grant_id, client_id, aud: resource, ...ident }, 3600);
      await auditMcp("mcp.token_issued", USER, `grant:${g.grant_id}`, { client_id });

      const r = (await open("mcp.refresh", refresh))!;
      expect(await rot(r.grant_id, r.jti, randomUUID())).toBe("ok");
      expect(await open("mcp.access", access)).not.toBeNull();

      for (const table of ["mcp_grants", "mcp_used_jti", "permission_audit"]) {
        const rows = await q(`SELECT row_to_json(t)::text AS j FROM ${table} t`);
        expect(rows.length).toBeGreaterThan(0);
        for (const { j } of rows) {
          expect(String(j)).not.toContain(GH);
          expect(String(j)).not.toContain("Fe26.");
        }
      }
    });
  });
});
