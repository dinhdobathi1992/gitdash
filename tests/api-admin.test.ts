import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { PGlite } from "@electric-sql/pglite";
import { createPgliteClient } from "./setup/pglite";

let pg: PGlite;

async function dbWith() {
  const db = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  return db;
}

async function auditCount(): Promise<number> {
  return Number((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM permission_audit`)).rows[0].n);
}

beforeEach(async () => {
  vi.resetModules();
  pg = new PGlite();
  const db = await dbWith();
  db.__setDbClientForTests(createPgliteClient(pg));
  await db.ensureSchema();
  for (const id of [1, 2, 3]) await db.upsertUser({ id, login: `u${id}`, avatar_url: null });
});

// ── DB helpers (atomic change + audit) ───────────────────────────────────────

describe("admin DB helpers", () => {
  it("setUserGroups replaces groups and writes exactly one audit row with before/after", async () => {
    const db = await dbWith();
    const r = await db.setUserGroups(1, 2, ["security", "dev", "dev"], [1]);
    expect(r).toMatchObject({ ok: true, before: [], after: ["dev", "security"] });
    expect(await auditCount()).toBe(1);
    const a = (await pg.query<{ details: { before: string[]; after: string[] } }>(`SELECT details FROM permission_audit`)).rows[0];
    expect(a.details).toEqual({ before: [], after: ["dev", "security"] });
    await db.setUserGroups(1, 2, ["pm"], [1]);
    const groups = (await pg.query<{ group_name: string }>(`SELECT group_name FROM user_groups WHERE github_id = 2`)).rows.map((x) => x.group_name);
    expect(groups).toEqual(["pm"]);
    expect(await auditCount()).toBe(2);
  });

  it("a no-op change writes no audit row", async () => {
    const db = await dbWith();
    await db.setUserGroups(1, 2, ["dev"], [1]);
    await db.setUserGroups(1, 2, ["dev"], [1]);
    expect(await auditCount()).toBe(1);
  });

  it("refuses to remove the last admin when there are no bootstrap admins, and writes no audit row", async () => {
    const db = await dbWith();
    await db.setUserGroups(1, 2, ["admin"], []);
    const before = await auditCount();
    const r = await db.setUserGroups(2, 2, ["dev"], []);
    expect(r.ok).toBe(false);
    expect(await auditCount()).toBe(before);
    const g = (await pg.query<{ group_name: string }>(`SELECT group_name FROM user_groups WHERE github_id = 2`)).rows;
    expect(g.map((x) => x.group_name)).toEqual(["admin"]);
  });

  it("two admins demoting each other concurrently cannot leave zero admins", async () => {
    const db = await dbWith();
    await db.setUserGroups(1, 2, ["admin"], []);
    await db.setUserGroups(1, 3, ["admin"], []);
    const results = await Promise.all([db.setUserGroups(2, 3, ["dev"], []), db.setUserGroups(3, 2, ["dev"], [])]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const admins = Number((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM user_groups WHERE group_name='admin'`)).rows[0].n);
    expect(admins).toBe(1);
  });

  it("setGrant grants/revokes with an audit row only when something changed", async () => {
    const db = await dbWith();
    expect(await db.setGrant(1, "dev", "dora", true)).toEqual({ before: false });
    expect(await db.setGrant(1, "dev", "dora", true)).toEqual({ before: true });
    expect(await db.setGrant(1, "dev", "dora", false)).toEqual({ before: true });
    expect(await db.listGrants()).toEqual([]);
    const actions = (await pg.query<{ action: string }>(`SELECT action FROM permission_audit ORDER BY id`)).rows.map((x) => x.action);
    expect(actions).toEqual(["group_grant", "group_revoke"]);
  });

  it("listUsers puts pending users first and filters by login and group", async () => {
    const db = await dbWith();
    await db.setUserGroups(1, 1, ["admin"], [1]);
    await db.setUserGroups(1, 3, ["dev"], [1]);
    expect((await db.listUsers()).map((u) => [u.login, u.groups])).toEqual([["u2", []], ["u1", ["admin"]], ["u3", ["dev"]]]);
    expect((await db.listUsers({ q: "u3" })).map((u) => u.login)).toEqual(["u3"]);
    expect((await db.listUsers({ group: "admin" })).map((u) => u.login)).toEqual(["u1"]);
  });

  it("listAudit pages newest first with the actor's login", async () => {
    const db = await dbWith();
    for (const f of ["dora", "busFactor", "securityScan"]) await db.setGrant(1, "dev", f, true);
    const page1 = await db.listAudit({ limit: 2 });
    expect(page1.map((a) => a.target)).toEqual(["dev:securityScan", "dev:busFactor"]);
    expect(page1[0].actor_login).toBe("u1");
    const page2 = await db.listAudit({ before: page1[1].id, limit: 2 });
    expect(page2.map((a) => a.target)).toEqual(["dev:dora"]);
  });
});

