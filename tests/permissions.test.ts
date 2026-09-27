import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, dirname } from "path";
import { NextRequest } from "next/server";
import { sealData } from "iron-session";
import { PGlite } from "@electric-sql/pglite";
import { createPgliteClient } from "./setup/pglite";

// ── Registry & classify ──────────────────────────────────────────────────────

describe("classify", () => {
  it("maps routes to their access class", async () => {
    const { classify } = await import("@/lib/permissions");
    const cases: [string, string, string][] = [
      ["/docs", "GET", "public"],
      ["/docs/setup", "GET", "public"],
      ["/api/health", "GET", "public"],
      ["/api/auth/setup", "POST", "public"],
      ["/pending", "GET", "auth"],
      ["/api/auth/me", "GET", "auth"],
      ["/admin", "GET", "admin"],
      ["/api/admin/users", "PUT", "admin"],
      ["/api/settings/email/test", "POST", "admin"],
      ["/api/alerts", "GET", "base"],
      ["/api/alerts", "POST", "admin"],
      ["/api/alerts/test", "POST", "admin"],
      ["/api/db/sync", "POST", "admin"],
      ["/api/github/billing", "GET", "flag:costAnalytics"],
      ["/api/github/billing/cost-analysis", "GET", "flag:costAnalytics"],
      ["/cost-analytics", "GET", "flag:costAnalytics"],
      ["/repos/acme/web/security", "GET", "flag:securityScan"],
      ["/org/acme/health", "GET", "flag:healthScorecard"],
      ["/api/ai/root-cause", "GET", "flag:aiInsights"],
      ["/api/github/create-issue", "POST", "flag:githubIssueFromAnomaly"],
      ["/api/github/repos", "GET", "base"],
      ["/api/db/runs", "GET", "base"],
      ["/", "GET", "base"],
      ["/repos/acme/web", "GET", "base"],
      ["/api/nope", "GET", "unregistered"],
      ["/api/github/brand-new-route", "GET", "unregistered"],
    ];
    for (const [path, method, want] of cases) expect(classify(path, method), `${method} ${path}`).toBe(want);
  });

  it("matches whole segments only", async () => {
    const { classify } = await import("@/lib/permissions");
    expect(classify("/docsX", "GET")).toBe("base"); // a page, not the public /docs
    expect(classify("/api/healthX", "GET")).toBe("unregistered");
    expect(classify("/api/github/billingX", "GET")).toBe("unregistered"); // not the billing flag route, and not a listed base route
  });
});

const API_ROOT = join(__dirname, "..", "src", "app", "api");
function routeFiles(dir = API_ROOT): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? routeFiles(p) : n === "route.ts" ? [p] : [];
  });
}

describe("registry completeness", () => {
  it("base /api/github routes are an explicit, reviewed list (no wildcard)", async () => {
    const { BASE_GITHUB_ROUTES, classify } = await import("@/lib/permissions");
    expect([...BASE_GITHUB_ROUTES].sort()).toEqual([
      "audit-log", "contributor-profile", "deployments", "issues", "org-overview", "org-repos", "orgs",
      "rate-limit", "repo-contributors", "repo-overview", "repo-summary", "repos", "run-details", "runs",
      "security-alerts", "team-stats", "workflows",
    ]);
    for (const r of BASE_GITHUB_ROUTES) expect(classify(`/api/github/${r}`)).toBe("base");
  });

  it("every exported handler under src/app/api is classified", async () => {
    const { classify } = await import("@/lib/permissions");
    const missing: string[] = [];
    for (const f of routeFiles()) {
      const path = "/api/" + relative(API_ROOT, dirname(f)).split("\\").join("/").replace(/\[[^\]]+\]/g, "x");
      const methods = [...readFileSync(f, "utf8").matchAll(/^export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/gm)].map((m) => m[1]);
      for (const m of methods) if (classify(path, m) === "unregistered") missing.push(`${m} ${path}`);
    }
    expect(missing).toEqual([]);
  });

  it("the proxy matcher covers every /api path, including ones ending in a file extension", () => {
    const src = readFileSync(join(__dirname, "..", "src", "proxy.ts"), "utf8");
    const raw = /matcher:\s*\[\s*"([^"]+)"/.exec(src)![1].replace(/\\\\/g, "\\");
    const re = new RegExp(`^${raw}$`);
    for (const f of routeFiles()) {
      const path = "/api/" + relative(API_ROOT, dirname(f)).split("\\").join("/");
      expect(re.test(path), path).toBe(true);
    }
    expect(re.test("/api/github/contributor/x.svg")).toBe(true);
    expect(re.test("/logo.png")).toBe(false);
    expect(re.test("/_next/static/chunks/a.js")).toBe(false);
    expect(re.test("/repos/a/b")).toBe(true);
  });
});

