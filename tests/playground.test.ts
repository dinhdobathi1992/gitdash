import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import {
  GitHubCallError, SAMPLE_NOW, SAMPLE_REPO, curlFor, describeGitHubError, githubSource, hasSampleResponse,
  requestUrl, sampleSource, validateRepoInput, validateTokenInput, type Exchange, type GitHubRequest, type Source,
} from "@/lib/playground/source";
import { LIVE_LIMITS, METRICS, PRODUCTION_LIMITS, runRecipe, type MetricId } from "@/lib/playground/recipes";
import { formatJson, itemCount, previewValue } from "@/lib/playground/json-preview";
import { calculateBusFactor, commitAuthor, commitFiles } from "@/lib/bus-factor-core";

const TOKEN = "github_pat_TESTTOKEN_DO_NOT_LEAK_123";
const req = (p: string, params: Record<string, string> = {}): GitHubRequest => ({ method: "GET", path: p, params });

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("request formatting", () => {
  it("builds a canonical, sorted query string and a curl that never contains the token", () => {
    const r = req("/repos/acme/app/pulls", { state: "closed", per_page: "60" });
    expect(requestUrl(r)).toBe("https://api.github.com/repos/acme/app/pulls?per_page=60&state=closed");
    expect(requestUrl(req("/repos/acme/app/pulls/1"))).toBe("https://api.github.com/repos/acme/app/pulls/1");
    const curl = curlFor(r);
    expect(curl).toContain("$GITHUB_TOKEN");
    expect(curl).toContain(requestUrl(r));
  });

  it("validates owner and repo names", () => {
    expect(validateRepoInput("acme-labs", "checkout.service_v2")).toBeNull();
    expect(validateRepoInput("-bad", "x")).not.toBeNull();
    expect(validateRepoInput("acme", "../etc")).not.toBeNull();
    expect(validateRepoInput("acme", "..")).not.toBeNull();
    expect(validateRepoInput("acme", "a/b")).not.toBeNull();
  });
});

describe("sampleSource", () => {
  it("serves bundled responses and 404s unknown requests", async () => {
    const src = sampleSource();
    const ok = await src(req(`/repos/${SAMPLE_REPO.owner}/${SAMPLE_REPO.repo}/releases`, { per_page: "30" }));
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body)).toBe(true);
    expect(ok.rateLimit).toBeNull();
    await expect(src(req("/repos/nope/nope/pulls"))).rejects.toBeInstanceOf(GitHubCallError);
  });

  it("sample data is anonymized: example.com emails/avatars, fake org, no github avatars", () => {
    const raw = readFileSync(path.resolve(__dirname, "../src/lib/playground/sample-responses.json"), "utf8");
    const emails = raw.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((e) => e.endsWith("@example.com"))).toBe(true);
    expect(raw).not.toContain("avatars.githubusercontent.com");
  });
});

describe("githubSource (browser → api.github.com)", () => {
  it("sends the token only in the Authorization header to api.github.com, without credentials", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, [{ id: 1 }], { "x-ratelimit-remaining": "4999", "x-ratelimit-limit": "5000" }));
    const ex = await githubSource(`  ${TOKEN} `, fetchMock as unknown as typeof fetch)(req("/repos/a/b/pulls", { state: "open" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/a/b/pulls?state=open");
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.cache).toBe("no-store");
    expect(ex.rateLimit).toEqual({ remaining: "4999", limit: "5000" });
    expect(JSON.stringify(ex)).not.toContain(TOKEN);
  });

  it("rejects an empty or malformed token before any request", () => {
    expect(() => githubSource("   ")).toThrow();
    expect(() => githubSource("ghp_abc def")).toThrow();
    expect(() => githubSource("ghp_abc\u00e9")).toThrow();
    expect(validateTokenInput("github_pat_11ABC_xyz")).toBeNull();
  });

  it.each([
    [401, {}, { message: "Bad credentials" }, /rejected the token/],
    [403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1900000000" }, { message: "API rate limit exceeded" }, /rate limit reached/],
    [403, { "x-ratelimit-remaining": "10" }, { message: "You have exceeded a secondary rate limit" }, /secondary rate limit/],
    [403, { "x-ratelimit-remaining": "10" }, { message: "Resource not accessible by personal access token" }, /refused the request/],
    [404, {}, { message: "Not Found" }, /Not found/],
    [429, {}, {}, /secondary rate limit/],
    [500, {}, { message: "boom" }, /500: boom/],
  ])("maps HTTP %i to a clear error", async (status, headers, body, pattern) => {
    const fetchMock = vi.fn(async () => jsonResponse(status, body, headers));
    const err = await githubSource(TOKEN, fetchMock as unknown as typeof fetch)(req("/repos/a/b/pulls")).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubCallError);
    expect((err as GitHubCallError).message).toMatch(pattern);
    expect((err as GitHubCallError).message).not.toContain(TOKEN);
    expect((err as GitHubCallError).exchange.status).toBe(status);
  });

  it("reports network failures without the token and rethrows aborts", async () => {
    const net = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const err = await githubSource(TOKEN, net as unknown as typeof fetch)(req("/repos/a/b")).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubCallError);
    expect((err as GitHubCallError).exchange.status).toBe(0);
    const abort = vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
    const err2 = await githubSource(TOKEN, abort as unknown as typeof fetch)(req("/repos/a/b")).catch((e) => e);
    expect((err2 as Error).name).toBe("AbortError");
  });

  it("describeGitHubError handles non-object bodies", () => {
    expect(describeGitHubError(502, new Headers(), null)).toBe("GitHub returned 502.");
  });
});