// ── API routes ───────────────────────────────────────────────────────────────

const requireAccess = vi.fn();
const currentIdentity = vi.fn();
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  requireAccess: (...a: unknown[]) => requireAccess(...a),
  currentIdentity: (...a: unknown[]) => currentIdentity(...a),
}));

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("admin API", () => {
  beforeEach(() => {
    vi.stubEnv("GITDASH_ADMIN_GITHUB_IDS", "1");
    requireAccess.mockResolvedValue(null);
    currentIdentity.mockResolvedValue({ id: 1, login: "u1" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("non-admins are refused by the handler re-check", async () => {
    requireAccess.mockResolvedValue(new Response(JSON.stringify({ code: "forbidden" }), { status: 403 }));
    const { PUT } = await import("@/app/api/admin/permissions/route");
    const res = await PUT(jsonReq("/api/admin/permissions", "PUT", { group: "dev", flag: "dora", granted: true }));
    expect(res.status).toBe(403);
  });

  it("PUT /permissions validates input and rejects the admin group", async () => {
    const { PUT } = await import("@/app/api/admin/permissions/route");
    expect((await PUT(jsonReq("/api/admin/permissions", "PUT", { group: "dev", flag: "nope", granted: true }))).status).toBe(400);
    expect((await PUT(jsonReq("/api/admin/permissions", "PUT", { group: "admin", flag: "dora", granted: true }))).status).toBe(400);
    const ok = await PUT(jsonReq("/api/admin/permissions", "PUT", { group: "dev", flag: "dora", granted: true }));
    expect(ok.status).toBe(200);
    expect(await auditCount()).toBe(1);
  });

  it("GET /permissions returns the matrix", async () => {
    const db = await dbWith();
    await db.setGrant(1, "pm", "costAnalytics", true);
    const { GET } = await import("@/app/api/admin/permissions/route");
    const body = await (await GET(new NextRequest("http://localhost/api/admin/permissions"))).json();
    expect(body.grants.pm).toEqual(["costAnalytics"]);
    expect(body.groups).toContain("admin");
    expect(body.flags.length).toBeGreaterThan(10);
  });

  it("PUT /users/:id/groups sets groups; bootstrap admins keep admin implicitly", async () => {
    const { PUT } = await import("@/app/api/admin/users/[githubId]/groups/route");
    const ctx = (id: string) => ({ params: Promise.resolve({ githubId: id }) });
    const r1 = await PUT(jsonReq("/api/admin/users/2/groups", "PUT", { groups: ["dev"] }), ctx("2"));
    expect(r1.status).toBe(200);
    expect((await PUT(jsonReq("/api/admin/users/2/groups", "PUT", { groups: ["nope"] }), ctx("2"))).status).toBe(400);
    expect((await PUT(jsonReq("/api/admin/users/abc/groups", "PUT", { groups: [] }), ctx("abc"))).status).toBe(400);
    expect((await PUT(jsonReq("/api/admin/users/999/groups", "PUT", { groups: ["dev"] }), ctx("999"))).status).toBe(404);
  });

  it("GET /users lists users with bootstrap flag; GET /audit pages", async () => {
    const db = await dbWith();
    await db.setGrant(1, "dev", "dora", true);
    const users = await import("@/app/api/admin/users/route");
    const u = await (await users.GET(new NextRequest("http://localhost/api/admin/users"))).json();
    expect(u.users.find((x: { github_id: number }) => x.github_id === 1).isBootstrapAdmin).toBe(true);
    const audit = await import("@/app/api/admin/audit/route");
    const a = await (await audit.GET(new NextRequest("http://localhost/api/admin/audit?limit=10"))).json();
    expect(a.entries).toHaveLength(1);
  });
});
