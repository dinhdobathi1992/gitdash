/**
 * Personal MCP keys: POST /api/mcp/keys minting, the key at /mcp/me, revocation
 * and expiry, token-type confusion, standalone mode and the gates, and that no
 * key or GitHub token reaches logs, audit rows or the database. PGlite
 * database; GitHub is mocked at the identity and loader-source layers; the web
 * session is mocked at the session module.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { NextRequest } from "next/server";
import { PGlite } from "@electric-sql/pglite";
import { createPgliteClient } from "./setup/pglite";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "k".repeat(24) + "-secret-for-mcp-key-tests";
  delete process.env.MCP_PREVIOUS_SESSION_SECRET;
});

const PAT = "github_pat_FAKEpatForPersonalKeyTests0123456789";
const OAUTH = "gho_FAKEoauthForPersonalKeyTests012345";

const web = vi.hoisted(() => ({
  session: {} as { pat?: string; accessToken?: string; user?: { id?: number; login: string; name: null; avatar_url: string; email: null } },
}));
const gh = vi.hoisted(() => ({ id: 0, allowed: true }));
const whoami = vi.hoisted(() => vi.fn());
vi.mock("@/lib/identity", async (orig) => ({
  ...(await orig<typeof import("@/lib/identity")>()),
  whoami,
  lookupWhoAmI: whoami,
}));
vi.mock("@/lib/session", async (orig) => {
  const m = await orig<typeof import("@/lib/session")>();
  return {
    ...m,
    getSession: async () => web.session,
    getTokenFromSession: async () => m.sessionToken(web.session),
  };
});
const github = vi.hoisted(() => ({ listRepos: vi.fn(), getRepoSummary: vi.fn() }));
vi.mock("@/lib/github", async (orig) => ({ ...(await orig<typeof import("@/lib/github")>()), ...github }));

import { __setDbClientForTests, ensureSchema } from "@/lib/db";
import { __resetCacheForTests } from "@/lib/cache";
import { __resetAccessForTests } from "@/lib/permissions";
import { __resetRecordSeenForTests } from "@/lib/record-seen";
import { __clearGrantCacheForTests, createGrant, redeemGrant } from "@/lib/mcp/oauth/grants";
import { open, seal, TOKEN_TTL_SEC } from "@/lib/mcp/oauth/tokens";
import { TOKEN_LIKE } from "@/lib/mcp/oauth/audit";
import { PERSONAL_KEY_CLIENT_ID, __resetConfigWarningForTests } from "@/lib/mcp/oauth/config";
import { classify } from "@/lib/permissions";
import { POST as keysPOST } from "@/app/api/mcp/keys/route";
import { GET as grantsGET } from "@/app/api/mcp/grants/route";
import { DELETE as grantDELETE } from "@/app/api/mcp/grants/[id]/route";
import { POST as mePOST } from "@/app/mcp/me/route";
import { POST as tokenPOST } from "@/app/oauth/token/route";
import { GET as authorizeGET } from "@/app/oauth/authorize/route";
import { GET as callbackGET } from "@/app/api/auth/callback/mcp/route";
import { GET as asMetadataGET } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as prmGET } from "@/app/.well-known/oauth-protected-resource/[...path]/route";

const ORIGIN = "https://gitdash.test";
const RESOURCE = `${ORIGIN}/mcp/me`;
const CLIENT = "https://client.example.com/oauth/metadata.json";

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
};

// ── Requests ─────────────────────────────────────────────────────────────────

let ipN = 0;
const nextIp = () => `198.51.100.${(ipN++ % 250) + 1}`;

/** Every key minted in a test, so the leak sweep can look for it. */
const minted: string[] = [];

async function mintKey(label: unknown = "Claude Code on my laptop", headers: Record<string, string> = {}) {
  const res = await keysPOST(
    new NextRequest(`${ORIGIN}/api/mcp/keys`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": nextIp(), ...headers },
      body: JSON.stringify({ label }),
    }),
  );
  const body = (await res.json()) as { key?: string; grant_id?: string; expires_at?: string; error?: string; code?: string };
  if (body.key) minted.push(body.key);
  return { res, body };
}

