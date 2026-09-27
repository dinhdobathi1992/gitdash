import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { PGlite } from "@electric-sql/pglite";
import { createPgliteClient } from "./setup/pglite";

// ── Config parsing ───────────────────────────────────────────────────────────

describe("identity config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("parseAdminIds accepts numeric ids and rejects logins", async () => {
    const { parseAdminIds } = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
    expect(parseAdminIds(" 123, 456 ")).toEqual([123, 456]);
    expect(parseAdminIds("")).toEqual([]);
    expect(() => parseAdminIds("thi")).toThrow(/numeric GitHub user ids/);
    expect(() => parseAdminIds("0")).toThrow();
  });

  it("allowedOrgs splits and trims", async () => {
    const { allowedOrgs } = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
    expect(allowedOrgs(" acme , beta ,")).toEqual(["acme", "beta"]);
    expect(allowedOrgs(undefined)).toEqual([]);
  });

  it("organization mode fails loudly without DATABASE_URL or bootstrap admins", async () => {
    vi.stubEnv("MODE", "organization");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("GITDASH_ADMIN_GITHUB_IDS", "1");
    let { assertOrgModeConfig } = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
    expect(() => assertOrgModeConfig()).toThrow(/DATABASE_URL/);

    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://x@localhost/y");
    vi.stubEnv("GITDASH_ADMIN_GITHUB_IDS", "");
    ({ assertOrgModeConfig } = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity"));
    expect(() => assertOrgModeConfig()).toThrow(/GITDASH_ADMIN_GITHUB_IDS/);
  });

  it("standalone mode needs neither", async () => {
    vi.stubEnv("MODE", "standalone");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("GITDASH_ADMIN_GITHUB_IDS", "");
    const { assertOrgModeConfig } = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
    expect(() => assertOrgModeConfig()).not.toThrow();
  });
});

// ── Allowed-orgs decision (GitHub mocked at the fetch layer) ─────────────────

describe("isInAllowedOrgs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function stubMemberships(byOrg: Record<string, number | "active" | "pending">) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const org = String(url).split("/memberships/orgs/")[1];
        const v = byOrg[org] ?? 404;
        if (typeof v === "number") return new Response(JSON.stringify({ message: "x" }), { status: v });
        return new Response(JSON.stringify({ state: v }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
  }

  it("no restriction configured → allowed", async () => {
    vi.stubEnv("GITDASH_ALLOWED_ORGS", "");
    const { isInAllowedOrgs } = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
    expect(await isInAllowedOrgs("tok-a")).toBe(true);
  });

  it("active membership in any allowed org → allowed; pending/404/403 → not", async () => {
    vi.stubEnv("GITDASH_ALLOWED_ORGS", "acme,beta");
    stubMemberships({ acme: 404, beta: "active" });
    let { isInAllowedOrgs } = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
    expect(await isInAllowedOrgs("tok-b")).toBe(true);

    vi.resetModules();
    stubMemberships({ acme: "pending", beta: 403 });
    ({ isInAllowedOrgs } = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity"));
    expect(await isInAllowedOrgs("tok-c")).toBe(false);
  });
});

// ── /api/auth/setup ──────────────────────────────────────────────────────────

const lookupWhoAmI = vi.fn();
const upsertUser = vi.fn(async () => {});
let fakeSession: Record<string, unknown> & { save: () => Promise<void> };

vi.mock("@/lib/identity", async (orig) => ({
  ...(await orig<typeof import("@/lib/identity")>()),
  lookupWhoAmI: (...a: unknown[]) => lookupWhoAmI(...a),
  assertOrgModeConfig: () => {},
}));
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  upsertUser: (...a: unknown[]) => upsertUser(...(a as [])),
}));
vi.mock("@/lib/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/session")>()),
  getSession: async () => fakeSession,
}));

const IDENT = { id: 42, login: "octo", name: null, avatar_url: "https://a/x.png", email: null };

