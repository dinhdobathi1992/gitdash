import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const getTokenFromSession = vi.fn();
const rateLimitFn = vi.fn();
const getRateLimitKeyFn = vi.fn();
const createIssueFn = vi.fn();

vi.mock("@/lib/session", () => ({ getTokenFromSession: () => getTokenFromSession() }));
vi.mock("@/lib/ratelimit", () => ({
  rateLimit: (...a: unknown[]) => rateLimitFn(...a),
  getRateLimitKey: (...a: unknown[]) => getRateLimitKeyFn(...a),
}));
vi.mock("@/lib/github", () => ({
  getOctokit: () => ({
    rest: {
      issues: {
        create: (...a: unknown[]) => createIssueFn(...a),
      },
    },
  }),
}));

function req(body: Record<string, unknown>) {
  return new NextRequest("https://x.test/api/github/create-issue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getTokenFromSession.mockResolvedValue("tok");
  getRateLimitKeyFn.mockReturnValue("create-issue:127.0.0.1");
  rateLimitFn.mockReturnValue({ allowed: true });
  createIssueFn.mockResolvedValue({
    data: { html_url: "https://github.com/o/r/issues/42", number: 42 },
  });
});

describe("POST /api/github/create-issue — auth", () => {
  it("returns 401 when not authenticated", async () => {
    getTokenFromSession.mockResolvedValue(null);
    const { POST } = await import("../src/app/api/github/create-issue/route");
    const res = await POST(req({ owner: "o", repo: "r", title: "bug", body: "details" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/github/create-issue — rate limit", () => {
  it("returns 429 on 6th request in window", async () => {
    rateLimitFn.mockReturnValue({ allowed: false, retryAfterMs: 3_600_000 });
    const { POST } = await import("../src/app/api/github/create-issue/route");
    const res = await POST(req({ owner: "o", repo: "r", title: "bug", body: "" }));
    expect(res.status).toBe(429);
  });
});

describe("POST /api/github/create-issue — validation", () => {
  it("returns 400 for missing title", async () => {
    const { POST } = await import("../src/app/api/github/create-issue/route");
    const res = await POST(req({ owner: "o", repo: "r", title: "", body: "" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/title/);
  });

  it("returns 400 for oversized title", async () => {
    const { POST } = await import("../src/app/api/github/create-issue/route");
    const res = await POST(req({ owner: "o", repo: "r", title: "a".repeat(257), body: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for oversized body", async () => {
    const { POST } = await import("../src/app/api/github/create-issue/route");
    const res = await POST(req({ owner: "o", repo: "r", title: "bug", body: "x".repeat(10_001) }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid owner format", async () => {
    const { POST } = await import("../src/app/api/github/create-issue/route");
    const res = await POST(req({ owner: "bad owner!", repo: "r", title: "bug", body: "" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/github/create-issue — success", () => {
  it("returns the created issue URL and number", async () => {
    const { POST } = await import("../src/app/api/github/create-issue/route");
    const res = await POST(req({ owner: "o", repo: "r", title: "Anomaly in run #99", body: "Details here." }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.issue_url).toBe("https://github.com/o/r/issues/42");
    expect(data.issue_number).toBe(42);
  });
});

describe("POST /api/github/create-issue — mapped GitHub errors", () => {
  const ERROR_CASES: Array<[number, string]> = [
    [401, "authentication expired"],
    [403, "permission"],
    [404, "not found"],
    [410, "disabled"],
    [422, "rejected"],
  ];

  ERROR_CASES.forEach(([status, expectedKeyword]) => {
    it(`returns ${status} with a curated message for GitHub ${status}`, async () => {
      createIssueFn.mockRejectedValue(Object.assign(new Error("github error"), { status }));
      const { POST } = await import("../src/app/api/github/create-issue/route");
      const res = await POST(req({ owner: "o", repo: "r", title: "bug", body: "" }));
      expect(res.status).toBe(status);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error.toLowerCase()).toContain(expectedKeyword);
    });
  });

  it("falls through to safeError for unmapped status codes", async () => {
    createIssueFn.mockRejectedValue(Object.assign(new Error("unknown"), { status: 500 }));
    const { POST } = await import("../src/app/api/github/create-issue/route");
    const res = await POST(req({ owner: "o", repo: "r", title: "bug", body: "" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    // safeError should not leak the real error message
    expect(data.error).not.toContain("unknown");
  });
});