// ── decide ───────────────────────────────────────────────────────────────────

describe("decide", () => {
  const dev = { githubId: 2, groups: ["dev" as const], flags: ["dora" as const], isAdmin: false };
  const none = { githubId: 3, groups: [], flags: [], isAdmin: false };
  const admin = { githubId: 1, groups: ["admin" as const], flags: [], isAdmin: true };

  it("enforced", async () => {
    const { decide } = await import("@/lib/permissions");
    expect(decide("base", dev, true)).toEqual({ ok: true });
    expect(decide("flag:dora", dev, true)).toEqual({ ok: true });
    expect(decide("flag:costAnalytics", dev, true)).toEqual({ ok: false, code: "forbidden", flag: "costAnalytics" });
    expect(decide("base", none, true)).toEqual({ ok: false, code: "no_groups" });
    expect(decide("admin", dev, true)).toEqual({ ok: false, code: "forbidden" });
    expect(decide("admin", admin, true)).toEqual({ ok: true });
    expect(decide("unregistered", admin, true)).toEqual({ ok: false, code: "unregistered" });
    expect(decide("auth", none, true)).toEqual({ ok: true });
  });

  it("not enforced: today's behaviour, except admin routes", async () => {
    const { decide } = await import("@/lib/permissions");
    expect(decide("flag:costAnalytics", none, false)).toEqual({ ok: true });
    expect(decide("base", none, false)).toEqual({ ok: true });
    expect(decide("admin", none, false)).toEqual({ ok: false, code: "forbidden" });
    expect(decide("unregistered", none, false)).toEqual({ ok: false, code: "unregistered" });
  });
});

// ── resolveAccess (real SQL) ─────────────────────────────────────────────────

describe("resolveAccess", () => {
  let pg: PGlite;
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("GITDASH_ADMIN_GITHUB_IDS", "1");
    pg = new PGlite();
    const db = await import("@/lib/db");
    db.__setDbClientForTests(createPgliteClient(pg));
    await db.ensureSchema();
    for (const id of [1, 2, 3, 4]) await db.upsertUser({ id, login: `u${id}`, avatar_url: null });
    await pg.query(`INSERT INTO user_groups VALUES (2,'dev'),(2,'security'),(4,'admin')`);
    await pg.query(`INSERT INTO group_flags VALUES ('dev','dora'),('security','securityScan'),('pm','costAnalytics')`);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("unions flags across groups; ungrouped users get nothing", async () => {
    const { resolveAccess } = await import("@/lib/permissions");
    expect(await resolveAccess(2)).toMatchObject({ groups: ["dev", "security"], flags: ["dora", "securityScan"], isAdmin: false });
    expect(await resolveAccess(3)).toMatchObject({ groups: [], flags: [], isAdmin: false });
  });

  it("bootstrap and DB admins get every flag", async () => {
    const { resolveAccess, FLAG_KEYS } = await import("@/lib/permissions");
    for (const id of [1, 4]) {
      const a = await resolveAccess(id);
      expect(a.isAdmin).toBe(true);
      expect(a.flags.length).toBe(FLAG_KEYS.length);
    }
  });

  it("a DB outage reuses the last known answer, else reports unavailable", async () => {
    const { resolveAccess, AuthzUnavailableError } = await import("@/lib/permissions");
    const { __resetCacheForTests } = await import("@/lib/cache");
    const db = await import("@/lib/db");
    await resolveAccess(2); // remember
    __resetCacheForTests();
    const down = () => Promise.reject(new Error("db down"));
    db.__setDbClientForTests(Object.assign(down, { query: down, transaction: down }) as never);
    expect((await resolveAccess(2)).flags).toEqual(["dora", "securityScan"]);
    await expect(resolveAccess(3)).rejects.toBeInstanceOf(AuthzUnavailableError);
  });
});

