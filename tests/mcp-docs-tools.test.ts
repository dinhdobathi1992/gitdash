import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

/** Public /mcp endpoint: docs tools over Streamable HTTP, no sign-in. */

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
};

/** Docs pages served by the mocked self-fetch: one heading and a body per id. */
const PAGES: Record<string, string> = {
  "/docs/caching": "<h1>Caching &amp; rate limits</h1><p>Every GitHub token has an hourly budget. The rate limit is shared.</p>",
  "/docs/metrics-reliability": "<h1>Reliability Tab</h1><h2>KPI Cards</h2><table><tr><th>Metric</th><th>Meaning</th></tr><tr><td>MTTR</td><td>Average time to restore CI to green.</td></tr></table><h2>Flaky branches</h2><p>Branches whose runs flip between pass and fail.</p>",
  "/docs/metrics-dora": "<h1>DORA 4 Keys</h1><h2>Repo-level DORA</h2><table><tr><th>Metric</th><th>How it is calculated</th></tr><tr><td>Change Failure Rate</td><td>Share of merged PRs that are hotfixes or reverts.</td></tr><tr><td>Time to Restore (MTTR)</td><td>Mean time to merge those fixes.</td></tr></table>",
};

function mockPages(fail = false) {
  return vi.fn(async (url: URL | string) => {
    const path = new URL(String(url)).pathname;
    if (fail) return new Response("down", { status: 503 });
    const body = PAGES[path] ?? `<h1>${path}</h1><p>Generic page text.</p>`;
    return new Response(`<html><body><main><article data-doc-content>${body}</article></main></body></html>`, { status: 200 });
  });
}

async function route() {
  return import("@/app/mcp/route");
}

async function rpc(method: string, params: Record<string, unknown> = {}, ip = "203.0.113.7") {
  const { POST } = await route();
  const name: Record<string, string> = typeof params.name === "string" ? { "mcp-name": params.name } : {};
  const res = await POST(
    new NextRequest("http://localhost/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: META } }),
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        "x-forwarded-for": ip,
        ...name,
      },
    }),
  );
  return { res, json: res.status === 200 ? await res.json() : null };
}

const textOf = (json: { result: { content: { text: string }[] } }) => json.result.content[0].text;

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", mockPages());
});
afterEach(() => vi.unstubAllGlobals());