async function okKey(label?: string) {
  const { res, body } = await mintKey(label);
  expect(res.status).toBe(201);
  return body as { key: string; grant_id: string; expires_at: string };
}

async function rpc(method: string, params: Record<string, unknown>, token: string | null) {
  const name: Record<string, string> = typeof params.name === "string" ? { "mcp-name": params.name } : {};
  const res = await mePOST(
    new NextRequest(`${ORIGIN}/mcp/me`, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: META } }),
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        "x-forwarded-for": nextIp(),
        ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
        ...name,
      },
    }),
  );
  return { res, json: res.status === 200 ? await res.json() : null };
}

const outputs: string[] = [];

async function listRepos(token: string) {
  const { res, json } = await rpc("tools/call", { name: "list_repos", arguments: {} }, token);
  expect(res.status).toBe(200);
  outputs.push(JSON.stringify(json));
  return json.result as { isError?: boolean; structuredContent?: { repos: { full_name: string }[] } };
}

const listGrants = (query = "") => grantsGET(new NextRequest(`${ORIGIN}/api/mcp/grants${query}`));
const revoke = (id: string) =>
  grantDELETE(new NextRequest(`${ORIGIN}/api/mcp/grants/${id}`, { method: "DELETE", headers: { origin: ORIGIN } }), { params: Promise.resolve({ id }) });

