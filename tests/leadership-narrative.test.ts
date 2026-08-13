import { describe, it, expect } from "vitest";
import { generateLeadershipNarrative } from "../src/lib/leadership-narrative";
import type { OrgHealthScorecardResponse, RepoScorecardEntry } from "../src/lib/org-health-scorecard";

function makeEntry(overrides: Partial<RepoScorecardEntry> = {}): RepoScorecardEntry {
  return {
    owner: "acme",
    repo: "service-a",
    dora_level: "high",
    overall_bus_factor: 3,
    critical_modules: 0,
    composite_score: 85,
    risk_band: "healthy",
    trend: "flat",
    partial: false,
    ...overrides,
  };
}

function makeScorecard(repos: RepoScorecardEntry[]): OrgHealthScorecardResponse {
  return {
    org: "acme",
    repos,
    repos_analysed: repos.length,
    repos_attempted: repos.length,
  };
}

describe("generateLeadershipNarrative", () => {
  it("handles an empty scorecard without throwing", () => {
    const n = generateLeadershipNarrative(makeScorecard([]));
    expect(n.repos_analysed).toBe(0);
    expect(n.concerns).toHaveLength(0);
    expect(n.subject).toContain("no data");
  });

  it("flags at-risk repos as concerns with the subject line reflecting it", () => {
    const n = generateLeadershipNarrative(makeScorecard([
      makeEntry({ repo: "payments", risk_band: "at_risk", composite_score: 30, overall_bus_factor: 1, critical_modules: 2 }),
      makeEntry({ repo: "web", risk_band: "healthy", composite_score: 90 }),
    ]));
    expect(n.subject).toContain("1 repo");
    expect(n.concerns.some((c) => c.includes("payments") && c.includes("At Risk"))).toBe(true);
  });

  it("reports all-healthy as a highlight with no concerns from risk band", () => {
    const n = generateLeadershipNarrative(makeScorecard([
      makeEntry({ repo: "a", risk_band: "healthy" }),
      makeEntry({ repo: "b", risk_band: "healthy" }),
    ]));
    expect(n.summary_line).toContain("healthy");
    expect(n.highlights.some((h) => h.includes("Healthy"))).toBe(true);
  });

  it("surfaces critical bus-factor modules as a concern", () => {
    const n = generateLeadershipNarrative(makeScorecard([
      makeEntry({ repo: "core", critical_modules: 3, risk_band: "watch" }),
    ]));
    expect(n.concerns.some((c) => c.includes("core") && c.includes("knowledge-silo"))).toBe(true);
  });

  it("surfaces downward throughput trend as a concern", () => {
    const n = generateLeadershipNarrative(makeScorecard([
      makeEntry({ repo: "api", trend: "down", risk_band: "healthy" }),
    ]));
    expect(n.concerns.some((c) => c.includes("api") && c.includes("trending down"))).toBe(true);
  });
});
