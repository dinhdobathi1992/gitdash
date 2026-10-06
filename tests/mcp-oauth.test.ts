/**
 * MCP OAuth server end to end: authorize -> GitHub -> consent -> token ->
 * refresh -> revoke, against PGlite with GitHub and the CIMD fetch mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { LookupFunction } from "node:net";
import { NextRequest } from "next/server";
import { sealData } from "iron-session";
import { PGlite } from "@electric-sql/pglite";
import { createPgliteClient } from "./setup/pglite";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "o".repeat(24) + "-secret-for-mcp-oauth-tests";
  delete process.env.MCP_PREVIOUS_SESSION_SECRET;
});

const lookupWhoAmI = vi.hoisted(() => vi.fn());
vi.mock("@/lib/identity", async (orig) => ({
  ...(await orig<typeof import("@/lib/identity")>()),
  lookupWhoAmI,
  whoami: lookupWhoAmI,
}));

import { __setDbClientForTests, ensureSchema, type DbClient } from "@/lib/db";
import { sessionOptions } from "@/lib/session";
import { __clearGrantCacheForTests } from "@/lib/mcp/oauth/grants";
import { __setClientFetchDepsForTests } from "@/lib/mcp/oauth/clients";
import { __resetConfigWarningForTests } from "@/lib/mcp/oauth/config";
import { GET as authorizeGET } from "@/app/oauth/authorize/route";
import { GET as callbackGET } from "@/app/api/auth/callback/mcp/route";
import { GET as consentGET, POST as consentPOST } from "@/app/oauth/consent/route";
import { POST as tokenPOST, OPTIONS as tokenOPTIONS } from "@/app/oauth/token/route";
import { POST as revokePOST } from "@/app/oauth/revoke/route";
import { POST as registerPOST } from "@/app/oauth/register/route";
import { GET as asMetadataGET } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as prmGET } from "@/app/.well-known/oauth-protected-resource/[...path]/route";
import { POST as mcpMePOST } from "@/app/mcp/me/route";

const ORIGIN = "https://gitdash.test";
const RESOURCE = `${ORIGIN}/mcp/me`;
const CLIENT = "https://client.example.com/oauth/metadata.json";
const REDIRECT = "https://app.example.com/callback";
const GH = "gho_FAKEtokenForOAuthTests0123456789abcd";
const USER = { id: 4242, login: "octo", name: null, avatar_url: "https://avatars.example/u", email: null };

// ── Fakes ────────────────────────────────────────────────────────────────────

let clientDoc: Record<string, unknown> = {};

/** https.request stand-in serving the client's metadata document. */
const fakeRequest = ((options: { lookup: LookupFunction; hostname: string }, cb: (res: unknown) => void) => {
  const req = Object.assign(new EventEmitter(), {
    destroy: () => undefined,
    end: () =>
      options.lookup(options.hostname, {}, (err) => {
        if (err) return req.emit("error", err);
        const res = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
        cb(res);
        res.end(JSON.stringify(clientDoc));
      }),
  });
  return req;
}) as unknown as typeof import("node:https").request;