function oauthRefresh(refreshToken: string, clientId: string) {
  return tokenPOST(
    new NextRequest(`${ORIGIN}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": nextIp() },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }).toString(),
    }),
  );
}

/** An OAuth-issued access and refresh token pair, as /oauth/token would mint them. */
async function oauthTokens() {
  const g = await createGrant({ github_id: gh.id, client_id: CLIENT, client_name: "Test", redirect_host: "app.example.com" });
  expect(await redeemGrant(g.grant_id, g.current_refresh)).toBe(true);
  const ident = { gh: OAUTH, id: gh.id, login: "octo" };
  const access = await seal("mcp.access", { grant_id: g.grant_id, client_id: CLIENT, aud: RESOURCE, scope: "gitdash:read", ...ident }, 3600);
  const refresh = await seal("mcp.refresh", { jti: g.current_refresh, grant_id: g.grant_id, client_id: CLIENT, aud: RESOURCE, ...ident }, 3600);
  minted.push(access, refresh);
  return { access, refresh, grantId: g.grant_id };
}

// ── Database ─────────────────────────────────────────────────────────────────

let pg: PGlite;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as Record<string, unknown>[];

beforeAll(async () => {
  pg = new PGlite();
  __setDbClientForTests(createPgliteClient(pg));
  await ensureSchema();
});
afterAll(async () => {
  __setDbClientForTests(null);
  await pg.close();
});

let spies: MockInstance[] = [];
let userN = 7000;

function organization() {
  vi.stubEnv("MODE", "organization");
  vi.stubEnv("GITDASH_ADMIN_GITHUB_IDS", "1");
}
function standalone(withDb = true) {
  vi.stubEnv("MODE", "standalone");
  vi.stubEnv("DATABASE_URL", withDb ? "postgres://pglite.test/gitdash" : "");
}

beforeEach(async () => {
  __setDbClientForTests(createPgliteClient(pg));
  await ensureSchema();
  for (const t of ["mcp_grants", "permission_audit", "user_groups", "group_flags", "users"]) await q(`DELETE FROM ${t}`);
  __clearGrantCacheForTests();
  __resetCacheForTests();
  __resetAccessForTests();
  __resetRecordSeenForTests();
  __resetConfigWarningForTests();
  organization();
  vi.stubEnv("GITDASH_MCP", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  // The injected PGlite client is used; the URL only has to be set.
  vi.stubEnv("DATABASE_URL", "postgres://pglite.test/gitdash");
  vi.stubEnv("GITDASH_L2_CACHE", "0");
  vi.stubEnv("GITDASH_RBAC_ENFORCE", "");
  vi.stubEnv("GITDASH_ALLOWED_ORGS", "");
  // A fresh GitHub user per test: the 5-an-hour key limit is per user and per process.
  gh.id = ++userN;
  gh.allowed = true;
  web.session = { pat: PAT };
  whoami.mockReset();
  whoami.mockImplementation(async (token: string) => {
    if (token !== PAT && token !== OAUTH) throw Object.assign(new Error("Bad credentials"), { status: 401 });
    return { identity: { id: gh.id, login: "octo", name: null, avatar_url: "https://avatars.example/u", email: null }, allowed: gh.allowed };
  });
  github.listRepos.mockReset();
  github.listRepos.mockResolvedValue([
    { id: 1, owner: "acme", name: "web", full_name: "acme/web", description: null, private: true, html_url: "https://github.com/acme/web", updated_at: new Date().toISOString(), language: null, stargazers_count: 0 },
  ]);
  github.getRepoSummary.mockReset();
  github.getRepoSummary.mockResolvedValue(null);
  outputs.length = 0;
  minted.length = 0;
  spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(async () => {
  // No log line, tool output, audit row or database column may carry a key or a GitHub token.
  const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" ")));
  const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).map((r) => String(r.table_name));
  const rows: string[] = [];
  for (const t of tables) for (const r of await q(`SELECT t::text AS row FROM "${t}" t`)) rows.push(String(r.row));
  for (const text of [...logged, ...outputs, ...rows]) {
    expect(text).not.toContain(PAT);
    expect(text).not.toContain(OAUTH);
    expect(text).not.toContain("Fe26.");
    for (const k of minted) expect(text).not.toContain(k);
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// ── Minting ──────────────────────────────────────────────────────────────────

describe("POST /api/mcp/keys", () => {
  it("is registered as an auth route", () => {
    expect(classify("/api/mcp/keys", "POST")).toBe("auth");
  });

  it("with a PAT session: seals the PAT, returns the key once with no-store, and /mcp/me tools work with it", async () => {
    const { res, body } = await mintKey();
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys(body).sort()).toEqual(["expires_at", "grant_id", "key"]);
    const days = (Date.parse(body.expires_at!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    const k = await open("mcp.key", body.key);
    expect(k).toMatchObject({ gh: PAT, source: "pat", id: gh.id, login: "octo", aud: RESOURCE, scope: "gitdash:read", grant_id: body.grant_id });
    expect(k!.exp - k!.iat).toBe(TOKEN_TTL_SEC["mcp.key"]);

    const { json } = await rpc("tools/list", {}, body.key!);
    expect((json.result.tools as { name: string }[]).map((t) => t.name)).toContain("list_repos");
    const r = await listRepos(body.key!);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.repos.map((x) => x.full_name)).toEqual(["acme/web"]);
    expect(github.listRepos).toHaveBeenCalledWith(PAT);

    const [grant] = await q(`SELECT client_id, client_name, redirect_host, redeemed_at, github_id::text AS github_id FROM mcp_grants WHERE grant_id = $1`, [body.grant_id]);
    expect(grant).toMatchObject({ client_id: PERSONAL_KEY_CLIENT_ID, client_name: "Claude Code on my laptop", redirect_host: "personal key", github_id: String(gh.id) });
    expect(grant.redeemed_at).not.toBeNull();

    const audit = await q(`SELECT actor_github_id::text AS actor, action, target, details FROM permission_audit`);
    expect(audit).toEqual([
      { actor: String(gh.id), action: "mcp.key_created", target: body.grant_id, details: { label: "Claude Code on my laptop", source: "pat" } },
    ]);
  });

  it("with an OAuth session: seals the OAuth token, and /mcp/me tools work with it", async () => {
    web.session = { accessToken: OAUTH };
    const body = await okKey("Cursor");
    expect(await open("mcp.key", body.key)).toMatchObject({ gh: OAUTH, source: "oauth", id: gh.id });
    expect((await listRepos(body.key)).isError).toBeFalsy();
    expect(github.listRepos).toHaveBeenCalledWith(OAUTH);
  });

  it("binds the key to the identity GitHub returns, not the session's display copy", async () => {
    web.session = { pat: PAT, user: { id: 1, login: "mallory", name: null, avatar_url: "", email: null } };
    const body = await okKey();
    expect(await open("mcp.key", body.key)).toMatchObject({ id: gh.id, login: "octo" });
  });

  it("no session: 401", async () => {
    web.session = {};
    const { res } = await mintKey();
    expect(res.status).toBe(401);
    expect(await q(`SELECT 1 FROM mcp_grants`)).toHaveLength(0);
  });

  it("a session whose token GitHub rejects: 401", async () => {
    web.session = { pat: "ghp_FAKErevokedToken000000000000000000" };
    expect((await mintKey()).res.status).toBe(401);
  });

  it("organization mode, user not allowed: 403 and nothing created", async () => {
    gh.allowed = false;
    const { res, body } = await mintKey();
    expect(res.status).toBe(403);
    expect(body.code).toBe("org_not_allowed");
    expect(await q(`SELECT 1 FROM mcp_grants`)).toHaveLength(0);
  });

  it("the 6th key within an hour: 429 with Retry-After", async () => {
    for (let i = 0; i < 5; i++) await okKey(`key ${i}`);
    const { res } = await mintKey("one too many");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await q(`SELECT 1 FROM mcp_grants`)).toHaveLength(5);
  });

  it("at most 10 active keys per user: the 11th is a 409, revoked or OAuth grants do not count", async () => {
    const live = async () => {
      const g = await createGrant({ github_id: gh.id, client_id: PERSONAL_KEY_CLIENT_ID, client_name: "k", redirect_host: "personal key" });
      expect(await redeemGrant(g.grant_id, g.current_refresh)).toBe(true);
      return g;
    };
    // An OAuth connection and a revoked key are not live keys.
    const oauth = await createGrant({ github_id: gh.id, client_id: "https://claude.ai/oauth/meta.json", client_name: "Claude", redirect_host: "claude.ai" });
    await redeemGrant(oauth.grant_id, oauth.current_refresh);
    const gone = await live();
    await q(`UPDATE mcp_grants SET revoked_at = NOW() WHERE grant_id = $1`, [gone.grant_id]);
    for (let i = 0; i < 10; i++) await live();
    const { res, body } = await mintKey("eleventh");
    expect(res.status).toBe(409);
    expect(body.code).toBe("too_many_keys");
  });

  it("standalone mode without DATABASE_URL: 409 naming the requirement", async () => {
    standalone(false);
    const { res, body } = await mintKey();
    expect(res.status).toBe(409);
    expect(body.error).toMatch(/DATABASE_URL/);
  });

  it("MCP disabled: 404 in both modes", async () => {
    vi.stubEnv("GITDASH_MCP", "false");
    expect((await mintKey()).res.status).toBe(404);
    standalone();
    expect((await mintKey()).res.status).toBe(404);
  });

  it("refuses a bad label, a token-like label and a cross-origin request", async () => {
    for (const label of ["", "   ", "x".repeat(81), 42, null]) {
      expect((await mintKey(label)).res.status, String(label)).toBe(400);
    }
    expect((await mintKey("ghp_abcdefgh")).res.status).toBe(400);
    expect((await mintKey("ok", { origin: "https://evil.example" })).res.status).toBe(403);
    expect(await q(`SELECT 1 FROM mcp_grants`)).toHaveLength(0);
    // 80 characters, with control characters stripped, is fine.
    const body = await okKey("y".repeat(80));
    expect((await q(`SELECT client_name FROM mcp_grants WHERE grant_id = $1`, [body.grant_id]))[0].client_name).toBe("y".repeat(80));
  });

  it("503, not a fake 401, when GitHub is unreachable", async () => {
    whoami.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect((await mintKey()).res.status).toBe(503);
  });

  it("a bad label is refused before any GitHub call", async () => {
    expect((await mintKey("")).res.status).toBe(400);
    expect(whoami).not.toHaveBeenCalled();
  });

  it("when the audit row cannot be written: 503, no key, and the grant is withdrawn", async () => {
    await q(`ALTER TABLE permission_audit RENAME TO permission_audit_off`);
    try {
      const { res, body } = await mintKey();
      expect(res.status).toBe(503);
      expect(body.key).toBeUndefined();
      const rows = await q(`SELECT revoked_at, revoked_reason FROM mcp_grants`);
      expect(rows).toHaveLength(1);
      expect(rows[0].revoked_at).not.toBeNull();
    } finally {
      await q(`ALTER TABLE permission_audit_off RENAME TO permission_audit`);
    }
  });

  it("standalone mode with GITDASH_ALLOWED_ORGS: a user outside them gets 403", async () => {
    standalone();
    vi.stubEnv("GITDASH_ALLOWED_ORGS", "acme");
    gh.allowed = false;
    expect((await mintKey()).res.status).toBe(403);
    expect(await q(`SELECT 1 FROM mcp_grants`)).toHaveLength(0);
  });
});

// ── Revocation and expiry ────────────────────────────────────────────────────

describe("revocation and expiry", () => {
  it("revoked through DELETE /api/mcp/grants/[id]: the key gets 401 once the cache is cleared", async () => {
    const body = await okKey();
    expect((await rpc("tools/list", {}, body.key)).res.status).toBe(200);

    const list = await listGrants();
    expect(list.status).toBe(200);
    const text = await list.text();
    outputs.push(text);
    const grants = (JSON.parse(text) as { grants: { grant_id: string; client_id: string; client_name: string }[] }).grants;
    expect(grants).toEqual([expect.objectContaining({ grant_id: body.grant_id, client_id: PERSONAL_KEY_CLIENT_ID, client_name: "Claude Code on my laptop" })]);
    expect(text).not.toMatch(TOKEN_LIKE);

    expect((await revoke(body.grant_id)).status).toBe(200);
    __clearGrantCacheForTests();
    const { res } = await rpc("tools/list", {}, body.key);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("an expired key: 401", async () => {
    const body = await okKey();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + TOKEN_TTL_SEC["mcp.key"] * 1000 + 10_000);
    const { res } = await rpc("tools/list", {}, body.key);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
});

// ── Token confusion ──────────────────────────────────────────────────────────

describe("token types", () => {
  it("a key presented to /oauth/token as a refresh token: invalid_grant", async () => {
    const body = await okKey();
    for (const clientId of [PERSONAL_KEY_CLIENT_ID, CLIENT]) {
      const res = await oauthRefresh(body.key, clientId);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_grant");
    }
    // The key is untouched by the attempt.
    expect((await rpc("tools/list", {}, body.key)).res.status).toBe(200);
  });

  it("an OAuth access token is still accepted at /mcp/me; its refresh token as a bearer is not", async () => {
    const t = await oauthTokens();
    expect((await rpc("tools/list", {}, t.access)).res.status).toBe(200);
    expect((await rpc("tools/list", {}, t.refresh)).res.status).toBe(401);
  });

  it("a key bound to an OAuth grant, or an access token bound to a key grant, is refused", async () => {
    const body = await okKey();
    const t = await oauthTokens();
    const ident = { gh: PAT, id: gh.id, login: "octo" };
    const keyOnOauthGrant = await seal("mcp.key", { grant_id: t.grantId, aud: RESOURCE, scope: "gitdash:read", source: "pat", ...ident }, 3600);
    const accessOnKeyGrant = await seal("mcp.access", { grant_id: body.grant_id, client_id: CLIENT, aud: RESOURCE, scope: "gitdash:read", ...ident }, 3600);
    minted.push(keyOnOauthGrant, accessOnKeyGrant);
    expect((await rpc("tools/list", {}, keyOnOauthGrant)).res.status).toBe(401);
    expect((await rpc("tools/list", {}, accessOnKeyGrant)).res.status).toBe(401);
  });

  it("a key for another resource is refused", async () => {
    const body = await okKey();
    const wrong = await seal("mcp.key", { grant_id: body.grant_id, aud: "https://other.example/mcp/me", scope: "gitdash:read", source: "pat", gh: PAT, id: gh.id, login: "octo" }, 3600);
    minted.push(wrong);
    expect((await rpc("tools/list", {}, wrong)).res.status).toBe(401);
  });
});

// ── Standalone mode ──────────────────────────────────────────────────────────

describe("standalone mode with DATABASE_URL", () => {
  beforeEach(() => standalone());

  it("mints a key from the PAT and uses it at /mcp/me", async () => {
    const body = await okKey();
    expect(await open("mcp.key", body.key)).toMatchObject({ gh: PAT, source: "pat" });
    expect((await listRepos(body.key)).isError).toBeFalsy();
    expect(github.listRepos).toHaveBeenCalledWith(PAT);
  });

  it("the OAuth endpoints and the protected-resource metadata answer 404", async () => {
    const ctx = { params: Promise.resolve({ path: ["mcp", "me"] }) };
    const get = (path: string) => new NextRequest(`${ORIGIN}${path}`, { headers: { "x-forwarded-for": nextIp() } });
    expect((await asMetadataGET(get("/.well-known/oauth-authorization-server"))).status).toBe(404);
    expect((await prmGET(get("/.well-known/oauth-protected-resource/mcp/me"), ctx)).status).toBe(404);
    expect((await authorizeGET(get("/oauth/authorize?client_id=x"))).status).toBe(404);
    expect((await callbackGET(get("/api/auth/callback/mcp?code=x&state=y"))).status).toBe(404);
    expect((await oauthRefresh("x", CLIENT)).status).toBe(404);
  });

  it("the /mcp/me 401 names no authorization server", async () => {
    for (const token of [null, "not-a-key"]) {
      const { res } = await rpc("tools/list", {}, token);
      expect(res.status).toBe(401);
      const www = res.headers.get("www-authenticate")!;
      expect(www).toMatch(/^Bearer /);
      expect(www).not.toContain("resource_metadata");
      expect(www).toContain('scope="gitdash:read"');
    }
  });

  it("the grants API lists and revokes your own keys, never anyone else's", async () => {
    const mine = await okKey("mine");
    const other = await createGrant({ github_id: gh.id + 100_000, client_id: PERSONAL_KEY_CLIENT_ID, client_name: "theirs", redirect_host: "personal key" });
    expect(await redeemGrant(other.grant_id, other.current_refresh)).toBe(true);

    const list = (await (await listGrants()).json()) as { grants: { grant_id: string }[] };
    expect(list.grants.map((g) => g.grant_id)).toEqual([mine.grant_id]);
    // No admins in standalone: the all-users view and revoking another user's key are refused.
    expect((await listGrants("?all=1")).status).toBe(403);
    expect((await revoke(other.grant_id)).status).toBe(403);
    expect((await q(`SELECT revoked_at FROM mcp_grants WHERE grant_id = $1`, [other.grant_id]))[0].revoked_at).toBeNull();

    expect((await revoke(mine.grant_id)).status).toBe(200);
    web.session = {};
    expect((await listGrants()).status).toBe(401);
    expect((await revoke(other.grant_id)).status).toBe(401);
  });
});

describe("standalone mode without DATABASE_URL", () => {
  beforeEach(() => standalone(false));

  it("/mcp/me and the grants API are off (404); minting says why (409)", async () => {
    expect((await rpc("tools/list", {}, null)).res.status).toBe(404);
    expect((await listGrants()).status).toBe(404);
    expect((await mintKey()).res.status).toBe(409);
  });
});
