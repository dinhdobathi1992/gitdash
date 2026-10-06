/**
 * Connected apps API: GET /api/mcp/grants and DELETE /api/mcp/grants/[id],
 * against PGlite. Identity and the admin check are mocked at the permissions
 * module; the grant store, audit writer and routes are real.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { PGlite } from "@electric-sql/pglite";
import { createPgliteClient } from "./setup/pglite";

const who = vi.hoisted(() => ({ id: 1, admin: false, signedIn: true }));

vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  requireAccess: vi.fn(async (_req: unknown, cls?: string) => {
    if (!who.signedIn) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (cls === "admin" && !who.admin) return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    return null;
  }),
  currentIdentity: vi.fn(async () => ({ id: who.id, login: `user${who.id}` })),
  isCurrentUserAdmin: vi.fn(async () => who.admin),
}));

import { __setDbClientForTests, ensureSchema, upsertUser } from "@/lib/db";
import { __clearGrantCacheForTests, createGrant, getActiveGrant, redeemGrant } from "@/lib/mcp/oauth/grants";
import { TOKEN_LIKE } from "@/lib/mcp/oauth/audit";
import { classify } from "@/lib/permissions";
import { GET as listGET } from "@/app/api/mcp/grants/route";
import { DELETE as revokeDELETE } from "@/app/api/mcp/grants/[id]/route";

let pg: PGlite;
const ORIGIN = "https://gitdash.test";
const UNKNOWN_ID = "11111111-2222-4333-8444-555555555555";

const list = (query = "") => listGET(new NextRequest(`${ORIGIN}/api/mcp/grants${query}`));
const revoke = (id: string) =>
  revokeDELETE(new NextRequest(`${ORIGIN}/api/mcp/grants/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

async function seed(githubId: number, name: string, host: string, redeem = true): Promise<string> {
  const g = await createGrant({ github_id: githubId, client_id: `https://${host}/client.json`, client_name: name, redirect_host: host });
  if (redeem) expect(await redeemGrant(g.grant_id, g.current_refresh)).toBe(true);
  return g.grant_id;
}

beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

beforeEach(async () => {
  vi.stubEnv("MODE", "organization");
  vi.stubEnv("GITDASH_MCP", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  who.id = 1;
  who.admin = false;
  who.signedIn = true;
  pg = new PGlite();
  __setDbClientForTests(createPgliteClient(pg));
  await ensureSchema();
  await upsertUser({ id: 1, login: "alice", avatar_url: null });
  await upsertUser({ id: 2, login: "bob", avatar_url: null });
  __clearGrantCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/mcp/grants", () => {
  it("lists only the caller's own redeemed, active grants", async () => {
    const mine = await seed(1, "Claude", "claude.ai");
    await seed(1, "Never redeemed", "pending.example", false);
    const revoked = await seed(1, "Old app", "old.example");
    await seed(2, "Cursor", "cursor.sh");
    expect((await revoke(revoked)).status).toBe(200);

    const res = await list();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { grants: { grant_id: string; redirect_host: string; client_name: string }[] };
    expect(body.grants.map((g) => g.grant_id)).toEqual([mine]);
    expect(body.grants[0]).toMatchObject({ client_name: "Claude", redirect_host: "claude.ai" });
    expect(JSON.stringify(body)).not.toMatch(TOKEN_LIKE);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("?all=1 is 403 for a non-admin", async () => {
    await seed(2, "Cursor", "cursor.sh");
    const res = await list("?all=1");
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("cursor.sh");
  });

  it("?all=1 returns every user's grants, with the owner, for an admin", async () => {
    who.admin = true;
    await seed(1, "Claude", "claude.ai");
    await seed(2, "Cursor", "cursor.sh");
    const res = await list("?all=1");
    expect(res.status).toBe(200);
    const { grants } = (await res.json()) as { grants: { github_id: number; login: string | null; redirect_host: string }[] };
    expect(grants.map((g) => [g.github_id, g.login, g.redirect_host]).sort()).toEqual([
      [1, "alice", "claude.ai"],
      [2, "bob", "cursor.sh"],
    ]);
  });

  it("is 401 when signed out", async () => {
    who.signedIn = false;
    expect((await list()).status).toBe(401);
  });
});

describe("DELETE /api/mcp/grants/[id]", () => {
  it("lets the owner revoke, audits it without token material, and ends the grant", async () => {
    const id = await seed(1, "Claude", "claude.ai");
    expect(await getActiveGrant(id)).not.toBeNull(); // now cached as active

    const res = await revoke(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // revokeGrant evicts the cache itself; clearing it proves the database says revoked too.
    __clearGrantCacheForTests();
    expect(await getActiveGrant(id)).toBeNull();
    const row = (await pg.query<{ revoked_reason: string }>(`SELECT revoked_reason FROM mcp_grants WHERE grant_id = $1`, [id])).rows[0];
    expect(row.revoked_reason).toBe("user_revoked");

    const audit = (await pg.query<{ actor_github_id: string; action: string; target: string; details: Record<string, unknown> }>(
      `SELECT actor_github_id, action, target, details FROM permission_audit WHERE action = 'mcp.grant_revoked'`,
    )).rows;
    expect(audit).toHaveLength(1);
    expect(Number(audit[0].actor_github_id)).toBe(1);
    expect(audit[0].target).toBe(id);
    expect(audit[0].details).toMatchObject({ reason: "user_revoked", client_name: "Claude", redirect_host: "claude.ai" });
    expect(JSON.stringify(audit[0])).not.toMatch(TOKEN_LIKE);

    // The same id again is no longer an active grant.
    expect((await revoke(id)).status).toBe(404);
  });

  it("is 403 for someone else's grant without admin, and leaves it active", async () => {
    const id = await seed(2, "Cursor", "cursor.sh");
    const res = await revoke(id);
    expect(res.status).toBe(403);
    __clearGrantCacheForTests();
    expect(await getActiveGrant(id)).not.toBeNull();
    const n = (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM permission_audit WHERE action = 'mcp.grant_revoked'`)).rows[0].n;
    expect(n).toBe(0);
  });

  it("lets an admin revoke anyone's grant as admin_revoked", async () => {
    who.admin = true;
    const id = await seed(2, "Cursor", "cursor.sh");
    expect((await revoke(id)).status).toBe(200);
    __clearGrantCacheForTests();
    expect(await getActiveGrant(id)).toBeNull();
    const reason = (await pg.query<{ revoked_reason: string }>(`SELECT revoked_reason FROM mcp_grants WHERE grant_id = $1`, [id])).rows[0];
    expect(reason.revoked_reason).toBe("admin_revoked");
    const d = (await pg.query<{ actor_github_id: string; details: Record<string, unknown> }>(
      `SELECT actor_github_id, details FROM permission_audit WHERE action = 'mcp.grant_revoked'`,
    )).rows[0];
    expect(Number(d.actor_github_id)).toBe(1);
    expect(d.details).toMatchObject({ reason: "admin_revoked", owner_github_id: 2 });
  });

  it("is 404 for an unknown or malformed id, and for a grant that was never redeemed", async () => {
    expect((await revoke(UNKNOWN_ID)).status).toBe(404);
    expect((await revoke("not-a-uuid")).status).toBe(404);
    const unredeemed = await seed(1, "Half-way", "half.example", false);
    expect((await revoke(unredeemed)).status).toBe(404);
  });
});

describe("feature gate and registry", () => {
  it("both routes are 404 when GITDASH_MCP is not true", async () => {
    const id = await seed(1, "Claude", "claude.ai");
    vi.stubEnv("GITDASH_MCP", "");
    expect((await list()).status).toBe(404);
    expect((await revoke(id)).status).toBe(404);
    vi.stubEnv("GITDASH_MCP", "true");
    __clearGrantCacheForTests();
    expect(await getActiveGrant(id)).not.toBeNull(); // the disabled call revoked nothing
  });

  it("both routes are 404 outside organization mode", async () => {
    vi.stubEnv("MODE", "standalone");
    expect((await list()).status).toBe(404);
    expect((await revoke(UNKNOWN_ID)).status).toBe(404);
  });

  it("classifies the routes as auth, not unregistered", () => {
    expect(classify("/api/mcp/grants", "GET")).toBe("auth");
    expect(classify(`/api/mcp/grants/${UNKNOWN_ID}`, "DELETE")).toBe("auth");
  });
});