// ── proxy integration ────────────────────────────────────────────────────────

const whoami = vi.fn();
vi.mock("@/lib/identity", async (orig) => ({
  ...(await orig<typeof import("@/lib/identity")>()),
  whoami: (...a: unknown[]) => whoami(...a),
}));

const PASSWORD = "test-session-secret-at-least-32-chars!!";
async function cookieFor(data: Record<string, unknown>) {
  return `gitdash_session=${await sealData(data, { password: PASSWORD })}`;
}
function req(path: string, opts: { method?: string; cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin) headers.origin = opts.origin;
  return new NextRequest(`http://localhost${path}`, { method: opts.method ?? "GET", headers });
}
const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";

describe("proxy (organization mode)", () => {
  let pg: PGlite;
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("SESSION_SECRET", PASSWORD);
    vi.stubEnv("MODE", "organization");
    vi.stubEnv("DATABASE_URL", "postgres://x@localhost/y");
    vi.stubEnv("GITDASH_ADMIN_GITHUB_IDS", "1");
    vi.stubEnv("GITDASH_ALLOWED_ORGS", "");
    vi.stubEnv("GITDASH_RBAC_ENFORCE", "true");
    whoami.mockReset();
    pg = new PGlite();
    const db = await import("@/lib/db");
    db.__setDbClientForTests(createPgliteClient(pg));
    await db.ensureSchema();
    for (const id of [1, 2, 3]) await db.upsertUser({ id, login: `u${id}`, avatar_url: null });
    await pg.query(`INSERT INTO user_groups VALUES (2,'dev')`);
    await pg.query(`INSERT INTO group_flags VALUES ('dev','dora')`);
  });
  afterEach(() => vi.unstubAllEnvs());

  const as = (id: number) => whoami.mockResolvedValue({ identity: { id, login: `u${id}`, avatar_url: "" }, allowed: true });

  it("no session: API 401, page → /login", async () => {
    const { proxy } = await import("@/proxy");
    expect((await proxy(req("/api/github/repos"))).status).toBe(401);
    expect((await proxy(req("/"))).headers.get("location")).toContain("/login");
  });

  it("dev user: base + granted flag pass; ungranted flag 403 (even via curl)", async () => {
    as(2);
    const { proxy } = await import("@/proxy");
    const cookie = await cookieFor({ pat: "ghp_x" });
    expect(passed(await proxy(req("/api/github/repos", { cookie })))).toBe(true);
    expect(passed(await proxy(req("/api/github/repo-dora", { cookie })))).toBe(true);
    const billing = await proxy(req("/api/github/billing", { cookie }));
    expect(billing.status).toBe(403);
    expect(await billing.json()).toMatchObject({ code: "forbidden", flag: "costAnalytics" });
  });

  it("ungrouped user: API 403 no_groups, page → /pending, /pending itself allowed", async () => {
    as(3);
    const { proxy } = await import("@/proxy");
    const cookie = await cookieFor({ accessToken: "gho_x" });
    const api = await proxy(req("/api/github/repos", { cookie }));
    expect(api.status).toBe(403);
    expect(await api.json()).toMatchObject({ code: "no_groups" });
    expect((await proxy(req("/", { cookie }))).headers.get("location")).toContain("/pending");
    expect(passed(await proxy(req("/pending", { cookie })))).toBe(true);
  });

  it("admin routes need admin; bootstrap admin passes", async () => {
    const { proxy } = await import("@/proxy");
    const cookie = await cookieFor({ pat: "ghp_x" });
    as(2);
    expect((await proxy(req("/api/admin/users", { cookie }))).status).toBe(403);
    as(1);
    expect(passed(await proxy(req("/api/admin/users", { cookie })))).toBe(true);
  });

  it("unregistered API route is denied; cross-origin write is denied", async () => {
    as(1);
    const { proxy } = await import("@/proxy");
    const cookie = await cookieFor({ pat: "ghp_x" });
    expect((await proxy(req("/api/nope", { cookie }))).status).toBe(403);
    const x = await proxy(req("/api/alerts", { method: "POST", cookie, origin: "https://evil.example" }));
    expect(x.status).toBe(403);
    expect(await x.json()).toMatchObject({ code: "cross_origin" });
  });

  it("revoked token (401 from GitHub) clears the session", async () => {
    whoami.mockRejectedValue(Object.assign(new Error("Bad credentials"), { status: 401 }));
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("/api/github/repos", { cookie: await cookieFor({ pat: "ghp_revoked" }) }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/gitdash_session=;/);
  });

  it("database down with nothing remembered → 503 authz_unavailable, never a redirect to /login", async () => {
    as(2);
    const db = await import("@/lib/db");
    const down = () => Promise.reject(new Error("db down"));
    db.__setDbClientForTests(Object.assign(down, { query: down, transaction: down }) as never);
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("/api/github/repos", { cookie: await cookieFor({ pat: "ghp_x" }) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "authz_unavailable" });
  });

  it("enforcement off: the database is not needed except for admin routes", async () => {
    vi.stubEnv("GITDASH_RBAC_ENFORCE", "false");
    as(3);
    const db = await import("@/lib/db");
    const down = () => Promise.reject(new Error("db down"));
    db.__setDbClientForTests(Object.assign(down, { query: down, transaction: down }) as never);
    const { proxy } = await import("@/proxy");
    const cookie = await cookieFor({ pat: "ghp_x" });
    expect(passed(await proxy(req("/api/github/repos", { cookie })))).toBe(true);
    expect((await proxy(req("/api/admin/users", { cookie }))).status).toBe(503);
  });

  it("enforcement off: ungrouped users keep access, admin routes stay protected", async () => {
    vi.stubEnv("GITDASH_RBAC_ENFORCE", "false");
    as(3);
    const { proxy } = await import("@/proxy");
    const cookie = await cookieFor({ pat: "ghp_x" });
    expect(passed(await proxy(req("/api/github/billing", { cookie })))).toBe(true);
    expect(passed(await proxy(req("/", { cookie })))).toBe(true);
    expect((await proxy(req("/api/admin/users", { cookie }))).status).toBe(403);
  });

  it("an account outside the allowed orgs is refused and its cookie cleared, but can still sign out", async () => {
    whoami.mockResolvedValue({ identity: { id: 2, login: "u2" }, allowed: false });
    const { proxy } = await import("@/proxy");
    const cookie = await cookieFor({ pat: "ghp_x" });
    const res = await proxy(req("/", { cookie }));
    expect(res.headers.get("location")).toContain("org_not_allowed");
    expect(res.headers.get("set-cookie") ?? "").toMatch(/gitdash_session=;/);
    expect(passed(await proxy(req("/api/auth/logout", { method: "POST", cookie, origin: "http://localhost" })))).toBe(true);
  });

  it("records a signed-in user who has no users row yet (session from before users were tracked)", async () => {
    as(2);
    await pg.query(`DELETE FROM users WHERE github_id = 2`);
    const { proxy } = await import("@/proxy");
    const waits: Promise<unknown>[] = [];
    await proxy(req("/api/github/repos", { cookie: await cookieFor({ pat: "ghp_x" }) }), { waitUntil: (p: Promise<unknown>) => waits.push(p) } as never);
    await Promise.all(waits);
    const n = Number((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE github_id = 2`)).rows[0].n);
    expect(n).toBe(1);
  });
});

describe("proxy (standalone mode)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("behaves as before: PAT session passes, no permission checks", async () => {
    vi.resetModules();
    whoami.mockClear();
    vi.stubEnv("SESSION_SECRET", PASSWORD);
    vi.stubEnv("MODE", "standalone");
    const { proxy } = await import("@/proxy");
    const cookie = await cookieFor({ pat: "ghp_x" });
    expect(passed(await proxy(req("/api/github/billing", { cookie })))).toBe(true);
    expect((await proxy(req("/"))).headers.get("location")).toContain("/setup");
    expect(whoami).not.toHaveBeenCalled();
  });
});
