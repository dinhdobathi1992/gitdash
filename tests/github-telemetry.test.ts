import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  recordGitHubCall,
  labelGitHubRoute,
  currentGitHubRoute,
  __resetGitHubTelemetryForTests,
} from "@/lib/github-telemetry";

const LOW = { "x-ratelimit-remaining": "100", "x-ratelimit-limit": "5000", "x-ratelimit-reset": "1790000000" };
const HEALTHY = { "x-ratelimit-remaining": "4900", "x-ratelimit-limit": "5000", "x-ratelimit-reset": "1790000000" };

let warn: ReturnType<typeof vi.spyOn>;
let info: ReturnType<typeof vi.spyOn>;

/** Parsed JSON payloads of the "[gh]" per-call log lines. */
const logged = (): Array<{ route: string; method: string; status: number }> =>
  (info.mock.calls as unknown[][]).map((c) => JSON.parse(String(c[1])));

beforeEach(() => {
  __resetGitHubTelemetryForTests();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  delete process.env.GITDASH_GH_LOG;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.GITDASH_GH_LOG;
});

describe("recordGitHubCall", () => {
  it("warns once per token per rate-limit window when budget < 10%", () => {
    recordGitHubCall("tok1", "GET", "https://api.github.com/user", 200, LOW);
    recordGitHubCall("tok1", "GET", "https://api.github.com/user", 200, LOW);
    expect(warn).toHaveBeenCalledTimes(1);
    // New window (different reset) warns again.
    recordGitHubCall("tok1", "GET", "https://api.github.com/user", 200, { ...LOW, "x-ratelimit-reset": "1790003600" });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("dedupes per resource: core and search warn independently", () => {
    recordGitHubCall("tok1", "GET", "u", 200, { ...LOW, "x-ratelimit-resource": "core" });
    recordGitHubCall("tok1", "GET", "u", 200, { ...LOW, "x-ratelimit-resource": "search" });
    recordGitHubCall("tok1", "GET", "u", 200, { ...LOW, "x-ratelimit-resource": "core" });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("a missing reset header does not cause a warning on every call", () => {
    const noReset = { "x-ratelimit-remaining": "10", "x-ratelimit-limit": "5000" };
    recordGitHubCall("tok2", "GET", "u", 200, noReset);
    recordGitHubCall("tok2", "GET", "u", 200, noReset);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn on a healthy budget or missing headers", () => {
    recordGitHubCall("tok1", "GET", "https://api.github.com/user", 200, HEALTHY);
    recordGitHubCall("tok1", "GET", "https://api.github.com/user", 500, undefined);
    expect(warn).not.toHaveBeenCalled();
  });

  it("per-call log only with GITDASH_GH_LOG=1, and never includes the query string", () => {
    recordGitHubCall("tok1", "GET", "https://api.github.com/repos/o/r/actions/runs?per_page=100", 200, HEALTHY);
    expect(info).not.toHaveBeenCalled();
    process.env.GITDASH_GH_LOG = "1";
    recordGitHubCall("tok1", "GET", "https://api.github.com/repos/o/r/actions/runs?per_page=100", 200, HEALTHY);
    const line = String((info.mock.calls as unknown[][])[0][1]);
    expect(line).toContain('"path":"/repos/o/r/actions/runs"');
    expect(line).not.toContain("per_page");
  });
});

describe("route label", () => {
  it("keeps concurrent requests' labels separate", async () => {
    const { AsyncLocalStorage } = await import("async_hooks");
    const request = new AsyncLocalStorage<number>(); // stands in for Next's per-request context
    const handler = (label: string) =>
      request.run(0, async () => {
        labelGitHubRoute(label);
        await new Promise((r) => setTimeout(r, 5));
        return currentGitHubRoute();
      });
    const [a, b] = await Promise.all([handler("github/repos"), handler("github/runs")]);
    expect([a, b]).toEqual(["github/repos", "github/runs"]);
  });
});

describe("Octokit hook integration", () => {
  function stubFetch(status: number, headers: Record<string, string>, body: unknown = {}) {
    const fetchMock = vi.fn(async () =>
      new Response(status === 304 ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("records GET and write requests with their route label", async () => {
    process.env.GITDASH_GH_LOG = "1";
    vi.resetModules();
    const { getOctokit } = await import("@/lib/github");
    const telemetry = await import("@/lib/github-telemetry");
    stubFetch(200, HEALTHY, { login: "octocat" });
    const octokit = getOctokit("token-telemetry-a");

    await (async () => {
      telemetry.labelGitHubRoute("github/create-issue");
      await octokit.request("GET /user");
      stubFetch(201, HEALTHY, { number: 1 });
      await octokit.request("POST /repos/{owner}/{repo}/issues", { owner: "o", repo: "r", title: "t" });
    })();

    const lines = logged();
    expect(lines.map((l) => [l.route, l.method, l.status])).toEqual([
      ["github/create-issue", "GET", 200],
      ["github/create-issue", "POST", 201],
    ]);
    expect(JSON.stringify(lines)).not.toContain("token-telemetry-a");
  });

  it("records the real 304 status even though the ETag layer replays cached data", async () => {
    process.env.GITDASH_GH_LOG = "1";
    vi.resetModules();
    const { getOctokit } = await import("@/lib/github");
    const octokit = getOctokit("token-telemetry-b");

    stubFetch(200, { ...HEALTHY, etag: 'W/"abc"' }, { login: "octocat" });
    await octokit.request("GET /user");
    stubFetch(304, { ...HEALTHY, etag: 'W/"abc"' });
    const replay = await octokit.request("GET /user");

    expect(replay.data).toEqual({ login: "octocat" });
    const statuses = logged().map((l) => l.status);
    expect(statuses).toEqual([200, 304]);
  });

  it("records failed requests and rethrows", async () => {
    process.env.GITDASH_GH_LOG = "1";
    vi.resetModules();
    const { getOctokit } = await import("@/lib/github");
    const octokit = getOctokit("token-telemetry-c");
    stubFetch(404, HEALTHY, { message: "Not Found" });
    await expect(octokit.request("GET /repos/{owner}/{repo}", { owner: "o", repo: "missing" })).rejects.toThrow();
    const statuses = logged().map((l) => l.status);
    expect(statuses).toContain(404);
  });
});