const ghToken = (status?: number) =>
  vi.fn(async (url: string | URL) => {
    if (String(url).startsWith("https://github.com/login/oauth/access_token")) {
      return new Response(JSON.stringify(status ? { error: "bad_verification_code" } : { access_token: GH }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${String(url)}`);
  });

class Jar {
  private m = new Map<string, string>();
  absorb(res: Response): this {
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      if (/max-age=0(;|$)/i.test(c)) this.m.delete(name);
      else this.m.set(name, pair.slice(i + 1));
    }
    return this;
  }
  set(name: string, value: string): this {
    this.m.set(name, value);
    return this;
  }
  names(): string[] {
    return [...this.m.keys()];
  }
  header(): string {
    return [...this.m].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

let ipN = 0;
const nextIp = () => `198.51.100.${(ipN++ % 250) + 1}`;

function req(path: string, init: { method?: string; jar?: Jar; headers?: Record<string, string>; body?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": nextIp(), ...(init.headers ?? {}) };
  if (init.jar) headers.cookie = init.jar.header();
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.body });
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const FORM = { "content-type": "application/x-www-form-urlencoded" };

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizeQuery(challenge: string, over: Record<string, string | null> = {}) {
  const p: Record<string, string | null> = {
    response_type: "code",
    client_id: CLIENT,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
    state: "st-123",
    scope: "gitdash:read",
    ...over,
  };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== null) q.set(k, v);
  return `/oauth/authorize?${q.toString()}`;
}

const loc = (res: Response) => new URL(res.headers.get("location")!);

/** authorize -> GitHub -> callback. Returns the jar holding the signed-in transaction and its nonce. */
async function toConsent(challenge: string, jar = new Jar(), over: Record<string, string | null> = {}) {
  const a = await authorizeGET(req(authorizeQuery(challenge, over), { jar }));
  expect(a.status).toBe(302);
  jar.absorb(a);
  const gh = loc(a);
  expect(gh.origin + gh.pathname).toBe("https://github.com/login/oauth/authorize");
  expect(gh.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/mcp`);
  const nonce = gh.searchParams.get("state")!;
  const cb = await callbackGET(req(`/api/auth/callback/mcp?code=ghcode&state=${nonce}`, { jar }));
  expect(cb.status).toBe(302);
  expect(loc(cb).pathname + loc(cb).search).toBe(`/oauth/consent?tx=${nonce}`);
  jar.absorb(cb);
  return { jar, nonce };
}

async function allow(jar: Jar, nonce: string, decision = "allow") {
  return consentPOST(req("/oauth/consent", { method: "POST", jar, headers: { ...FORM, origin: ORIGIN }, body: form({ tx: nonce, decision }) }));
}

/** Full sign-in: returns the code and verifier. */
async function signIn() {
  const { verifier, challenge } = pkce();
  const { jar, nonce } = await toConsent(challenge);
  const res = await allow(jar, nonce);
  expect(res.status).toBe(302);
  const back = loc(res);
  expect(back.origin + back.pathname).toBe(REDIRECT);
  return { code: back.searchParams.get("code")!, verifier, back };
}

async function exchange(code: string, verifier: string, over: Record<string, string> = {}) {
  const body = form({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: CLIENT, redirect_uri: REDIRECT, resource: RESOURCE, ...over });
  return tokenPOST(req("/oauth/token", { method: "POST", headers: FORM, body }));
}

async function refresh(token: string, over: Record<string, string> = {}) {
  return tokenPOST(req("/oauth/token", { method: "POST", headers: FORM, body: form({ grant_type: "refresh_token", refresh_token: token, client_id: CLIENT, ...over }) }));
}

async function tokens() {
  const { code, verifier } = await signIn();
  const res = await exchange(code, verifier);
  expect(res.status).toBe(200);
  return (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
}

// ── Database ─────────────────────────────────────────────────────────────────

let pg: PGlite;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as Record<string, unknown>[];
const grants = () => q(`SELECT grant_id::text, revoked_reason, redeemed_at FROM mcp_grants ORDER BY created_at`);
const auditActions = async () => (await q(`SELECT action FROM permission_audit ORDER BY id`)).map((r) => r.action);

const downClient = (() => {
  const fail = () => Promise.reject(new Error("database down"));
  return Object.assign(fail, { query: fail, transaction: fail }) as unknown as DbClient;
})();
function databaseDown() {
  __setDbClientForTests(downClient);
  __clearGrantCacheForTests();
}
function databaseUp() {
  __setDbClientForTests(createPgliteClient(pg));
}

beforeAll(async () => {
  pg = new PGlite();
  databaseUp();
  await ensureSchema();
});
afterAll(async () => {
  __setDbClientForTests(null);
  await pg.close();
});

let spies: MockInstance[] = [];

beforeEach(async () => {
  databaseUp();
  await ensureSchema();
  await q(`DELETE FROM mcp_grants`);
  await q(`DELETE FROM mcp_used_jti`);
  await q(`DELETE FROM permission_audit`);
  __clearGrantCacheForTests();
  __resetConfigWarningForTests();
  vi.stubEnv("MODE", "organization");
  vi.stubEnv("GITDASH_MCP", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", `${ORIGIN}/`);
  vi.stubEnv("GITHUB_CLIENT_ID", "Iv1.mcp");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "gh-secret");
  vi.stubEnv("MCP_ALLOW_DCR", "");
  vi.stubEnv("MCP_NATIVE_SCHEMES", "");
  clientDoc = { client_id: CLIENT, client_name: "Example Client", redirect_uris: [REDIRECT] };
  __setClientFetchDepsForTests({ resolver: async () => [{ address: "93.184.216.34", family: 4 }], request: fakeRequest });
  lookupWhoAmI.mockReset();
  lookupWhoAmI.mockResolvedValue({ identity: USER, allowed: true });
  vi.stubGlobal("fetch", ghToken());
  spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(() => {
  // No console output may carry the GitHub token or a sealed token.
  for (const s of spies) {
    for (const call of s.mock.calls) {
      const text = call.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" ");
      expect(text).not.toContain(GH);
      expect(text).not.toContain("Fe26.");
    }
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  __setClientFetchDepsForTests();
});

// ── Registry and proxy ───────────────────────────────────────────────────────

describe("route registry and proxy", () => {
  const paths: [string, string][] = [
    ["/oauth/authorize", "GET"],
    ["/oauth/consent", "POST"],
    ["/oauth/token", "POST"],
    ["/oauth/revoke", "POST"],
    ["/oauth/register", "POST"],
    ["/.well-known/oauth-authorization-server", "GET"],
    ["/.well-known/oauth-protected-resource/mcp/me", "GET"],
    ["/api/auth/callback/mcp", "GET"],
    ["/mcp/me", "POST"],
  ];

  it("classifies every MCP OAuth path as public (they authenticate on their own)", async () => {
    const { classify } = await import("@/lib/permissions");
    for (const [p, m] of paths) expect(classify(p, m), p).toBe("public");
    expect(classify("/api/auth/callback/mcpX", "GET")).toBe("unregistered");
  });

  it("the proxy lets them through without a session", async () => {
    const { proxy } = await import("@/proxy");
    for (const [p, m] of paths) {
      const res = await proxy(new NextRequest(`${ORIGIN}${p}`, { method: m }));
      expect(res.headers.get("location"), p).toBeNull();
      expect(res.status, p).toBe(200);
    }
  });
});

// ── Metadata ─────────────────────────────────────────────────────────────────

describe("metadata", () => {
  it("authorization server metadata carries the required fields; no registration endpoint without DCR", async () => {
    const res = asMetadataGET(req("/.well-known/oauth-authorization-server"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const m = await res.json();
    expect(m).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      revocation_endpoint: `${ORIGIN}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect(m.registration_endpoint).toBeUndefined();
  });

  it("protected resource metadata uses the explicit resource URL, whatever X-Forwarded-Host says", async () => {
    const ctx = { params: Promise.resolve({ path: ["mcp", "me"] }) };
    const res = await prmGET(req("/.well-known/oauth-protected-resource/mcp/me", { headers: { "x-forwarded-host": "evil.example" } }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({ resource: RESOURCE, authorization_servers: [ORIGIN] });
    const other = await prmGET(req("/.well-known/oauth-protected-resource/mcp"), { params: Promise.resolve({ path: ["mcp"] }) });
    expect(other.status).toBe(404);
  });
});

// ── Happy paths ──────────────────────────────────────────────────────────────

describe("sign-in flows", () => {
  it("full CIMD flow: consent shows host first, then name, unverified label and login; tokens are issued", async () => {
    const { verifier, challenge } = pkce();
    const { jar, nonce } = await toConsent(challenge);
    const page = await consentGET(req(`/oauth/consent?tx=${nonce}`, { jar }));
    expect(page.status).toBe(200);
    const html = await page.text();
    const at = (s: string) => html.indexOf(s);
    expect(at("app.example.com")).toBeGreaterThan(-1);
    expect(at("app.example.com")).toBeLessThan(at("Example Client"));
    expect(html).toContain("It calls itself <strong>Example Client</strong>");
    expect(html).toContain("client.example.com");
    expect(html).toContain("Unverified app");
    expect(html).toContain("<strong>octo</strong>");
    expect(html).toContain("Settings → Connected apps");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    // "no-referrer" would make the browser send Origin: null on the form POST.
    expect(page.headers.get("referrer-policy")).toBe("same-origin");
    expect(html).not.toContain(GH);

    const res = await allow(jar, nonce);
    expect(res.status).toBe(302);
    const back = loc(res);
    expect(back.searchParams.get("state")).toBe("st-123");
    expect(back.searchParams.get("iss")).toBe(ORIGIN);
    expect(res.headers.get("content-security-policy")).toMatch(/form-action 'self' https:\/\/app\.example\.com(;|$)/);
    expect(new Jar().absorb(res).names()).toEqual([]); // the transaction cookie is deleted

    const tok = await exchange(back.searchParams.get("code")!, verifier);
    expect(tok.status).toBe(200);
    expect(tok.headers.get("cache-control")).toBe("no-store");
    expect(tok.headers.get("access-control-allow-origin")).toBe("*");
    const body = await tok.json();
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "gitdash:read" });
    expect(body.access_token).not.toContain(GH);
    expect(await auditActions()).toEqual(["mcp.grant_created", "mcp.token_issued"]);
    const [g] = await grants();
    expect(g.redeemed_at).not.toBeNull();
    // The GitHub token was never written to the database.
    expect(JSON.stringify(await q(`SELECT * FROM mcp_grants`))).not.toContain(GH);
    expect(JSON.stringify(await q(`SELECT * FROM permission_audit`))).not.toMatch(/gh[opsur]_|Fe26\./);
  });

  it("signed-in shortcut: an OAuth web session goes straight to consent (no GitHub round trip)", async () => {
    const session = await sealData({ accessToken: GH, user: { login: "spoofed" } }, { password: sessionOptions.password as string });
    const jar = new Jar().set(sessionOptions.cookieName, session);
    const { challenge } = pkce();
    const res = await authorizeGET(req(authorizeQuery(challenge), { jar }));
    expect(res.status).toBe(302);
    expect(loc(res).pathname).toBe("/oauth/consent");
    expect(lookupWhoAmI).toHaveBeenCalledWith(GH);
    jar.absorb(res);
    const html = await (await consentGET(req(`/oauth/consent?${loc(res).searchParams}`, { jar }))).text();
    expect(html).toContain("<strong>octo</strong>"); // from GitHub, not the display-only session.user
    expect(html).not.toContain("spoofed");
    // The web session cookie was never written.
    expect(res.headers.getSetCookie().some((c) => c.startsWith(sessionOptions.cookieName))).toBe(false);
  });

  it("a PAT web session goes through GitHub instead of the shortcut", async () => {
    const session = await sealData({ pat: "ghp_personalToken0123456789" }, { password: sessionOptions.password as string });
    const jar = new Jar().set(sessionOptions.cookieName, session);
    const { challenge } = pkce();
    const res = await authorizeGET(req(authorizeQuery(challenge), { jar }));
    expect(loc(res).origin).toBe("https://github.com");
    expect(lookupWhoAmI).not.toHaveBeenCalled();
  });

  it("an OAuth web session that GitHub now rejects falls back to GitHub sign-in", async () => {
    lookupWhoAmI.mockRejectedValueOnce(Object.assign(new Error("Bad credentials"), { status: 401 }));
    const session = await sealData({ accessToken: GH }, { password: sessionOptions.password as string });
    const { challenge } = pkce();
    const res = await authorizeGET(req(authorizeQuery(challenge), { jar: new Jar().set(sessionOptions.cookieName, session) }));
    expect(loc(res).origin).toBe("https://github.com");
  });

  it("two parallel transactions in one browser do not collide", async () => {
    const a = pkce();
    const b = pkce();
    const jar = new Jar();
    const first = await toConsent(a.challenge, jar, { state: "first" });
    const second = await toConsent(b.challenge, jar, { state: "second" });
    expect(first.nonce).not.toBe(second.nonce);
    expect(jar.names().filter((n) => n.startsWith("mcp_tx_"))).toHaveLength(2);
    const r2 = await allow(jar, second.nonce);
    jar.absorb(r2);
    const r1 = await allow(jar, first.nonce);
    expect(loc(r1).searchParams.get("state")).toBe("first");
    expect(loc(r2).searchParams.get("state")).toBe("second");
    expect((await exchange(loc(r1).searchParams.get("code")!, a.verifier)).status).toBe(200);
    expect((await exchange(loc(r2).searchParams.get("code")!, b.verifier)).status).toBe(200);
  });

  it("deny redirects with access_denied, state and iss", async () => {
    const { challenge } = pkce();
    const { jar, nonce } = await toConsent(challenge);
    const res = await allow(jar, nonce, "deny");
    const back = loc(res);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("st-123");
    expect(back.searchParams.get("iss")).toBe(ORIGIN);
    expect(await grants()).toEqual([]);
  });
});

// ── Authorization request errors ─────────────────────────────────────────────

describe("authorize errors", () => {
  it("a redirect_uri the client did not register renders an error page and never redirects", async () => {
    const { challenge } = pkce();
    const res = await authorizeGET(req(authorizeQuery(challenge, { redirect_uri: "https://evil.example/cb" })));
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("an unverifiable client renders an error page", async () => {
    const { challenge } = pkce();
    const res = await authorizeGET(req(authorizeQuery(challenge, { client_id: "http://client.example.com/meta.json" })));
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each([
    ["a plain challenge", { code_challenge_method: "plain" }, "invalid_request"],
    ["a missing challenge", { code_challenge: null, code_challenge_method: null }, "invalid_request"],
    ["a resource mismatch", { resource: "https://other.example/mcp/me" }, "invalid_target"],
    ["a missing resource", { resource: null }, "invalid_target"],
    ["response_type token", { response_type: "token" }, "unsupported_response_type"],
    ["an unknown scope", { scope: "repo" }, "invalid_scope"],
  ])("%s redirects back with %s", async (_name, over, error) => {
    const { challenge } = pkce();
    const res = await authorizeGET(req(authorizeQuery(challenge, over as Record<string, string | null>)));
    expect(res.status).toBe(302);
    const back = loc(res);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("error")).toBe(error);
    expect(back.searchParams.get("state")).toBe("st-123");
    expect(back.searchParams.get("iss")).toBe(ORIGIN);
  });

  it("accepts a resource that differs only by a trailing slash", async () => {
    const { challenge } = pkce();
    const res = await authorizeGET(req(authorizeQuery(challenge, { resource: `${RESOURCE}/` })));
    expect(loc(res).origin).toBe("https://github.com");
  });

  it("a user outside the allowed organizations is sent back with access_denied", async () => {
    lookupWhoAmI.mockResolvedValue({ identity: USER, allowed: false });
    const { challenge } = pkce();
    const jar = new Jar();
    const a = await authorizeGET(req(authorizeQuery(challenge), { jar }));
    jar.absorb(a);
    const cb = await callbackGET(req(`/api/auth/callback/mcp?code=x&state=${loc(a).searchParams.get("state")}`, { jar }));
    expect(loc(cb).searchParams.get("error")).toBe("access_denied");
    expect(loc(cb).origin).toBe("https://app.example.com");
  });

  it("the GitHub callback needs a live transaction cookie for its state and sends the MCP redirect_uri", async () => {
    const fetchSpy = ghToken();
    vi.stubGlobal("fetch", fetchSpy);
    const { challenge } = pkce();
    const jar = new Jar();
    const a = await authorizeGET(req(authorizeQuery(challenge), { jar }));
    const nonce = loc(a).searchParams.get("state")!;
    // No cookie: refused.
    expect((await callbackGET(req(`/api/auth/callback/mcp?code=x&state=${nonce}`))).status).toBe(400);
    jar.absorb(a);
    await callbackGET(req(`/api/auth/callback/mcp?code=x&state=${nonce}`, { jar }));
    const body = JSON.parse(String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.redirect_uri).toBe(`${ORIGIN}/api/auth/callback/mcp`);
  });
});

// ── Consent CSRF and expiry ──────────────────────────────────────────────────

describe("consent", () => {
  it("refuses a POST without tx, or with a foreign Origin", async () => {
    const { challenge } = pkce();
    const { jar, nonce } = await toConsent(challenge);
    const noTx = await consentPOST(req("/oauth/consent", { method: "POST", jar, headers: { ...FORM, origin: ORIGIN }, body: form({ decision: "allow" }) }));
    expect(noTx.status).toBe(400);
    const foreign = await consentPOST(
      req("/oauth/consent", { method: "POST", jar, headers: { ...FORM, origin: "https://evil.example" }, body: form({ tx: nonce, decision: "allow" }) }),
    );
    expect(foreign.status).toBe(403);
    // A tx without its cookie (a cross-site POST carries no Lax cookie) is refused too.
    const noCookie = await consentPOST(req("/oauth/consent", { method: "POST", headers: FORM, body: form({ tx: nonce, decision: "allow" }) }));
    expect(noCookie.status).toBe(400);
    expect(await grants()).toEqual([]);
  });

  it("an expired transaction is refused", async () => {
    const { challenge } = pkce();
    const { jar, nonce } = await toConsent(challenge);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect((await consentGET(req(`/oauth/consent?tx=${nonce}`, { jar }))).status).toBe(400);
    expect((await allow(jar, nonce)).status).toBe(400);
  });

  it("the transaction cookie is per nonce, HttpOnly, SameSite=Lax, Secure, 10 minutes", async () => {
    const { challenge } = pkce();
    const a = await authorizeGET(req(authorizeQuery(challenge)));
    const nonce = loc(a).searchParams.get("state")!;
    const [cookie] = a.headers.getSetCookie();
    expect(cookie.startsWith(`mcp_tx_${nonce}=`)).toBe(true);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/Max-Age=600/);
  });
});

// ── Token endpoint ───────────────────────────────────────────────────────────

describe("authorization_code grant", () => {
  it("a wrong verifier fails without burning the code; the right verifier then succeeds", async () => {
    const { code, verifier } = await signIn();
    const bad = await exchange(code, pkce().verifier);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_grant");
    expect((await exchange(code, verifier)).status).toBe(200);
  });

  it("a code presented by another client fails and stays usable by its own client", async () => {
    const { code, verifier } = await signIn();
    const other = await exchange(code, verifier, { client_id: "https://other.example.com/meta.json" });
    expect((await other.json()).error).toBe("invalid_grant");
    expect((await exchange(code, verifier)).status).toBe(200);
  });

  it("a resource mismatch is invalid_target", async () => {
    const { code, verifier } = await signIn();
    const res = await exchange(code, verifier, { resource: "https://other.example/mcp/me" });
    expect((await res.json()).error).toBe("invalid_target");
  });

  it("a replayed code is refused and revokes the grant", async () => {
    const { code, verifier } = await signIn();
    const first = await exchange(code, verifier);
    const { refresh_token } = await first.json();
    const replay = await exchange(code, verifier);
    expect((await replay.json()).error).toBe("invalid_grant");
    expect((await grants())[0].revoked_reason).toBe("code_reuse");
    expect(await auditActions()).toContain("mcp.code_reuse");
    expect((await (await refresh(refresh_token)).json()).error).toBe("invalid_grant");
  });

  it("accepts form encoding only, with no-store and exactly one CORS origin on errors too", async () => {
    const res = await tokenPOST(req("/oauth/token", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const pre = tokenOPTIONS(req("/oauth/token", { method: "OPTIONS" }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("a database outage while redeeming is 503, not invalid_grant", async () => {
    const { code, verifier } = await signIn();
    databaseDown();
    const res = await exchange(code, verifier);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
  });
});

describe("refresh_token grant", () => {
  it("rotates: the new refresh token works", async () => {
    const t = await tokens();
    const r1 = await refresh(t.refresh_token);
    expect(r1.status).toBe(200);
    expect(r1.headers.get("cache-control")).toBe("no-store");
    const b1 = await r1.json();
    expect((await refresh(b1.refresh_token)).status).toBe(200);
  });

  it("two parallel refreshes with the same token both succeed", async () => {
    const t = await tokens();
    const [a, b] = await Promise.all([refresh(t.refresh_token), refresh(t.refresh_token)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await grants())[0].revoked_reason).toBeNull();
  });

  it("a refresh token reused after the 30 s grace window revokes the grant", async () => {
    const t = await tokens();
    expect((await refresh(t.refresh_token)).status).toBe(200);
    await q(`UPDATE mcp_grants SET rotated_at = NOW() - INTERVAL '31 seconds'`);
    const reuse = await refresh(t.refresh_token);
    expect((await reuse.json()).error).toBe("invalid_grant");
    expect((await grants())[0].revoked_reason).toBe("refresh_reuse");
    expect(await auditActions()).toContain("mcp.refresh_reuse");
  });

  it("GitHub 401 during refresh revokes the grant", async () => {
    const t = await tokens();
    lookupWhoAmI.mockRejectedValueOnce(Object.assign(new Error("Bad credentials"), { status: 401 }));
    const res = await refresh(t.refresh_token);
    expect((await res.json()).error).toBe("invalid_grant");
    expect((await grants())[0].revoked_reason).toBe("github_revoked");
    expect(await auditActions()).toContain("mcp.github_revoked");
  });

  it("a user removed from the organization during refresh has the grant revoked", async () => {
    const t = await tokens();
    lookupWhoAmI.mockResolvedValueOnce({ identity: USER, allowed: false });
    expect((await (await refresh(t.refresh_token)).json()).error).toBe("invalid_grant");
    expect((await grants())[0].revoked_reason).toBe("org_removed");
  });

  it("a GitHub outage during refresh is 503 and does not revoke", async () => {
    const t = await tokens();
    lookupWhoAmI.mockRejectedValueOnce(Object.assign(new Error("Service unavailable"), { status: 503 }));
    const res = await refresh(t.refresh_token);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
    expect((await grants())[0].revoked_reason).toBeNull();
  });

  it("the database down during refresh is 503", async () => {
    const t = await tokens();
    databaseDown();
    const res = await refresh(t.refresh_token);
    expect(res.status).toBe(503);
    databaseUp();
    expect((await refresh(t.refresh_token)).status).toBe(200);
  });

  it("refuses a refresh token for another client, an access token, and a tampered token", async () => {
    const t = await tokens();
    expect((await (await refresh(t.refresh_token, { client_id: "https://other.example.com/m.json" })).json()).error).toBe("invalid_grant");
    expect((await (await refresh(t.access_token)).json()).error).toBe("invalid_grant");
    expect((await (await refresh(t.refresh_token.slice(0, -2) + "xx")).json()).error).toBe("invalid_grant");
  });
});

// ── Revocation ───────────────────────────────────────────────────────────────

describe("revoke", () => {
  it("revokes the grant from a refresh or access token, and answers 200 for garbage", async () => {
    const t = await tokens();
    const res = await revokePOST(req("/oauth/revoke", { method: "POST", headers: FORM, body: form({ token: t.access_token, client_id: CLIENT }) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect((await grants())[0].revoked_reason).toBe("client_revoked");
    expect((await (await refresh(t.refresh_token)).json()).error).toBe("invalid_grant");
    const junk = await revokePOST(req("/oauth/revoke", { method: "POST", headers: FORM, body: form({ token: "nope" }) }));
    expect(junk.status).toBe(200);
  });

  it("does not revoke a token issued to another client", async () => {
    const t = await tokens();
    await revokePOST(req("/oauth/revoke", { method: "POST", headers: FORM, body: form({ token: t.refresh_token, client_id: "https://x.example.com/m.json" }) }));
    expect((await grants())[0].revoked_reason).toBeNull();
  });
});

// ── Feature flags and configuration ──────────────────────────────────────────

describe("feature gate", () => {
  const everyRoute = async () => {
    const ctx = { params: Promise.resolve({ path: ["mcp", "me"] }) };
    return [
      await authorizeGET(req(authorizeQuery(pkce().challenge))),
      await callbackGET(req("/api/auth/callback/mcp?state=x")),
      await consentGET(req("/oauth/consent?tx=x")),
      await consentPOST(req("/oauth/consent", { method: "POST", headers: FORM, body: "tx=x" })),
      await tokenPOST(req("/oauth/token", { method: "POST", headers: FORM, body: "grant_type=refresh_token" })),
      await revokePOST(req("/oauth/revoke", { method: "POST", headers: FORM, body: "token=x" })),
      await registerPOST(req("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })),
      asMetadataGET(req("/.well-known/oauth-authorization-server")),
      await prmGET(req("/.well-known/oauth-protected-resource/mcp/me"), ctx),
      await mcpMePOST(req("/mcp/me", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })),
    ];
  };

  it("GITDASH_MCP unset: 404 everywhere", async () => {
    vi.stubEnv("GITDASH_MCP", "");
    for (const res of await everyRoute()) expect(res.status).toBe(404);
  });

  it("standalone mode: 404 everywhere", async () => {
    vi.stubEnv("MODE", "standalone");
    for (const res of await everyRoute()) expect(res.status).toBe(404);
  });

  it("NEXT_PUBLIC_APP_URL missing or not this origin: 503 misconfigured everywhere, logged once", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://preview.gitdash.test");
    for (const res of await everyRoute()) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "misconfigured" });
    }
    const errors = (spies[3] as MockInstance).mock.calls.filter((c) => String(c[0]).includes("misconfigured"));
    expect(errors).toHaveLength(1);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    for (const res of await everyRoute()) expect(res.status).toBe(503);
  });
});

describe("Dynamic Client Registration (MCP_ALLOW_DCR)", () => {
  const register = (body: unknown) =>
    registerPOST(req("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("is off by default", async () => {
    expect((await register({ redirect_uris: [REDIRECT] })).status).toBe(404);
  });

  it("when on: registers statelessly, advertises the endpoint, and the client can sign in", async () => {
    vi.stubEnv("MCP_ALLOW_DCR", "true");
    expect((await asMetadataGET(req("/.well-known/oauth-authorization-server")).json()).registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    const res = await register({ redirect_uris: ["http://127.0.0.1:33418/callback"], client_name: "Inspector", token_endpoint_auth_method: "none" });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const reg = await res.json();
    expect(reg).toMatchObject({ client_name: "Inspector", token_endpoint_auth_method: "none", application_type: "native" });

    const { verifier, challenge } = pkce();
    const over = { client_id: reg.client_id, redirect_uri: "http://127.0.0.1:33418/callback" };
    const { jar, nonce } = await toConsent(challenge, new Jar(), over);
    const html = await (await consentGET(req(`/oauth/consent?tx=${nonce}`, { jar }))).text();
    expect(html).toContain("an app on this computer");
    const back = loc(await allow(jar, nonce));
    const tok = await exchange(back.searchParams.get("code")!, verifier, { client_id: reg.client_id, redirect_uri: over.redirect_uri });
    expect(tok.status).toBe(200);
    // The grant stores a hash of the sealed client id, never the seal.
    expect(JSON.stringify(await q(`SELECT * FROM mcp_grants`))).not.toContain("Fe26.");
  });

  it("refuses confidential clients and bad redirect URIs", async () => {
    vi.stubEnv("MCP_ALLOW_DCR", "true");
    expect((await (await register({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" })).json()).error).toBe("invalid_client_metadata");
    expect((await (await register({ redirect_uris: ["javascript:alert(1)"] })).json()).error).toBe("invalid_redirect_uri");
  });
});

describe("native redirect schemes (MCP_NATIVE_SCHEMES)", () => {
  const NATIVE = "cursor://anysphere.cursor-retrieval/oauth/callback";

  it("off: a custom scheme is refused with an error page", async () => {
    clientDoc = { ...clientDoc, redirect_uris: [NATIVE] };
    const res = await authorizeGET(req(authorizeQuery(pkce().challenge, { redirect_uri: NATIVE })));
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("on: allowed with a stronger warning, and the return is an Open-app page, not a 302", async () => {
    vi.stubEnv("MCP_NATIVE_SCHEMES", "cursor");
    clientDoc = { ...clientDoc, redirect_uris: [NATIVE] };
    const { challenge } = pkce();
    const { jar, nonce } = await toConsent(challenge, new Jar(), { redirect_uri: NATIVE });
    const html = await (await consentGET(req(`/oauth/consent?tx=${nonce}`, { jar }))).text();
    expect(html).toContain("a desktop app");
    expect(html).toContain("cursor://anysphere.cursor-retrieval");
    expect(html).toContain("can be claimed by any program");
    const res = await allow(jar, nonce);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toMatch(/form-action 'self' cursor:/);
    const page = await res.text();
    expect(page).toContain("location.replace(");
    expect(page).toContain("cursor://anysphere.cursor-retrieval/oauth/callback?code=");
  });
});