describe("recipes over sample data", () => {
  const ctx = (source: Source = sampleSource()) => ({ source, ...SAMPLE_REPO, now: SAMPLE_NOW, limits: PRODUCTION_LIMITS });

  it.each(METRICS.map((m) => [m.id] as [MetricId]))("%s: every request is in the sample and the result is non-empty", async (id) => {
    const r = await runRecipe(id, ctx());
    expect(r.exchanges.length).toBeGreaterThan(0);
    expect(r.exchanges.every((e) => e.status === 200 && hasSampleResponse(e.request))).toBe(true);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.cooked.flatMap((g) => g.cards).length).toBeGreaterThan(0);
    // Production limits → no request-cap deviations (only the fixed notes about workday / workflow choice).
    expect(r.caveats.join(" ")).not.toMatch(/fetched for|first page|failed/);
  });

  it("cooked bus factor equals the production function on the same raw data", async () => {
    const r = await runRecipe("bus-factor", ctx());
    const listed = r.exchanges[0].body as Parameters<typeof commitAuthor>[0][];
    const details = r.exchanges.slice(1);
    const expected = calculateBusFactor(details.map((ex, i) => ({ author: commitAuthor(listed[i]), files: commitFiles(ex.body as { files?: { filename: string }[] }) })));
    const card = r.cooked[0].cards.find((c) => c.label === "Repository bus factor")!;
    expect(card.value).toBe(String(expected.overall_bus_factor));
  });

  it("the sample exercises every workload flag and both DORA views", async () => {
    const w = await runRecipe("workload-ci", ctx());
    const values = w.cooked[0].cards.map((c) => c.value).join(" ");
    for (const flag of ["after-hours", "weekend", "PR overload", "activity cliff"]) expect(values).toContain(flag);
    const d = await runRecipe("dora", ctx());
    expect(d.cooked.map((g) => g.title)).toEqual(["Repository DORA", "Workflow DORA — Deploy"]);
  });

  it("live limits cap the fan-out and say so", async () => {
    const calls: string[] = [];
    const counting: Source = async (r, s) => { calls.push(r.path); return sampleSource()(r, s); };
    const r = await runRecipe("bus-factor", { ...ctx(counting), limits: LIVE_LIMITS });
    expect(calls.length).toBe(1 + LIVE_LIMITS.busFactorCommitDetail);
    expect(r.caveats.join(" ")).toMatch(/File lists fetched for 20/);
  });

  it("a failed required call surfaces as GitHubCallError with its exchange", async () => {
    const failing: Source = async (r) => {
      const ex: Exchange = { request: r, url: requestUrl(r), status: 404, body: { message: "Not Found" }, rateLimit: null, error: "Not found" };
      throw new GitHubCallError("Not found", ex);
    };
    const err = await runRecipe("pr-health", ctx(failing)).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubCallError);
  });

  it("a 401 during fan-out fails the run instead of cooking partial data", async () => {
    const revoked: Source = async (r, s) => {
      if (/\/reviews$/.test(r.path)) {
        throw new GitHubCallError("bad token", { request: r, url: requestUrl(r), status: 401, body: null, rateLimit: null, error: "bad token" });
      }
      return sampleSource()(r, s);
    };
    const err = await runRecipe("pr-health", ctx(revoked)).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubCallError);
    expect((err as GitHubCallError).exchange.status).toBe(401);
  });

  it("failed fan-out calls are dropped and reported, like production's partial results", async () => {
    const flaky: Source = async (r, s) => {
      if (/\/reviews$/.test(r.path) && r.path.includes("/pulls/40")) {
        throw new GitHubCallError("boom", { request: r, url: requestUrl(r), status: 502, body: null, rateLimit: null, error: "boom" });
      }
      return sampleSource()(r, s);
    };
    const r = await runRecipe("pr-health", ctx(flaky));
    expect(r.caveats.join(" ")).toMatch(/review fetches failed/);
  });
});

describe("json preview", () => {
  it("truncates long arrays and strings, and summarizes deep nesting", () => {
    expect(previewValue([1, 2, 3, 4, 5])).toEqual([1, 2, 3, "… 2 more items"]);
    expect(previewValue("x".repeat(200), { maxString: 10 })).toBe(`${"x".repeat(10)}… (190 more chars)`);
    expect(previewValue({ a: { b: { c: 1 } } }, { maxDepth: 2 })).toEqual({ a: { b: "{…}" } });
    expect(formatJson([1, 2, 3, 4], true)).toContain("4");
    expect(formatJson(undefined)).toBe("null");
  });
  it("counts list items", () => {
    expect(itemCount([1, 2])).toBe(2);
    expect(itemCount({ workflow_runs: [1] })).toBe(1);
    expect(itemCount({ id: 1 })).toBeNull();
  });
});

describe("token handling (static)", () => {
  it("playground code never persists the token or calls GitDash routes", () => {
    const dirs = [path.resolve(__dirname, "../src/lib/playground"), path.resolve(__dirname, "../src/app/docs/playground/_parts")];
    const files = dirs.flatMap((d) => readdirSync(d).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(d, f)));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/localStorage|sessionStorage|document\.cookie|console\.|["'`]\/api\/|"use server"|searchParams|router\.(push|replace)/);
    }
  });
});
