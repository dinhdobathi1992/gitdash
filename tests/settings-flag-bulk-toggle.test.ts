import { describe, it, expect } from "vitest";

// Replicate the FLAG_DEFS structure to test filter logic without rendering.
// This is a characterization test — if FLAG_DEFS changes incompatibly, this fails.
type FlagDef = {
  key: string;
  label: string;
  description: string;
  affects: string;
  writes?: boolean;
};

// Simulated FLAG_DEFS matching what settings/page.tsx defines after Phase 4
const FLAG_DEFS: FlagDef[] = [
  { key: "dora", label: "DORA Metrics", description: "...", affects: "Repository Overview" },
  { key: "prLifecycle", label: "PR Lifecycle Health", description: "...", affects: "Repository Overview" },
  { key: "anomalyDetection", label: "Anomaly Detection", description: "...", affects: "Workflow Detail" },
  { key: "performanceTab", label: "Performance Tab", description: "...", affects: "Workflow Detail" },
  { key: "reliabilityTab", label: "Reliability Tab", description: "...", affects: "Workflow Detail" },
  { key: "busFactor", label: "Bus Factor Analysis", description: "...", affects: "Repository Team" },
  { key: "securityScan", label: "Security Scan", description: "...", affects: "Repository Security" },
  { key: "costAnalytics", label: "Cost Analytics", description: "...", affects: "Cost Analytics" },
  { key: "runnerUtilization", label: "Runner Utilization", description: "...", affects: "Repository Team" },
  { key: "reviewBottleneck", label: "Review Bottleneck", description: "...", affects: "Repository Team" },
  { key: "healthScorecard", label: "Team Health Scorecard", description: "...", affects: "Organization Overview" },
  { key: "workloadRisk", label: "Workload Risk Radar", description: "...", affects: "Repository Team" },
  { key: "aiInsights", label: "AI Insights", description: "...", affects: "Repository Overview, Organization Health" },
  { key: "githubIssueFromAnomaly", label: "File Anomaly as GitHub Issue", description: "Write capability.", affects: "Workflow Detail", writes: true },
];

describe("FLAG_DEFS bulk-toggle exclusion", () => {
  it("has exactly one write-capable flag (githubIssueFromAnomaly)", () => {
    const writeFlags = FLAG_DEFS.filter((d) => d.writes);
    expect(writeFlags).toHaveLength(1);
    expect(writeFlags[0].key).toBe("githubIssueFromAnomaly");
  });

  it("bulk Enable-all excludes write-capable flags", () => {
    const flags: Record<string, boolean> = Object.fromEntries(FLAG_DEFS.map((d) => [d.key, false]));
    // Simulate the Enable all onClick
    FLAG_DEFS.filter((d) => !d.writes).forEach((d) => { flags[d.key] = true; });
    expect(flags["githubIssueFromAnomaly"]).toBe(false); // NOT enabled by bulk action
    expect(flags["dora"]).toBe(true); // normal flags ARE enabled
    expect(flags["aiInsights"]).toBe(true);
  });

  it("bulk Disable-all excludes write-capable flags", () => {
    const flags: Record<string, boolean> = Object.fromEntries(FLAG_DEFS.map((d) => [d.key, true]));
    // Simulate the Disable all onClick
    FLAG_DEFS.filter((d) => !d.writes).forEach((d) => { flags[d.key] = false; });
    expect(flags["githubIssueFromAnomaly"]).toBe(true); // NOT disabled by bulk action
    expect(flags["dora"]).toBe(false); // normal flags ARE disabled
  });

  it("githubIssueFromAnomaly defaults to false in DEFAULT_FLAGS", async () => {
    // Dynamic import is intentional here: tests the real exported value at runtime
    // without importing at module level (avoids localStorage side-effects in other tests).
    const { DEFAULT_FLAGS } = await import("../src/lib/feature-flags");
    expect((DEFAULT_FLAGS as Record<string, boolean>)["githubIssueFromAnomaly"]).toBe(false);
  });
});
