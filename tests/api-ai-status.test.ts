import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Route-handler test pattern for the AI routes (v4.1.0).
 *
 * This is the first route-handler test in the repo — everything else under
 * tests/ covers pure src/lib functions. Established here on the simplest
 * possible route so the remaining AI routes can copy it.
 *
 * The pattern: vi.mock() the route's own imports (session + the AI layer),
 * then import the handler dynamically so the mocks are in place first. Route
 * handlers that take no arguments (like this one) need no NextRequest at all;
 * routes that read query params construct `new NextRequest(url)` directly,
 * which works under the node environment without extra setup.
 *
 * Verdict: the direct approach works — the extract-to-lib fallback described
 * in the plan was not needed. Later AI routes should follow this file.
 */

const getTokenFromSession = vi.fn();
const aiEnabled = vi.fn();
const configuredProviders = vi.fn();

vi.mock("@/lib/session", () => ({
  getTokenFromSession: () => getTokenFromSession(),
}));

vi.mock("@/lib/ai", () => ({
  aiEnabled: () => aiEnabled(),
  configuredProviders: () => configuredProviders(),
}));

beforeEach(() => {
  getTokenFromSession.mockReset();
  aiEnabled.mockReset();
  configuredProviders.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/ai/status", () => {
  it("returns 401 when there is no session token", async () => {
    getTokenFromSession.mockResolvedValue(null);

    const { GET } = await import("@/app/api/ai/status/route");
    const res = await GET();

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("reports disabled with no providers when the layer is unconfigured", async () => {
    getTokenFromSession.mockResolvedValue("tok");
    aiEnabled.mockReturnValue(false);
    configuredProviders.mockReturnValue([]);

    const { GET } = await import("@/app/api/ai/status/route");
    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ enabled: false, providers: [] });
  });

  it("reports the configured providers in priority order", async () => {
    getTokenFromSession.mockResolvedValue("tok");
    aiEnabled.mockReturnValue(true);
    configuredProviders.mockReturnValue(["gemini", "qwen"]);

    const { GET } = await import("@/app/api/ai/status/route");
    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      enabled: true,
      providers: ["gemini", "qwen"],
    });
  });

  it("marks the response private so a shared cache never serves it across users", async () => {
    getTokenFromSession.mockResolvedValue("tok");
    aiEnabled.mockReturnValue(true);
    configuredProviders.mockReturnValue(["gemini"]);

    const { GET } = await import("@/app/api/ai/status/route");
    const res = await GET();

    expect(res.headers.get("Cache-Control")).toContain("private");
  });

  it("never includes key material in the response body", async () => {
    getTokenFromSession.mockResolvedValue("tok");
    aiEnabled.mockReturnValue(true);
    configuredProviders.mockReturnValue(["gemini"]);

    const { GET } = await import("@/app/api/ai/status/route");
    const body = await (await GET()).json();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/api[_-]?key/i);
    expect(serialized).not.toContain("tok");
  });
});
