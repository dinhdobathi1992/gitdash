import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { PGlite } from "@electric-sql/pglite";
import { createPgliteClient } from "./setup/pglite";
import { loginsOf, makeCanonical, noLinks, normalizeLogin } from "@/lib/identity-links";

let pg: PGlite;
const actor = { id: 1, login: "boss" };

async function db() {
  return vi.importActual<typeof import("@/lib/db")>("@/lib/db");
}
async function links(): Promise<Record<string, string>> {
  const rows = (await pg.query<{ alias_login: string; primary_login: string }>(`SELECT alias_login, primary_login FROM identity_links`)).rows;
  return Object.fromEntries(rows.map((r) => [r.alias_login, r.primary_login]));
}
async function audit() {
  return (await pg.query<{ action: string; target: string; details: Record<string, unknown> }>(
    `SELECT action, target, details FROM permission_audit ORDER BY id`,
  )).rows;
}
/** One hop: no login is both an alias and a primary. */
async function noChains(): Promise<boolean> {
  const r = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM identity_links a JOIN identity_links b ON a.primary_login = b.alias_login`,
  );
  return r.rows[0].n === 0;
}

beforeEach(async () => {
  vi.resetModules();
  pg = new PGlite();
  const d = await db();
  d.__setDbClientForTests(createPgliteClient(pg));
  await d.ensureSchema();
});

describe("canonical", () => {
  it("maps an alias to its primary, case-insensitively, and leaves others alone", () => {
    const c = makeCanonical([{ alias_login: "dinhdobathi3", primary_login: "dinhdobathi1992" }]);
    expect(c("DinhDoBaThi3")).toBe("dinhdobathi1992");
    expect(c("dinhdobathi1992")).toBe("dinhdobathi1992");
    expect(c("Alice")).toBe("alice");
    expect(noLinks("Alice")).toBe("alice");
  });

  it("loginsOf lists the person's logins, the login itself first", () => {
    const l = [{ alias_login: "b", primary_login: "a" }, { alias_login: "c", primary_login: "a" }];
    expect(loginsOf("B", l)).toEqual(["b", "a", "c"]);
    expect(loginsOf("z", l)).toEqual(["z"]);
  });

  it("normalizeLogin accepts GitHub logins only", () => {
    expect(normalizeLogin(" Alice-1 ")).toBe("alice-1");
    expect(normalizeLogin("-bad")).toBeNull();
    expect(normalizeLogin("a--b")).toBeNull();
    expect(normalizeLogin("x".repeat(40))).toBeNull();
    expect(normalizeLogin(3)).toBeNull();
  });
});

describe("identity link helpers (PGlite)", () => {
  it("migration v12 applies twice cleanly", async () => {
    const d = await db();
    const { MIGRATIONS } = d;
    const v12 = MIGRATIONS.find((m) => m.version === 12)!;
    for (const sql of v12.up) await pg.exec(sql);
    expect((await pg.query(`SELECT 1 FROM schema_migrations WHERE version = 12`)).rows).toHaveLength(1);
  });

  it("the schema rejects self links and mixed case", async () => {
    await expect(pg.query(`INSERT INTO identity_links (alias_login, primary_login) VALUES ('a', 'a')`)).rejects.toThrow();
    await expect(pg.query(`INSERT INTO identity_links (alias_login, primary_login) VALUES ('A', 'b')`)).rejects.toThrow();
    await expect(pg.query(`INSERT INTO identity_distinct (login_a, login_b) VALUES ('b', 'a')`)).rejects.toThrow();
  });

  it("links an alias and audits it", async () => {
    const d = await db();
    expect(await d.linkIdentity(actor, "b", "a")).toEqual({ ok: true, primary: "a" });
    expect(await links()).toEqual({ b: "a" });
    expect(await audit()).toEqual([
      { action: "identity_link", target: "b", details: { before_primary: null, after_primary: "a" } },
    ]);
    // Linking again changes nothing and writes no audit row.
    await d.linkIdentity(actor, "b", "a");
    expect(await audit()).toHaveLength(1);
  });

  it("linking to an alias resolves to its primary (one hop)", async () => {
    const d = await db();
    await d.linkIdentity(actor, "b", "a");
    expect(await d.linkIdentity(actor, "c", "b")).toEqual({ ok: true, primary: "a" });
    expect(await links()).toEqual({ b: "a", c: "a" });
    expect(await noChains()).toBe(true);
  });

  it("linking a primary re-points its aliases, with one audit row per affected alias", async () => {
    const d = await db();
    await d.linkIdentity(actor, "b", "a");
    await d.linkIdentity(actor, "c", "a");
    await d.linkIdentity(actor, "a", "z");
    expect(await links()).toEqual({ a: "z", b: "z", c: "z" });
    expect(await noChains()).toBe(true);
    const last = (await audit()).slice(2);
    expect(last.map((r) => [r.target, r.details])).toEqual(expect.arrayContaining([
      ["a", { before_primary: null, after_primary: "z" }],
      ["b", { before_primary: "a", after_primary: "z" }],
      ["c", { before_primary: "a", after_primary: "z" }],
    ]));
    expect(last).toHaveLength(3);
  });

  it("refuses a link that would make a cycle", async () => {
    const d = await db();
    await d.linkIdentity(actor, "b", "a");
    expect((await d.linkIdentity(actor, "a", "b")).ok).toBe(false);
    expect(await links()).toEqual({ b: "a" });
  });

  it("two parallel links in opposite directions never form a chain or cycle", async () => {
    const d = await db();
    const r = await Promise.all([d.linkIdentity(actor, "a", "b"), d.linkIdentity(actor, "b", "a")]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(Object.keys(await links())).toHaveLength(1);
    expect(await noChains()).toBe(true);
  });

  it("parallel links that would chain end up one hop", async () => {
    const d = await db();
    await Promise.all([d.linkIdentity(actor, "a", "b"), d.linkIdentity(actor, "b", "c"), d.linkIdentity(actor, "d", "a")]);
    expect(await noChains()).toBe(true);
    const l = await links();
    expect(new Set(Object.values(l)).size).toBe(1);
  });

  it("unlinks an alias; refuses to unlink a primary; 404 for an unknown login", async () => {
    const d = await db();
    await d.linkIdentity(actor, "b", "a");
    expect(await d.unlinkIdentity(actor, "a")).toEqual({ ok: false, isPrimary: true });
    expect(await d.unlinkIdentity(actor, "q")).toEqual({ ok: false, notLinked: true });
    expect(await d.unlinkIdentity(actor, "b")).toEqual({ ok: true, before: "a" });
    expect(await links()).toEqual({});
    expect((await audit()).at(-1)).toEqual({ action: "identity_unlink", target: "b", details: { before_primary: "a", after_primary: null } });
  });

  it("different people: pairs order byte-wise whatever the database collation", async () => {
    const d = await db();
    // en_US collations ignore '-' at the first level ("dinh-thi2" > "dinhthi"); byte order says the reverse.
    expect(await d.setIdentityDistinct(actor, "dinhthi", "dinh-thi2", true)).toEqual({ ok: true, changed: true });
    expect((await d.listIdentityDistinct()).map((r) => [r.login_a, r.login_b])).toEqual([["dinh-thi2", "dinhthi"]]);
    await d.linkIdentity(actor, "dinh-thi2", "dinhthi");
    expect(await d.listIdentityDistinct()).toEqual([]);
  });

  it("linking through an alias clears a dismissal of the requested pair too", async () => {
    const d = await db();
    await d.linkIdentity(actor, "b", "a");
    await d.setIdentityDistinct(actor, "c", "b", true);
    await d.linkIdentity(actor, "c", "b"); // resolves to a
    expect(await d.listIdentityDistinct()).toEqual([]);
  });

  it("different people: ordered pair, audited, undone, refused while linked, cleared by a link", async () => {
    const d = await db();
    expect(await d.setIdentityDistinct(actor, "zed", "amy", true)).toEqual({ ok: true, changed: true });
    expect(await d.setIdentityDistinct(actor, "amy", "zed", true)).toEqual({ ok: true, changed: false });
    expect((await d.listIdentityDistinct()).map((r) => [r.login_a, r.login_b])).toEqual([["amy", "zed"]]);
    expect(await d.setIdentityDistinct(actor, "amy", "zed", false)).toEqual({ ok: true, changed: true });
    expect(await d.listIdentityDistinct()).toEqual([]);
    expect((await audit()).map((r) => r.action)).toEqual(["identity_distinct", "identity_distinct_undo"]);

    await d.setIdentityDistinct(actor, "amy", "zed", true);
    await d.linkIdentity(actor, "zed", "amy");
    expect(await d.listIdentityDistinct()).toEqual([]);
    expect((await d.setIdentityDistinct(actor, "amy", "zed", true)).ok).toBe(false);
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────

const requireAccess = vi.fn();
const currentIdentity = vi.fn();
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  requireAccess: (...a: unknown[]) => requireAccess(...a),
  currentIdentity: (...a: unknown[]) => currentIdentity(...a),
}));

function req(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("account-link routes", () => {
  beforeEach(() => {
    vi.stubEnv("MODE", "organization");
    vi.stubEnv("DATABASE_URL", "postgres://x");
    requireAccess.mockResolvedValue(null);
    currentIdentity.mockResolvedValue(actor);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("non-admins are refused on every verb and see no links", async () => {
    requireAccess.mockResolvedValue(new Response(JSON.stringify({ code: "forbidden" }), { status: 403 }));
    const r = await import("@/app/api/admin/identity-links/route");
    const dist = await import("@/app/api/admin/identity-links/distinct/route");
    expect((await r.GET(req("/api/admin/identity-links", "GET"))).status).toBe(403);
    expect((await r.POST(req("/api/admin/identity-links", "POST", { alias: "b", primary: "a" }))).status).toBe(403);
    expect((await r.DELETE(req("/api/admin/identity-links?alias=b", "DELETE"))).status).toBe(403);
    expect((await dist.POST(req("/api/admin/identity-links/distinct", "POST", { a: "a", b: "b" }))).status).toBe(403);
    expect(await links()).toEqual({});
  });

  it("standalone mode refuses every verb, even for the (implicit) admin", async () => {
    vi.stubEnv("MODE", "standalone");
    const r = await import("@/app/api/admin/identity-links/route");
    const dist = await import("@/app/api/admin/identity-links/distinct/route");
    expect((await r.GET(req("/api/admin/identity-links", "GET"))).status).toBe(403);
    expect((await r.POST(req("/api/admin/identity-links", "POST", { alias: "b", primary: "a" }))).status).toBe(403);
    expect((await r.DELETE(req("/api/admin/identity-links?alias=b", "DELETE"))).status).toBe(403);
    expect((await dist.POST(req("/api/admin/identity-links/distinct", "POST", { a: "a", b: "b" }))).status).toBe(403);
    expect((await dist.DELETE(req("/api/admin/identity-links/distinct?a=a&b=b", "DELETE"))).status).toBe(403);
    expect(await links()).toEqual({});
  });

  it("admins link, list, unlink and mark different people", async () => {
    const r = await import("@/app/api/admin/identity-links/route");
    const dist = await import("@/app/api/admin/identity-links/distinct/route");
    expect((await r.POST(req("/api/admin/identity-links", "POST", { alias: "B", primary: "a" }))).status).toBe(200);
    expect((await r.POST(req("/api/admin/identity-links", "POST", { alias: "a", primary: "a" }))).status).toBe(400);
    expect((await r.POST(req("/api/admin/identity-links", "POST", { alias: "a", primary: "b" }))).status).toBe(409);
    expect((await r.POST(req("/api/admin/identity-links", "POST", { alias: "-x", primary: "a" }))).status).toBe(400);
    const list = await (await r.GET(req("/api/admin/identity-links", "GET"))).json();
    expect(list.links).toMatchObject([{ alias_login: "b", primary_login: "a", created_by: "boss" }]);
    expect((await r.DELETE(req("/api/admin/identity-links?alias=a", "DELETE"))).status).toBe(400);
    expect((await r.DELETE(req("/api/admin/identity-links?alias=b", "DELETE"))).status).toBe(200);
    expect((await r.DELETE(req("/api/admin/identity-links?alias=b", "DELETE"))).status).toBe(404);
    expect((await dist.POST(req("/api/admin/identity-links/distinct", "POST", { a: "c", b: "d" }))).status).toBe(200);
    expect((await dist.POST(req("/api/admin/identity-links/distinct", "POST", { a: "c", b: "c" }))).status).toBe(400);
    expect((await (await r.GET(req("/api/admin/identity-links", "GET"))).json()).distinct).toMatchObject([{ login_a: "c", login_b: "d" }]);
    expect((await dist.DELETE(req("/api/admin/identity-links/distinct?a=d&b=c", "DELETE"))).status).toBe(200);
  });
});
