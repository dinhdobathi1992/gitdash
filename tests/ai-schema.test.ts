import { describe, it, expect } from "vitest";
import { parseInsightsContent } from "@/lib/ai-schema";

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
