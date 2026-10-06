/**
 * Signed-in MCP endpoint /mcp/me: bearer handling, per-call authorization
 * (identity, organization, RBAC) and the data tools. PGlite database; GitHub
 * is mocked at the identity and loader-source layers.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { NextRequest } from "next/server";
import { sealData } from "iron-session";
import { PGlite } from "@electric-sql/pglite";
import { createPgliteClient } from "./setup/pglite";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "d".repeat(24) + "-secret-for-mcp-data-tests";
  delete process.env.MCP_PREVIOUS_SESSION_SECRET;
});

const GH = "gho_FAKEtokenForDataToolTests0123456789";
const whoami = vi.hoisted(() => vi.fn());
vi.mock("@/lib/identity", async (orig) => ({
  ...(await orig<typeof import("@/lib/identity")>()),
  whoami,
  lookupWhoAmI: whoami,
}));
const github = vi.hoisted(() => ({ listRepos: vi.fn(), getRepoSummary: vi.fn(), getRepoOverview: vi.fn() }));
vi.mock("@/lib/github", async (orig) => ({ ...(await orig<typeof import("@/lib/github")>()), ...github }));
const dora = vi.hoisted(() => ({ getRepoDoraSummary: vi.fn() }));
vi.mock("@/lib/github-dora", () => dora);
vi.mock("@/lib/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/session")>()),
  getTokenFromSession: async () => "gho_FAKEtokenForDataToolTests0123456789",
}));

import { __setDbClientForTests, ensureSchema, type DbClient } from "@/lib/db";
import { __resetCacheForTests } from "@/lib/cache";
import { __resetAccessForTests } from "@/lib/permissions";
import { __resetRecordSeenForTests } from "@/lib/record-seen";
import { sessionOptions } from "@/lib/session";
import { __clearGrantCacheForTests, createGrant, redeemGrant } from "@/lib/mcp/oauth/grants";
import { seal } from "@/lib/mcp/oauth/tokens";
import { POST as mePOST, OPTIONS as meOPTIONS } from "@/app/mcp/me/route";
import { GET as webRepoDora } from "@/app/api/github/repo-dora/route";
import { LIST_REPOS_RUN_DATA_MAX } from "@/lib/mcp/data-tools";

const ORIGIN = "https://gitdash.test";
const RESOURCE = `${ORIGIN}/mcp/me`;
const PRM = `${ORIGIN}/.well-known/oauth-protected-resource/mcp/me`;
const CLIENT = "https://client.example.com/oauth/metadata.json";
const USER = { id: 4242, login: "octo", name: null, avatar_url: "https://avatars.example/u", email: null };

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const level = (l: string) => ({ level: l, label: l });
const DORA = {
  deployment_frequency: { per_day: 1.25, total: 30, period_days: 24, ...level("elite") },
  lead_time: { median_ms: 7_200_000, p95_ms: 36_000_000, sample_size: 30, ...level("high") },
  change_failure_rate: { rate: 6.7, failures: 2, total: 30, ...level("high") },
  mttr: { mean_ms: 3_600_000, recoveries: 2, ...level("elite") },
  overall_level: "high",
  cycle_breakdown: { avg_time_to_open_ms: 0, avg_pickup_ms: 0, avg_review_ms: 0, avg_merge_ms: 0, sample_size: 0 },
  pr_scatter: [],
  throughput_by_week: [],
  prs_analysed: 30,
  releases_analysed: 0,
  partial: false,
  fetched_prs: 30,
  total_prs_attempted: 30,
};

const repo = (i: number) => ({
  id: i,
  owner: "acme",
  name: `r${i}`,
  full_name: `acme/r${i}`,
  description: null,
  private: i % 2 === 0,
  html_url: `https://github.com/acme/r${i}`,
  updated_at: new Date(Date.now() - i * 60_000).toISOString(),
  language: "TypeScript",
  stargazers_count: 0,
});

const failingSummary = () => ({
  latest_conclusion: "failure",
  latest_status: "completed",
  latest_run_at: new Date().toISOString(),
  latest_actor: "octo",
  latest_sha: "abc",
  latest_message: "boom",
  latest_branch: "main",
  recent_runs: [{ id: 1, conclusion: "failure", status: "completed", created_at: new Date().toISOString() }],
  trend_30d: [],
  success_rate: 40,
});

// ── Requests ─────────────────────────────────────────────────────────────────

let ipN = 0;

async function rpc(method: string, params: Record<string, unknown>, token: string | null, headers: Record<string, string> = {}) {
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
        "x-forwarded-for": `203.0.113.${(ipN++ % 250) + 1}`,
        ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
        ...name,
        ...headers,
      },
    }),
  );
  return { res, json: res.status === 200 ? await res.json() : null };
}

type ToolResult = { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };
const outputs: string[] = [];

async function call(name: string, args: Record<string, unknown>, token: string): Promise<ToolResult> {
  const { res, json } = await rpc("tools/call", { name, arguments: args }, token);
  expect(res.status).toBe(200);
  const result = json.result as ToolResult;
  outputs.push(JSON.stringify(result));
  return result;
}

async function mint(over: Record<string, unknown> = {}, ttl = 3600) {
  const g = await createGrant({ github_id: USER.id, client_id: CLIENT, client_name: "Test", redirect_host: "app.example.com" });
  expect(await redeemGrant(g.grant_id, g.current_refresh)).toBe(true);
  const token = await seal(
    "mcp.access",
    { grant_id: g.grant_id, client_id: CLIENT, aud: RESOURCE, scope: "gitdash:read", gh: GH, id: USER.id, login: USER.login, ...over },
    ttl,
  );
  return { token, grantId: g.grant_id, refreshJti: g.current_refresh };
}

// ── Database ─────────────────────────────────────────────────────────────────

let pg: PGlite;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as Record<string, unknown>[];
const revokedReason = async (grantId: string) => (await q(`SELECT revoked_reason FROM mcp_grants WHERE grant_id = $1`, [grantId]))[0]?.revoked_reason;

async function grantGroup(flags: string[], group = "dev") {
  await q(`INSERT INTO users (github_id, login) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [USER.id, USER.login]);
  await q(`INSERT INTO user_groups VALUES ($1, $2)`, [USER.id, group]);
  for (const f of flags) await q(`INSERT INTO group_flags VALUES ($1, $2)`, [group, f]);
}

const down = (() => {
  const fail = () => Promise.reject(new Error("database down"));
  return Object.assign(fail, { query: fail, transaction: fail }) as unknown as DbClient;
})();

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

beforeEach(async () => {
  __setDbClientForTests(createPgliteClient(pg));
  await ensureSchema();
  for (const t of ["mcp_grants", "permission_audit", "user_groups", "group_flags", "users"]) await q(`DELETE FROM ${t}`);
  __clearGrantCacheForTests();
  __resetCacheForTests();
  __resetAccessForTests();
  __resetRecordSeenForTests();
  vi.stubEnv("MODE", "organization");
  vi.stubEnv("GITDASH_MCP", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  vi.stubEnv("GITDASH_ADMIN_GITHUB_IDS", "1");
  vi.stubEnv("GITDASH_RBAC_ENFORCE", "");
  vi.stubEnv("DATABASE_URL", ""); // keeps the shared (L2) cache off; the injected client is used directly
  whoami.mockReset();
  whoami.mockResolvedValue({ identity: USER, allowed: true });
  for (const fn of [...Object.values(github), ...Object.values(dora)]) fn.mockReset();
  dora.getRepoDoraSummary.mockResolvedValue(DORA);
  outputs.length = 0;
  spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(() => {
  // Neither logs nor tool outputs may carry the GitHub token or a sealed token.
  const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" ")));
  for (const text of [...logged, ...outputs]) {
    expect(text).not.toContain(GH);
    expect(text).not.toContain("Fe26.");
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// ── Bearer handling ──────────────────────────────────────────────────────────

describe("/mcp/me bearer handling", () => {
  it("no bearer: 401 pointing at the explicit metadata URL, even with a spoofed X-Forwarded-Host", async () => {
    const variants: Record<string, string>[] = [{}, { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" }];
    for (const headers of variants) {
      const { res } = await rpc("tools/list", {}, null, headers);
      expect(res.status).toBe(401);
      const www = res.headers.get("www-authenticate")!;
      expect(www).toContain(`resource_metadata="${PRM}"`);
      expect(www).toContain('scope="gitdash:read"');
      expect(www).not.toContain("invalid_token");
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("a valid token lists the four docs tools and the seven read-only data tools", async () => {
    const { token } = await mint();
    const { json } = await rpc("tools/list", {}, token);
    const tools = json.result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "actions_cost", "explain_metric", "failing_workflows", "get_doc", "list_docs", "list_repos",
      "open_pr_health", "org_health", "repo_dora", "repo_overview", "search_docs",
    ]);
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  const expectInvalid = async (token: string) => {
    const { res } = await rpc("tools/list", {}, token);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  };

  it("expired beyond the 5 s tolerance is invalid_token; within it is accepted", async () => {
    const { token } = await mint({}, 1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 4_000);
    expect((await rpc("tools/list", {}, token)).res.status).toBe(200);
    vi.setSystemTime(Date.now() + 3_000);
    await expectInvalid(token);
  });

  it("wrong audience is invalid; a trailing-slash variant of ours is accepted", async () => {
    await expectInvalid((await mint({ aud: "https://other.example/mcp/me" })).token);
    await expectInvalid((await mint({ aud: `${ORIGIN}/mcp` })).token);
    expect((await rpc("tools/list", {}, (await mint({ aud: `${RESOURCE}/` })).token)).res.status).toBe(200);
  });

  it("wrong token type, a revoked grant, a session-cookie blob, a tampered token and a non-Bearer header are invalid", async () => {
    const m = await mint();
    const refresh = await seal("mcp.refresh", { jti: m.refreshJti, grant_id: m.grantId, client_id: CLIENT, aud: RESOURCE, gh: GH, id: USER.id, login: USER.login }, 600);
    await expectInvalid(refresh);
    const cookie = await sealData({ accessToken: GH }, { password: sessionOptions.password as string });
    await expectInvalid(cookie);
    await expectInvalid(m.token.slice(0, -3) + "abc");
    const basic = await rpc("tools/list", {}, null, { authorization: `Basic ${Buffer.from("a:b").toString("base64")}` });
    expect(basic.res.status).toBe(401);
    await q(`UPDATE mcp_grants SET revoked_at = NOW(), revoked_reason = 'user_revoked' WHERE grant_id = $1`, [m.grantId]);
    __clearGrantCacheForTests();
    await expectInvalid(m.token);
  });

  it("the database down while checking the grant is 503, not 401", async () => {
    const { token } = await mint();
    __setDbClientForTests(down);
    __clearGrantCacheForTests();
    const { res } = await rpc("tools/list", {}, token);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
  });

  it("limits a grant to 60 requests a minute", async () => {
    const { token } = await mint();
    for (let i = 0; i < 60; i++) expect((await rpc("tools/list", {}, token)).res.status).toBe(200);
    expect((await rpc("tools/list", {}, token)).res.status).toBe(429);
  });

  it("answers CORS preflight", () => {
    const pre = meOPTIONS(new NextRequest(`${RESOURCE}`, { method: "OPTIONS" }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
  });
});

// ── Identity and access ──────────────────────────────────────────────────────

describe("per-call authorization", () => {
  it("GitHub 401: tool error, grant revoked, and the next request gets HTTP 401", async () => {
    const { token, grantId } = await mint();
    whoami.mockRejectedValueOnce(Object.assign(new Error("Bad credentials"), { status: 401 }));
    const r = await call("repo_dora", { owner: "acme", repo: "web" }, token);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/GitHub authorization was revoked/);
    expect(await revokedReason(grantId)).toBe("github_revoked");
    expect((await rpc("tools/list", {}, token)).res.status).toBe(401);
    expect(dora.getRepoDoraSummary).not.toHaveBeenCalled();
  });

  it("a user outside the allowed organizations: tool error naming the rule, grant revoked", async () => {
    const { token, grantId } = await mint();
    whoami.mockResolvedValue({ identity: USER, allowed: false });
    const r = await call("list_repos", {}, token);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/GITDASH_ALLOWED_ORGS/);
    expect(await revokedReason(grantId)).toBe("org_removed");
  });

  it("GitHub unreachable with no recent answer: tool error, never fails open", async () => {
    const { token, grantId } = await mint();
    whoami.mockRejectedValue(new Error("ECONNRESET"));
    const r = await call("repo_dora", { owner: "acme", repo: "web" }, token);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/can't check your access/);
    expect(await revokedReason(grantId)).toBeNull();
  });

  it("RBAC enforced without costAnalytics: actions_cost names the flag; repo_dora follows dora", async () => {
    vi.stubEnv("GITDASH_RBAC_ENFORCE", "true");
    await grantGroup(["dora"]);
    const { token } = await mint();
    const cost = await call("actions_cost", { org: "acme" }, token);
    expect(cost.isError).toBe(true);
    expect(cost.content[0].text).toContain('"costAnalytics"');
    const ok = await call("repo_dora", { owner: "acme", repo: "web" }, token);
    expect(ok.isError).toBeFalsy();
  });

  it("RBAC enforced without dora: repo_dora is forbidden and names the flag", async () => {
    vi.stubEnv("GITDASH_RBAC_ENFORCE", "true");
    await grantGroup([]);
    const { token } = await mint();
    const r = await call("repo_dora", { owner: "acme", repo: "web" }, token);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('"dora"');
    expect(dora.getRepoDoraSummary).not.toHaveBeenCalled();
  });

  it("RBAC enforced and no group: no_groups tool error", async () => {
    vi.stubEnv("GITDASH_RBAC_ENFORCE", "true");
    const { token } = await mint();
    const r = await call("list_repos", {}, token);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/no GitDash group/);
  });

  it("records the user as seen after an allowed call", async () => {
    const { token } = await mint();
    github.listRepos.mockResolvedValue([]);
    await call("list_repos", {}, token);
    await vi.waitFor(async () => expect(await q(`SELECT login FROM users WHERE github_id = $1`, [USER.id])).toEqual([{ login: "octo" }]));
  });
});

// ── Tools ────────────────────────────────────────────────────────────────────

describe("data tools", () => {
  it("repo_dora matches GET /api/github/repo-dora for the same token, through the same cache entry", async () => {
    const { token } = await mint();
    const r = await call("repo_dora", { owner: "acme", repo: "web" }, token);
    expect(r.isError).toBeFalsy();
    const web = await (await webRepoDora(new NextRequest(`${ORIGIN}/api/github/repo-dora?owner=acme&repo=web`))).json();
    expect(dora.getRepoDoraSummary).toHaveBeenCalledTimes(1); // the web route was served from the tool's cache entry
    const s = r.structuredContent as Record<string, Record<string, unknown>>;
    expect(s.deployment_frequency.per_day).toBe(web.deployment_frequency.per_day);
    expect(s.lead_time.median_ms).toBe(web.lead_time.median_ms);
    expect(s.change_failure_rate.rate_pct).toBe(web.change_failure_rate.rate);
    expect(s.mttr.mean_ms).toBe(web.mttr.mean_ms);
    expect(s.overall_level).toBe(web.overall_level);
    expect(r.content[0].text).toMatch(/1\.25 per day/);
    expect(r.content[0].text).toMatch(/Merged pull requests per day/);
  });

  it("failing_workflows checks at most 25 of 40 repos and says so", async () => {
    const { token } = await mint();
    github.listRepos.mockResolvedValue(Array.from({ length: 40 }, (_, i) => repo(i)));
    github.getRepoSummary.mockImplementation(async () => failingSummary());
    const r = await call("failing_workflows", {}, token);
    expect(github.getRepoSummary.mock.calls.length).toBeLessThanOrEqual(25);
    expect(r.structuredContent).toMatchObject({ checked: 25, total: 40 });
    expect(r.content[0].text).toMatch(/Checked 25 of 40/);
  });

  it("list_repos bounds its run-data fan-out", async () => {
    const { token } = await mint();
    github.listRepos.mockResolvedValue(Array.from({ length: 40 }, (_, i) => repo(i)));
    github.getRepoSummary.mockImplementation(async () => failingSummary());
    const r = await call("list_repos", { owner: "acme" }, token);
    expect(github.getRepoSummary).toHaveBeenCalledTimes(LIST_REPOS_RUN_DATA_MAX);
    expect(r.structuredContent).toMatchObject({ total: 40, shown: 40, with_run_data: LIST_REPOS_RUN_DATA_MAX });
    const repos = (r.structuredContent as { repos: { visibility: string; success_rate_pct: number | null }[] }).repos;
    expect(repos[0]).toMatchObject({ visibility: "private", success_rate_pct: 40 });
    expect(repos[39].success_rate_pct).toBeNull();
  });

  it("invalid input is rejected before any GitHub call", async () => {
    const { token } = await mint();
    const r = await call("repo_dora", { owner: "bad owner!", repo: "web" }, token);
    expect(r.isError).toBe(true);
    expect(dora.getRepoDoraSummary).not.toHaveBeenCalled();
  });

  it("an unexpected GitHub failure is a fixed tool error with no exception text", async () => {
    const { token } = await mint();
    dora.getRepoDoraSummary.mockRejectedValue(Object.assign(new Error(`upstream said ${GH}`), { status: 502 }));
    const r = await call("repo_dora", { owner: "acme", repo: "web" }, token);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("GitHub data could not be loaded right now; try again shortly.");
  });

  it("a GitHub 401 from a loader revokes the grant", async () => {
    const { token, grantId } = await mint();
    dora.getRepoDoraSummary.mockRejectedValue(Object.assign(new Error("Bad credentials"), { status: 401 }));
    const r = await call("repo_dora", { owner: "acme", repo: "web" }, token);
    expect(r.content[0].text).toMatch(/revoked/);
    expect(await revokedReason(grantId)).toBe("github_revoked");
  });
});
