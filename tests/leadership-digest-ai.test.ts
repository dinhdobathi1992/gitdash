import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * F2 — AI executive summary in the Weekly Leadership Digest (v4.1.4).
 *
 * The property that matters most here is negative: the digest must still send
 * when AI is unavailable, in every failure mode. A weekly email that stops
 * arriving because an LLM was down would be worse than never adding the
 * summary at all, so most of this file is about failure.
 */

const getLeadershipDigestRules = vi.fn();
const computeScorecard = vi.fn();
const generateLeadershipNarrative = vi.fn();
const deliverLeadershipDigestEmail = vi.fn();
const generateJson = vi.fn();

vi.mock("@/lib/db", () => ({
  getLeadershipDigestRules: () => getLeadershipDigestRules(),
  upsertRuns: vi.fn(),
  getSyncCursor: vi.fn(),
  updateSyncCursor: vi.fn(),
  getDbRunCount: vi.fn(),
  evaluateAlertRulesForRepo: vi.fn(),
  getPendingDigestEvents: vi.fn(),
  markDigestSent: vi.fn(),
}));
vi.mock("@/lib/notifier", () => ({
  deliverLeadershipDigestEmail: (...a: unknown[]) => deliverLeadershipDigestEmail(...a),
  deliverDigestEmail: vi.fn(),
}));
vi.mock("@/lib/ai", () => ({ generateJson: (...a: unknown[]) => generateJson(...a) }));
vi.mock("@/lib/org-health-scorecard", () => ({
  computeScorecard: (...a: unknown[]) => computeScorecard(...a),
}));
vi.mock("@/lib/leadership-narrative", () => ({
  generateLeadershipNarrative: (...a: unknown[]) => generateLeadershipNarrative(...a),
}));

const NARRATIVE = {
  org: "acme",
  subject: "[GitDash] Weekly digest for acme",
  summary_line: "3 repos scored this week; 1 is at risk.",
  highlights: ["gamma is healthy"],
  concerns: ["alpha has a bus factor of 1"],
};

const SCORECARD = {
  org: "acme",
  repos: [{ owner: "acme", repo: "alpha", composite_score: 25, risk_band: "at_risk" }],
  repos_analysed: 1,
  repos_attempted: 1,
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  getLeadershipDigestRules.mockReset().mockResolvedValue([
    { id: 1, scope: "org:acme", destination: "cto@acme.com", enabled: true },
  ]);
  computeScorecard.mockReset().mockResolvedValue(SCORECARD);
  generateLeadershipNarrative.mockReset().mockReturnValue(NARRATIVE);
  deliverLeadershipDigestEmail.mockReset().mockResolvedValue({ ok: true });
  generateJson.mockReset().mockResolvedValue({
    ok: true,
    provider: "bailian",
    model: "qwen3.6-flash",
    content: JSON.stringify({ summary: "Delivery held steady; alpha remains the main risk." }),
  });
});

async function run() {
  const { sendWeeklyLeadershipDigests } = await import("@/lib/sync");
  return sendWeeklyLeadershipDigests({} as never, "tok");
}

describe("sendWeeklyLeadershipDigests — AI summary attached", () => {
  it("includes the generated summary in the email", async () => {
    const res = await run();

    expect(res.sent).toBe(1);
    expect(res.failures).toBe(0);
    const [to, payload] = deliverLeadershipDigestEmail.mock.calls[0];
    expect(to).toBe("cto@acme.com");
    expect(payload.aiSummary).toBe("Delivery held steady; alpha remains the main risk.");
    // The rule-based narrative is preserved alongside it, not replaced.
    expect(payload.summary_line).toBe(NARRATIVE.summary_line);
    expect(payload.highlights).toEqual(NARRATIVE.highlights);
  });

  it("passes the scorecard and the rule narrative to the model as an anchor", async () => {
    await run();
    const [, snapshot] = generateJson.mock.calls[0];
    expect(snapshot.org).toBe("acme");
    expect(snapshot.week).toMatch(/^\d{4}-W\d{2}$/);
    expect(snapshot.scorecard).toEqual(SCORECARD);
    expect(snapshot.rule_narrative.summary_line).toBe(NARRATIVE.summary_line);
  });

  it("costs no extra GitHub calls — the scorecard is computed once", async () => {
    await run();
    expect(computeScorecard).toHaveBeenCalledTimes(1);
  });
});

describe("sendWeeklyLeadershipDigests — the digest sends regardless of AI", () => {
  /** Each case must still deliver, with aiSummary omitted. */
  async function expectSentWithoutSummary() {
    const res = await run();
    expect(res.sent).toBe(1);
    expect(res.failures).toBe(0);
    expect(deliverLeadershipDigestEmail).toHaveBeenCalledTimes(1);
    const [, payload] = deliverLeadershipDigestEmail.mock.calls[0];
    expect(payload.aiSummary).toBeUndefined();
    expect(payload.summary_line).toBe(NARRATIVE.summary_line);
  }

  it("sends when no AI provider is configured", async () => {
    generateJson.mockResolvedValue({ ok: false, reason: "no_keys", error: "none" });
    await expectSentWithoutSummary();
  });

  it("sends when the AI layer is disabled", async () => {
    generateJson.mockResolvedValue({ ok: false, reason: "disabled", error: "off" });
    await expectSentWithoutSummary();
  });

  it("sends when the provider errors", async () => {
    generateJson.mockResolvedValue({ ok: false, reason: "provider_error", error: "500" });
    await expectSentWithoutSummary();
  });

  it("sends when the provider times out", async () => {
    generateJson.mockResolvedValue({ ok: false, reason: "timeout", error: "slow" });
    await expectSentWithoutSummary();
  });

  it("sends when the daily token budget is exhausted", async () => {
    generateJson.mockResolvedValue({ ok: false, reason: "budget_exceeded", error: "spent" });
    await expectSentWithoutSummary();
  });

  it("sends when the model returns unparseable JSON", async () => {
    generateJson.mockResolvedValue({
      ok: true, provider: "bailian", model: "m", content: "I'm sorry, I can't do that.",
    });
    await expectSentWithoutSummary();
  });

  it("sends when the model returns valid JSON with the wrong shape", async () => {
    generateJson.mockResolvedValue({
      ok: true, provider: "bailian", model: "m", content: JSON.stringify({ nope: 1 }),
    });
    await expectSentWithoutSummary();
  });

  it("sends when generateJson throws outright", async () => {
    generateJson.mockRejectedValue(new Error("unexpected explosion"));
    await expectSentWithoutSummary();
  });

  it("still reports a failure when the EMAIL itself fails, not the AI", async () => {
    deliverLeadershipDigestEmail.mockResolvedValue({
      ok: false, error: "No email provider configured.",
    });
    const res = await run();
    expect(res.sent).toBe(0);
    expect(res.failures).toBe(1);
  });
});