describe("/mcp — protocol", () => {
  it("server/discover reports the 2026-07-28 revision", async () => {
    const { json } = await rpc("server/discover");
    expect(json.result.supportedVersions).toContain("2026-07-28");
    expect(json.result.capabilities.tools).toBeDefined();
  });

  it("lists exactly the four read-only docs tools", async () => {
    const { json } = await rpc("tools/list");
    const tools = json.result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((t) => t.name).sort()).toEqual(["explain_metric", "get_doc", "list_docs", "search_docs"]);
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  it("sends exactly one CORS origin header and answers preflight", async () => {
    const { res } = await rpc("tools/list");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const { OPTIONS } = await route();
    const pre = OPTIONS();
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("Authorization");
  });
});

describe("/mcp — tools", () => {
  it("get_doc returns the page as markdown; an unknown page is a validation error", async () => {
    const ok = await rpc("tools/call", { name: "get_doc", arguments: { page: "caching" } });
    expect(textOf(ok.json)).toContain("# Caching & rate limits");
    const bad = await rpc("tools/call", { name: "get_doc", arguments: { page: "nope" } });
    expect(bad.json.result.isError).toBe(true);
    expect(textOf(bad.json)).toMatch(/invalid/i);
  });

  it("search_docs ranks the caching page first for 'rate limit'", async () => {
    const { json } = await rpc("tools/call", { name: "search_docs", arguments: { query: "rate limit" } });
    expect(textOf(json).split("\n")[0]).toContain("(id: caching)");
  });

  it("explain_metric returns every definition row for MTTR, from each page", async () => {
    const { json } = await rpc("tools/call", { name: "explain_metric", arguments: { metric: "time to recovery" } });
    const out = textOf(json);
    expect(out).toContain("| Time to Restore (MTTR) | Mean time to merge those fixes. |");
    expect(out).toContain("| MTTR | Average time to restore CI to green. |");
    expect(out).toContain('get_doc("metrics-dora")');
    expect(out).toContain('get_doc("metrics-reliability")');
    expect(out).not.toContain("Change Failure Rate |");
  });

  it("explain_metric resolves CFR to the change failure rate row only", async () => {
    const { json } = await rpc("tools/call", { name: "explain_metric", arguments: { metric: "CFR" } });
    expect(textOf(json)).toContain("Share of merged PRs that are hotfixes or reverts.");
    expect(textOf(json)).not.toContain("MTTR");
  });

  it("explain_metric falls back to a section headed by the metric", async () => {
    const { json } = await rpc("tools/call", { name: "explain_metric", arguments: { metric: "flaky" } });
    expect(textOf(json)).toContain("## Flaky branches");
    expect(textOf(json)).toContain("flip between pass and fail");
  });

  it("explain_metric reports no match as a tool error", async () => {
    const { json } = await rpc("tools/call", { name: "explain_metric", arguments: { metric: "zzqq" } });
    expect(json.result.isError).toBe(true);
  });

  it("when every page fails, search still answers from titles and does not cache a partial index", async () => {
    const failing = mockPages(true);
    vi.stubGlobal("fetch", failing);
    const first = await rpc("tools/call", { name: "search_docs", arguments: { query: "caching" } });
    expect(textOf(first.json)).toContain("(id: caching)");
    const callsAfterFirst = failing.mock.calls.length;
    await rpc("tools/call", { name: "search_docs", arguments: { query: "caching" } });
    // Within the retry window the bodies are not refetched, and nothing was cached as complete.
    expect(failing.mock.calls.length).toBe(callsAfterFirst);
    const { json } = await rpc("tools/call", { name: "get_doc", arguments: { page: "caching" } });
    expect(json.result.isError).toBe(true);
  });
});

describe("/mcp — robustness", () => {
  it("does not refetch a failing page within a minute", async () => {
    const failing = mockPages(true);
    vi.stubGlobal("fetch", failing);
    await rpc("tools/call", { name: "get_doc", arguments: { page: "caching" } });
    await rpc("tools/call", { name: "get_doc", arguments: { page: "caching" } });
    await rpc("tools/call", { name: "explain_metric", arguments: { metric: "MTTR" } });
    await rpc("tools/call", { name: "explain_metric", arguments: { metric: "MTTR" } });
    // The explain calls fetch each metric page at most once; caching is never refetched.
    expect(failing.mock.calls.filter(([u]) => String(u).endsWith("/docs/caching")).length).toBe(1);
    const metricFetches = failing.mock.calls.filter(([u]) => String(u).includes("/docs/metrics-")).length;
    expect(metricFetches).toBeLessThanOrEqual(8);
  });

  it("keeps one handler however many Host headers a client sends", async () => {
    const { POST } = await route();
    for (let i = 0; i < 30; i++) {
      await POST(new NextRequest(`http://evil${i}.example/mcp`, { method: "POST", body: "{}", headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${i}` } }));
    }
    const server = await import("@/lib/mcp/server");
    expect(server.__handlerCountForTests()).toBe(1);
  });

  it("answers DELETE with a CORS-readable 405", async () => {
    const { DELETE } = await route();
    const res = await DELETE(new NextRequest("http://localhost/mcp", { method: "DELETE", headers: { "x-forwarded-for": "192.0.2.200" } }));
    expect(res.status).toBe(405);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("/mcp — limits and access", () => {
  it("rate-limits one IP after 300 requests a minute", async () => {
    const { POST } = await route();
    const req = () =>
      POST(new NextRequest("http://localhost/mcp", { method: "POST", body: "{}", headers: { "x-forwarded-for": "198.51.100.9", "content-type": "application/json" } }));
    for (let i = 0; i < 300; i++) await req();
    const res = await req();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("is reachable signed out in organization mode", async () => {
    vi.stubEnv("MODE", "organization");
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("GITDASH_ADMIN_GITHUB_IDS", "1");
    vi.stubEnv("GITDASH_ALLOWED_ORGS", "acme");
    const res = await proxy(new NextRequest("http://localhost/mcp", { method: "POST" }));
    expect(res.headers.get("location")).toBeNull();
    vi.unstubAllEnvs();
  });
});