function setupReq(opts: { origin?: string | null; contentType?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin !== null) headers.origin = opts.origin ?? "http://localhost";
  if (opts.contentType !== "") headers["content-type"] = opts.contentType ?? "application/json";
  return new NextRequest("http://localhost/api/auth/setup", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? { pat: "ghp_test_not_real" }),
  });
}

describe("POST /api/auth/setup", () => {
  beforeEach(() => {
    vi.resetModules();
    lookupWhoAmI.mockReset();
    upsertUser.mockClear();
    fakeSession = { save: vi.fn(async () => {}) };
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a cross-site origin, a missing origin, and a non-JSON body (login CSRF)", async () => {
    const { POST } = await import("@/app/api/auth/setup/route");
    expect((await POST(setupReq({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(setupReq({ origin: null }))).status).toBe(403);
    expect((await POST(setupReq({ contentType: "text/plain" }))).status).toBe(403);
    expect(lookupWhoAmI).not.toHaveBeenCalled();
  });

  it("org mode: an account outside the allowed orgs is refused and not recorded", async () => {
    vi.stubEnv("MODE", "organization");
    lookupWhoAmI.mockResolvedValue({ identity: IDENT, allowed: false });
    const { POST } = await import("@/app/api/auth/setup/route");
    const res = await POST(setupReq());
    expect(res.status).toBe(403);
    expect(upsertUser).not.toHaveBeenCalled();
    expect(fakeSession.pat).toBeUndefined();
  });

  it("org mode: a PAT login replaces an earlier OAuth session and records the user", async () => {
    vi.stubEnv("MODE", "organization");
    fakeSession.accessToken = "gho_previous_account";
    fakeSession.user = { id: 7, login: "someone-else" };
    lookupWhoAmI.mockResolvedValue({ identity: IDENT, allowed: true });
    const { POST } = await import("@/app/api/auth/setup/route");
    const res = await POST(setupReq());
    expect(res.status).toBe(200);
    expect(fakeSession.accessToken).toBeUndefined(); // no mixed identities
    expect(fakeSession.pat).toBe("ghp_test_not_real");
    expect((fakeSession.user as { id: number }).id).toBe(42);
    expect(upsertUser).toHaveBeenCalledWith({ id: 42, login: "octo", avatar_url: IDENT.avatar_url });
  });

  it("standalone mode: PAT login never touches the users table", async () => {
    vi.stubEnv("MODE", "standalone");
    lookupWhoAmI.mockResolvedValue({ identity: IDENT, allowed: true });
    const { POST } = await import("@/app/api/auth/setup/route");
    expect((await POST(setupReq())).status).toBe(200);
    expect(upsertUser).not.toHaveBeenCalled();
  });
});

// ── users table (real SQL via PGlite) ─────────────────────────────────────────

describe("users table", () => {
  let pg: PGlite;
  beforeEach(async () => {
    vi.resetModules();
    const db = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
    pg = new PGlite();
    db.__setDbClientForTests(createPgliteClient(pg));
  });

  it("the same account via OAuth and PAT is one row", async () => {
    const db = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
    await db.upsertUser({ id: 42, login: "octo", avatar_url: null });
    await db.upsertUser({ id: 42, login: "octo-renamed", avatar_url: "https://a/y.png" });
    const rows = (await pg.query<{ login: string }>(`SELECT login FROM users`)).rows;
    expect(rows).toEqual([{ login: "octo-renamed" }]);
  });

  it("prunes only stale users without any group", async () => {
    const db = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
    for (const id of [1, 2, 3]) await db.upsertUser({ id, login: `u${id}`, avatar_url: null });
    await pg.query(`UPDATE users SET last_seen_at = NOW() - interval '40 days' WHERE github_id IN (1, 2)`);
    await pg.query(`INSERT INTO user_groups (github_id, group_name) VALUES (2, 'dev')`);
    expect(await db.pruneStalePendingUsers()).toBe(1);
    const ids = (await pg.query<{ github_id: number }>(`SELECT github_id FROM users ORDER BY 1`)).rows.map((r) => Number(r.github_id));
    expect(ids).toEqual([2, 3]);
  });
});
