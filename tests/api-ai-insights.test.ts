import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Follows the route-handler pattern established in tests/api-ai-status.test.ts.
 * The cache is real (in-process, cheap) so cache-hit behaviour is exercised
 * end-to-end; only the session, provider and snapshot layers are mocked.
 */

const getTokenFromSession = vi.fn();
const aiEnabled = vi.fn();
const generateJson = vi.fn();
const buildInsightsSnapshot = vi.fn();

vi.mock("@/lib/session", () => ({
  getTokenFromSession: () => getTokenFromSession(),
}));
vi.mock("@/lib/ai", () => ({
  aiEnabled: () => aiEnabled(),
  generateJson: (...a: unknown[]) => generateJson(...a),
}));
vi.mock("@/lib/ai-snapshots", () => ({
  buildInsightsSnapshot: (...a: unknown[]) => buildInsightsSnapshot(...a),
}));

const GOOD_CONTENT = JSON.stringify({
  summary: "Delivery is steady.",
  bullets: ["CFR is 12%"],
  actions: ["Raise the bus factor on src/app"],
});

function okProvider(content = GOOD_CONTENT) {
  return { ok: true, provider: "gemini", model: "gemini-2.5-flash", content };
}

/** Unique scope per test keeps the shared in-process cache from bleeding across cases. */
let seq = 0;
function reqFor(params: string): NextRequest {
  return new NextRequest(`https://x.test/api/ai/insights?${params}`);
}
function uniqueRepoReq(): NextRequest {
  seq++;
  return reqFor(`owner=o${seq}&repo=r${seq}`);
}

beforeEach(async () => {
  // A distinct token per test: aiRateLimit() keys on the token hash and the
  // limiter is module-level state, so a shared token would leak consumed
  // slots between tests and eventually 429 an unrelated case.
  seq++;
  getTokenFromSession.mockReset().mockResolvedValue(`tok-${seq}`);
  aiEnabled.mockReset().mockReturnValue(true);
  generateJson.mockReset().mockResolvedValue(okProvider());
  // A distinct snapshot per test — the cache key is fingerprinted on it.
  buildInsightsSnapshot.mockReset().mockImplementation(async () => ({
    surface: "repo",
    scope: `o${seq}/r${seq}`,
    partial: false,
  }));
  const { cacheDeleteByPrefix } = await import("@/lib/cache");
  cacheDeleteByPrefix("ai:insights:");
});

