import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/** Follows the route-handler pattern from tests/api-ai-status.test.ts. */

const getTokenFromSession = vi.fn();
const aiEnabled = vi.fn();
const generateJson = vi.fn();
const buildRootCauseSnapshot = vi.fn();

vi.mock("@/lib/session", () => ({ getTokenFromSession: () => getTokenFromSession() }));
vi.mock("@/lib/ai", () => ({
  aiEnabled: () => aiEnabled(),
  generateJson: (...a: unknown[]) => generateJson(...a),
}));
vi.mock("@/lib/ai-snapshots", () => ({
  buildRootCauseSnapshot: (...a: unknown[]) => buildRootCauseSnapshot(...a),
}));

const GOOD_CONTENT = JSON.stringify({
  hypotheses: [
    {
      rank: 1,
      hypothesis: "The ci.yml change broke the test step.",
      evidence: "All 5 failures name 'Run tests' and none precede 2026-08-09.",
      confidence: "high",
      next_step: "Diff .github/workflows/ci.yml at that commit.",
    },
  ],
});

function okProvider(content = GOOD_CONTENT) {
  return { ok: true, provider: "bailian", model: "qwen3.6-flash", content };
}

let seq = 0;
function req(params: string) {
  return new NextRequest(`https://x.test/api/ai/root-cause?${params}`);
}
function validReq() {
  seq++;
  return req(`owner=o&repo=r${seq}&workflow_id=7`);
}

function snapshot(over = {}) {
  return {
    workflow_name: "CI",
    repo: "o/r",
    window_runs: 15,
    run_count: 15,
    failure_count: 5,
    failure_rate_pct: 33,
    first_failure_at: "2026-08-10T10:00:00Z",
    prior_success_streak: 10,
    failures: [],
    step_failure_frequency: [{ step_name: "Run tests", failure_count: 5, share_of_failures_pct: 100 }],
    failure_clustering: { same_step_share_pct: 100, trigger_distribution: { push: 5 }, branch_distribution: { main: 5 } },
    workflow_file_changes: [],
    duration_shift: null,
    partial: false,
    ...over,
  };
}

beforeEach(async () => {
  seq++;
  getTokenFromSession.mockReset().mockResolvedValue(`tok-${seq}`);
  aiEnabled.mockReset().mockReturnValue(true);
  generateJson.mockReset().mockResolvedValue(okProvider());
  buildRootCauseSnapshot.mockReset().mockImplementation(async () => snapshot({ repo: `o/r${seq}` }));
  const { cacheDeleteByPrefix } = await import("@/lib/cache");
  cacheDeleteByPrefix("ai:root-cause");
});

describe("GET /api/ai/root-cause — auth and validation", () => {
  it("returns 401 without a session", async () => {
    getTokenFromSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/ai/root-cause/route");
    expect((await GET(validReq())).status).toBe(401);
  });

  it("returns 503 when unconfigured, without building the expensive snapshot", async () => {
    aiEnabled.mockReturnValue(false);
    const { GET } = await import("@/app/api/ai/root-cause/route");
    expect((await GET(validReq())).status).toBe(503);
    expect(buildRootCauseSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a missing workflow_id", async () => {
    const { GET } = await import("@/app/api/ai/root-cause/route");
    expect((await GET(req("owner=o&repo=r"))).status).toBe(400);
  });
});

describe("GET /api/ai/root-cause — minimum-failures floor", () => {
  it("returns content: null and calls no provider below the threshold", async () => {
    buildRootCauseSnapshot.mockResolvedValue(snapshot({ failure_count: 2 }));
    const { GET } = await import("@/app/api/ai/root-cause/route");
    const res = await GET(validReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.content).toBeNull();
    expect(body.failure_count).toBe(2);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("generates once the threshold is met", async () => {
    const { GET } = await import("@/app/api/ai/root-cause/route");
    const body = await (await GET(validReq())).json();

    expect(body.content).not.toBeNull();
    expect(body.content.hypotheses).toHaveLength(1);
    expect(generateJson).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/ai/root-cause — behaviour", () => {
  it("returns ranked hypotheses with provider attribution", async () => {
    const { GET } = await import("@/app/api/ai/root-cause/route");
    const body = await (await GET(validReq())).json();

    expect(body.provider).toBe("bailian");
    expect(body.failure_count).toBe(5);
    expect(body.content.hypotheses[0].confidence).toBe("high");
    expect(body.content.hypotheses[0].rank).toBe(1);
  });

  it("caches the snapshot build separately, so a repeat request refetches nothing", async () => {
    const { GET } = await import("@/app/api/ai/root-cause/route");
    const r = validReq();

    await GET(r);
    await GET(r);

    // The GitHub fan-out is the expensive part — it must run only once.
    expect(buildRootCauseSnapshot).toHaveBeenCalledTimes(1);
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it("propagates the partial flag", async () => {
    buildRootCauseSnapshot.mockResolvedValue(snapshot({ partial: true }));
    const { GET } = await import("@/app/api/ai/root-cause/route");
    expect((await (await GET(validReq())).json()).partial).toBe(true);
  });

  it("maps a provider failure to 503", async () => {
    generateJson.mockResolvedValue({ ok: false, reason: "provider_error", error: "boom" });
    const { GET } = await import("@/app/api/ai/root-cause/route");
    const res = await GET(validReq());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "AI hypotheses unavailable" });
  });

  it("retries once on an invented confidence level, then succeeds", async () => {
    const badConfidence = JSON.stringify({
      hypotheses: [{ rank: 1, hypothesis: "h", evidence: "e", confidence: "extremely high", next_step: "n" }],
    });
    generateJson.mockResolvedValueOnce(okProvider(badConfidence)).mockResolvedValueOnce(okProvider());

    const { GET } = await import("@/app/api/ai/root-cause/route");
    expect((await GET(validReq())).status).toBe(200);
    expect(generateJson).toHaveBeenCalledTimes(2);
  });

  it("returns 503 when both attempts fail validation", async () => {
    generateJson.mockResolvedValue(okProvider("not json"));
    const { GET } = await import("@/app/api/ai/root-cause/route");

    expect((await GET(validReq())).status).toBe(503);
    expect(generateJson).toHaveBeenCalledTimes(2);
  });

  it("returns 500 when snapshot assembly throws, without leaking the cause", async () => {
    buildRootCauseSnapshot.mockRejectedValue(new Error("github exploded"));
    const { GET } = await import("@/app/api/ai/root-cause/route");
    const res = await GET(validReq());

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("github exploded");
  });
});

describe("GET /api/ai/root-cause — rate limiting", () => {
  it("allows 10 per minute, then 429s — half the other AI surfaces", async () => {
    const { GET } = await import("@/app/api/ai/root-cause/route");

    let last: Response | undefined;
    for (let i = 0; i < 11; i++) last = await GET(validReq());

    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).toBeTruthy();
  });
});
