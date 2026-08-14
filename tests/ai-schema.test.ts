import { describe, it, expect } from "vitest";
import { parseInsightsContent, parseAnomalyContent, parseRootCauseContent } from "@/lib/ai-schema";

const valid = {
  summary: "Deployment frequency is healthy but change failure rate is rising.",
  bullets: ["CFR rose from 8% to 12%", "Bus factor is 1 on src/app"],
  actions: ["Pair on src/app to raise its bus factor"],
};

describe("parseInsightsContent", () => {
  it("accepts a well-formed payload", () => {
    expect(parseInsightsContent(JSON.stringify(valid))).toEqual(valid);
  });

  it("trims surrounding whitespace on every string", () => {
    const parsed = parseInsightsContent(
      JSON.stringify({ summary: "  s  ", bullets: ["  b  "], actions: ["  a  "] }),
    );
    expect(parsed).toEqual({ summary: "s", bullets: ["b"], actions: ["a"] });
  });

  it("accepts empty bullet and action lists", () => {
    const parsed = parseInsightsContent(
      JSON.stringify({ summary: "Nothing notable this period.", bullets: [], actions: [] }),
    );
    expect(parsed).toEqual({ summary: "Nothing notable this period.", bullets: [], actions: [] });
  });

  it("strips ```json fences that models add even in JSON mode", () => {
    const fenced = "```json\n" + JSON.stringify(valid) + "\n```";
    expect(parseInsightsContent(fenced)).toEqual(valid);
  });

  it("strips bare ``` fences", () => {
    expect(parseInsightsContent("```\n" + JSON.stringify(valid) + "\n```")).toEqual(valid);
  });

  it("truncates an over-long bullet list to the cap", () => {
    const parsed = parseInsightsContent(
      JSON.stringify({ ...valid, bullets: Array.from({ length: 20 }, (_, i) => `b${i}`) }),
    );
    expect(parsed?.bullets).toHaveLength(6);
  });

  it("truncates an over-long action list to the cap", () => {
    const parsed = parseInsightsContent(
      JSON.stringify({ ...valid, actions: Array.from({ length: 20 }, (_, i) => `a${i}`) }),
    );
    expect(parsed?.actions).toHaveLength(4);
  });

  // ── Rejections ──────────────────────────────────────────────────────────────

  it("rejects non-JSON garbage", () => {
    expect(parseInsightsContent("I'm sorry, I can't help with that.")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(parseInsightsContent("")).toBeNull();
  });

  it("rejects a JSON array at the top level", () => {
    expect(parseInsightsContent("[1,2,3]")).toBeNull();
  });

  it("rejects JSON null", () => {
    expect(parseInsightsContent("null")).toBeNull();
  });

  it("rejects a missing summary", () => {
    expect(parseInsightsContent(JSON.stringify({ bullets: [], actions: [] }))).toBeNull();
  });

  it("rejects a missing bullets key", () => {
    expect(parseInsightsContent(JSON.stringify({ summary: "s", actions: [] }))).toBeNull();
  });

  it("rejects a missing actions key", () => {
    expect(parseInsightsContent(JSON.stringify({ summary: "s", bullets: [] }))).toBeNull();
  });

  it("rejects a non-string summary", () => {
    expect(parseInsightsContent(JSON.stringify({ ...valid, summary: 42 }))).toBeNull();
  });

  it("rejects an empty summary", () => {
    expect(parseInsightsContent(JSON.stringify({ ...valid, summary: "   " }))).toBeNull();
  });

  it("rejects a summary over the character cap", () => {
    expect(parseInsightsContent(JSON.stringify({ ...valid, summary: "x".repeat(401) }))).toBeNull();
  });

  it("rejects bullets that are not an array", () => {
    expect(parseInsightsContent(JSON.stringify({ ...valid, bullets: "not a list" }))).toBeNull();
  });

  it("rejects a bullet list containing a non-string", () => {
    expect(parseInsightsContent(JSON.stringify({ ...valid, bullets: ["ok", 7] }))).toBeNull();
  });

  it("rejects an individual item over the character cap", () => {
    expect(
      parseInsightsContent(JSON.stringify({ ...valid, bullets: ["x".repeat(201)] })),
    ).toBeNull();
  });

  it("never throws on hostile input", () => {
    const hostile = ['{"summary":', "{", "[}", '{"summary":{"a":1},"bullets":[],"actions":[]}'];
    for (const h of hostile) {
      expect(() => parseInsightsContent(h)).not.toThrow();
    }
  });
});

// ── Anomaly explanation (v4.1.1) ──────────────────────────────────────────────

describe("parseAnomalyContent", () => {
  const valid = {
    explanation: "Three runs exceeded the baseline right after the workflow file changed.",
    check: "Diff .github/workflows/ci.yml against the commit dated 2026-08-10.",
  };

  it("accepts a well-formed payload", () => {
    expect(parseAnomalyContent(JSON.stringify(valid))).toEqual(valid);
  });

  it("strips code fences", () => {
    expect(parseAnomalyContent("```json\n" + JSON.stringify(valid) + "\n```")).toEqual(valid);
  });

  it("trims whitespace", () => {
    expect(parseAnomalyContent(JSON.stringify({ explanation: " e ", check: " c " }))).toEqual({
      explanation: "e",
      check: "c",
    });
  });

  it("rejects a missing check", () => {
    expect(parseAnomalyContent(JSON.stringify({ explanation: "e" }))).toBeNull();
  });

  it("rejects a missing explanation", () => {
    expect(parseAnomalyContent(JSON.stringify({ check: "c" }))).toBeNull();
  });

  it("rejects an empty explanation", () => {
    expect(parseAnomalyContent(JSON.stringify({ explanation: "  ", check: "c" }))).toBeNull();
  });

  it("rejects an over-long explanation", () => {
    expect(
      parseAnomalyContent(JSON.stringify({ explanation: "x".repeat(401), check: "c" })),
    ).toBeNull();
  });

  it("rejects non-string fields", () => {
    expect(parseAnomalyContent(JSON.stringify({ explanation: 1, check: 2 }))).toBeNull();
  });

  it("rejects garbage without throwing", () => {
    expect(() => parseAnomalyContent("nope")).not.toThrow();
    expect(parseAnomalyContent("nope")).toBeNull();
  });
});

// ── Root-cause hypotheses (v4.1.2) ────────────────────────────────────────────

describe("parseRootCauseContent", () => {
  const h = (over = {}) => ({
    rank: 1,
    hypothesis: "The ci.yml change on 2026-08-09 broke the build step.",
    evidence: "All 7 failures name the same step, and none precede that commit.",
    confidence: "high",
    next_step: "Diff .github/workflows/ci.yml at that commit.",
    ...over,
  });

  it("accepts a well-formed payload", () => {
    const parsed = parseRootCauseContent(JSON.stringify({ hypotheses: [h()] }));
    expect(parsed?.hypotheses).toHaveLength(1);
    expect(parsed?.hypotheses[0].confidence).toBe("high");
  });

  it("accepts all three confidence levels", () => {
    for (const c of ["high", "medium", "low"]) {
      const parsed = parseRootCauseContent(JSON.stringify({ hypotheses: [h({ confidence: c })] }));
      expect(parsed?.hypotheses[0].confidence).toBe(c);
    }
  });

  it("caps at three hypotheses", () => {
    const parsed = parseRootCauseContent(
      JSON.stringify({ hypotheses: [h(), h(), h(), h(), h()] }),
    );
    expect(parsed?.hypotheses).toHaveLength(3);
  });

  it("re-derives rank from position, ignoring what the model claimed", () => {
    const parsed = parseRootCauseContent(
      JSON.stringify({ hypotheses: [h({ rank: 7 }), h({ rank: 7 }), h({ rank: 2 })] }),
    );
    expect(parsed?.hypotheses.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it("strips code fences", () => {
    const parsed = parseRootCauseContent("```json\n" + JSON.stringify({ hypotheses: [h()] }) + "\n```");
    expect(parsed?.hypotheses).toHaveLength(1);
  });

  // ── Rejections ──────────────────────────────────────────────────────────────

  it("rejects an invented confidence level", () => {
    expect(parseRootCauseContent(JSON.stringify({ hypotheses: [h({ confidence: "very high" })] }))).toBeNull();
  });

  it("rejects a numeric confidence", () => {
    expect(parseRootCauseContent(JSON.stringify({ hypotheses: [h({ confidence: 0.9 })] }))).toBeNull();
  });

  it("rejects an empty hypotheses list", () => {
    expect(parseRootCauseContent(JSON.stringify({ hypotheses: [] }))).toBeNull();
  });

  it("rejects a missing hypotheses key", () => {
    expect(parseRootCauseContent(JSON.stringify({ items: [h()] }))).toBeNull();
  });

  it("rejects an entry missing evidence", () => {
    const bad = h(); delete (bad as Record<string, unknown>).evidence;
    expect(parseRootCauseContent(JSON.stringify({ hypotheses: [bad] }))).toBeNull();
  });

  it("rejects an entry missing next_step", () => {
    const bad = h(); delete (bad as Record<string, unknown>).next_step;
    expect(parseRootCauseContent(JSON.stringify({ hypotheses: [bad] }))).toBeNull();
  });

  it("rejects an over-long hypothesis", () => {
    expect(parseRootCauseContent(JSON.stringify({ hypotheses: [h({ hypothesis: "x".repeat(401) })] }))).toBeNull();
  });

  it("accepts evidence at the length real generations produce (~290 chars)", () => {
    const parsed = parseRootCauseContent(JSON.stringify({ hypotheses: [h({ evidence: "x".repeat(290) })] }));
    expect(parsed?.hypotheses).toHaveLength(1);
  });

  it("rejects evidence beyond its own cap", () => {
    expect(parseRootCauseContent(JSON.stringify({ hypotheses: [h({ evidence: "x".repeat(501) })] }))).toBeNull();
  });

  it("rejects garbage without throwing", () => {
    expect(() => parseRootCauseContent("not json")).not.toThrow();
    expect(parseRootCauseContent("not json")).toBeNull();
  });
});