describe("GET /api/ai/insights — auth and gating", () => {
  it("returns 401 without a session", async () => {
    getTokenFromSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/ai/insights/route");
    const res = await GET(uniqueRepoReq());
    expect(res.status).toBe(401);
  });

  it("returns 503 when the AI layer is unconfigured, without building a snapshot", async () => {
    aiEnabled.mockReturnValue(false);
    const { GET } = await import("@/app/api/ai/insights/route");
    const res = await GET(uniqueRepoReq());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: "AI features are not configured",
    });
    expect(buildInsightsSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a missing owner/repo with a validation error", async () => {
    const { GET } = await import("@/app/api/ai/insights/route");
    const res = await GET(reqFor(""));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid org name", async () => {
    const { GET } = await import("@/app/api/ai/insights/route");
    const res = await GET(reqFor("org=" + encodeURIComponent("../etc/passwd")));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/ai/insights — success path", () => {
  it("returns the validated content with provider attribution", async () => {
    const { GET } = await import("@/app/api/ai/insights/route");
    const res = await GET(uniqueRepoReq());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("gemini");
    expect(body.model).toBe("gemini-2.5-flash");
    expect(body.cached).toBe(false);
    expect(body.content).toEqual({
      summary: "Delivery is steady.",
      bullets: ["CFR is 12%"],
      actions: ["Raise the bus factor on src/app"],
    });
  });

  it("marks the response private so a shared cache cannot serve it across users", async () => {
    const { GET } = await import("@/app/api/ai/insights/route");
    const res = await GET(uniqueRepoReq());
    expect(res.headers.get("Cache-Control")).toContain("private");
  });

  it("routes an org param to the org surface", async () => {
    buildInsightsSnapshot.mockResolvedValue({ surface: "org", scope: "acme", partial: false });
    const { GET } = await import("@/app/api/ai/insights/route");
    await GET(reqFor("org=acme"));

    expect(buildInsightsSnapshot).toHaveBeenCalledWith(`tok-${seq}`, {
      surface: "org",
      org: "acme",
    });
  });

  it("propagates the snapshot's partial flag to the client", async () => {
    seq++;
    buildInsightsSnapshot.mockResolvedValue({ surface: "repo", scope: "p/q", partial: true });
    const { GET } = await import("@/app/api/ai/insights/route");
    const body = await (await GET(reqFor("owner=p&repo=q"))).json();
    expect(body.partial).toBe(true);
  });

  it("serves the second identical request from cache without a second provider call", async () => {
    const { GET } = await import("@/app/api/ai/insights/route");
    const req = uniqueRepoReq();

    const first = await (await GET(req)).json();
    expect(first.cached).toBe(false);

    const second = await (await GET(req)).json();
    expect(second.cached).toBe(true);
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it("refresh=1 bypasses the cache and calls the provider again", async () => {
    const { GET } = await import("@/app/api/ai/insights/route");
    seq++;
    await GET(reqFor(`owner=o${seq}&repo=r${seq}`));
    await GET(reqFor(`owner=o${seq}&repo=r${seq}&refresh=1`));
    expect(generateJson).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/ai/insights — failure handling", () => {
  it("maps a provider error to 503", async () => {
    generateJson.mockResolvedValue({ ok: false, reason: "provider_error", error: "boom" });
    const { GET } = await import("@/app/api/ai/insights/route");
    const res = await GET(uniqueRepoReq());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "AI insights unavailable" });
  });

  it("maps an exhausted token budget to 429 with Retry-After", async () => {
    generateJson.mockResolvedValue({ ok: false, reason: "budget_exceeded", error: "spent" });
    const { GET } = await import("@/app/api/ai/insights/route");
    const res = await GET(uniqueRepoReq());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("never leaks the provider's raw error text to the client", async () => {
    generateJson.mockResolvedValue({
      ok: false,
      reason: "provider_error",
      error: "gemini returned HTTP 401 for key sk-secret",
    });
    const { GET } = await import("@/app/api/ai/insights/route");
    const body = await (await GET(uniqueRepoReq())).json();
    expect(JSON.stringify(body)).not.toContain("sk-secret");
  });

  it("retries once when the model returns unparseable JSON", async () => {
    generateJson
      .mockResolvedValueOnce(okProvider("not json at all"))
      .mockResolvedValueOnce(okProvider());

    const { GET } = await import("@/app/api/ai/insights/route");
    const res = await GET(uniqueRepoReq());

    expect(res.status).toBe(200);
    expect(generateJson).toHaveBeenCalledTimes(2);
  });

  it("returns 503 when both attempts return unparseable JSON", async () => {
    generateJson.mockResolvedValue(okProvider("still not json"));
    const { GET } = await import("@/app/api/ai/insights/route");
    const res = await GET(uniqueRepoReq());

    expect(res.status).toBe(503);
    expect(generateJson).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure — a later request retries rather than being stuck", async () => {
    const req = uniqueRepoReq();
    generateJson.mockResolvedValueOnce({ ok: false, reason: "provider_error", error: "boom" });

    const { GET } = await import("@/app/api/ai/insights/route");
    expect((await GET(req)).status).toBe(503);

    generateJson.mockResolvedValue(okProvider());
    expect((await GET(req)).status).toBe(200);
  });

  it("returns 500 when snapshot assembly itself throws", async () => {
    buildInsightsSnapshot.mockRejectedValue(new Error("github exploded"));
    const { GET } = await import("@/app/api/ai/insights/route");
    const res = await GET(uniqueRepoReq());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("github exploded");
  });
});

describe("GET /api/ai/insights — rate limiting", () => {
  it("returns 429 with Retry-After once the per-minute limit is exceeded", async () => {
    const { GET } = await import("@/app/api/ai/insights/route");

    // beforeEach gave this test its own token, so all 21 calls share one
    // fresh limiter bucket: 20 are allowed, the 21st must be rejected.
    let last: Response | undefined;
    for (let i = 0; i < 21; i++) last = await GET(uniqueRepoReq());

    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).toBeTruthy();
    await expect(last!.json()).resolves.toEqual({ ok: false, error: "Rate limit exceeded" });
  });
});
