/**
 * Features as the Settings access matrix presents them (`Settings` artboard):
 * grouped rows with plain names. Keys are the FeatureFlags permission keys.
 */
import type { FeatureFlags } from "@/lib/feature-flags";

export interface FeatureRow {
  key: keyof FeatureFlags;
  name: string;
  description: string;
  /** Creates things on GitHub with the user's token. */
  writes?: boolean;
}

export const FEATURE_GROUPS: { label: string; rows: FeatureRow[] }[] = [
  {
    label: "Delivery",
    rows: [
      { key: "dora", name: "DORA metrics", description: "Deploy frequency, lead time, failure rate, restore time" },
      { key: "prLifecycle", name: "Pull request lifecycle", description: "Open pull request health, review times, abandon rate" },
      { key: "healthScorecard", name: "Health scorecard", description: "Org-wide team health grades" },
    ],
  },
  {
    label: "Reliability",
    rows: [
      { key: "performanceTab", name: "Workflow performance", description: "Duration trends, job breakdown, queue wait" },
      { key: "reliabilityTab", name: "Workflow reliability", description: "Flaky branches, failure streaks, recovery time" },
      { key: "anomalyDetection", name: "Anomaly detection", description: "Runs that fall outside the normal range" },
      { key: "runnerUtilization", name: "Runner utilization", description: "Self-hosted runner load and queueing" },
    ],
  },
  {
    label: "People",
    rows: [
      { key: "busFactor", name: "Bus factor", description: "Knowledge concentration by repository" },
      { key: "reviewBottleneck", name: "Review bottlenecks", description: "Who reviews whom, and where it stalls" },
      { key: "workloadRisk", name: "Workload risk", description: "After-hours and overload signals per person" },
      { key: "workingHabits", name: "Working habits", description: "Oversized commits and pull requests per person" },
    ],
  },
  {
    label: "Money and security",
    rows: [
      { key: "costAnalytics", name: "Cost", description: "Actions billing, projections, savings" },
      { key: "securityScan", name: "Workflow security scan", description: "Risky patterns in workflow files" },
    ],
  },
  {
    label: "AI",
    rows: [
      { key: "aiInsights", name: "AI summaries and hypotheses", description: "Uses the organization's AI provider key" },
      { key: "githubIssueFromAnomaly", name: "Open issues from anomalies", description: "Creates a GitHub issue from an anomaly", writes: true },
    ],
  },
];

export const GROUP_LABEL: Record<string, string> = {
  admin: "Admin",
  devops: "DevOps",
  security: "Security",
  dev: "Developer",
  pm: "PM",
};

/** Matrix column order: Admin first, then the grantable groups. */
export const GROUP_ORDER = ["admin", "devops", "security", "dev", "pm"] as const;
