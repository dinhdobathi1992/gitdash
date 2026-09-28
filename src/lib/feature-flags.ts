export type FeatureFlags = {
  dora: boolean;
  prLifecycle: boolean;
  anomalyDetection: boolean;
  performanceTab: boolean;
  reliabilityTab: boolean;
  busFactor: boolean;
  securityScan: boolean;
  costAnalytics: boolean;
  runnerUtilization: boolean;
  reviewBottleneck: boolean;
  healthScorecard: boolean;
  workloadRisk: boolean;
  aiInsights: boolean;
  githubIssueFromAnomaly: boolean;
  workingHabits: boolean;
};

/**
 * Convention: new flags default false until proven stable, unless the
 * organization-mode grant is the real gate (workingHabits: a lead's group is
 * granted it on purpose, so a default of false would make every granted lead
 * switch it on by hand).
 * Write-capable flags (those that push data to external services) must also
 * set `writes: true` on their FlagDef in settings/page.tsx to be excluded
 * from bulk Enable/Disable-all actions.
 */
export const DEFAULT_FLAGS: FeatureFlags = {
  dora: true,
  prLifecycle: true,
  anomalyDetection: true,
  performanceTab: true,
  reliabilityTab: true,
  busFactor: true,
  securityScan: true,
  costAnalytics: true,
  runnerUtilization: true,
  reviewBottleneck: true,
  healthScorecard: true,
  workloadRisk: true,
  aiInsights: true,
  githubIssueFromAnomaly: false,
  workingHabits: true,
};

/** Display metadata for each flag (settings page, admin permission matrix). */
export type FlagDef = {
  key: keyof FeatureFlags;
  label: string;
  description: string;
  affects: string;
  writes?: boolean;
};

export const FLAG_DEFS: FlagDef[] = [
  { key: "dora", label: "DORA Metrics", description: "Deploy Frequency, Lead Time, Change Failure Rate, MTTR KPI cards and drill-down charts.", affects: "Repository Overview" },
  { key: "prLifecycle", label: "PR Lifecycle Health", description: "Open PRs, Review P50/P90, Abandon Rate, Age Distribution, and concurrent WIP by author.", affects: "Repository Overview" },
  { key: "performanceTab", label: "Performance Tab", description: "Job Duration avg vs p95, Job Composition per Run, Slowest Steps — requires fetching job-level data.", affects: "Workflow Detail" },
  { key: "reliabilityTab", label: "Reliability Tab", description: "MTTR, Failure Streak, Flaky Branches, Re-run Rate, Pass/Fail Timeline.", affects: "Workflow Detail" },
  { key: "anomalyDetection", label: "Anomaly Detection", description: "Statistical outlier detection (> 2 stddev from rolling baseline) on workflow runs.", affects: "Workflow Detail" },
  { key: "busFactor", label: "Bus Factor Analysis", description: "Per-module contributor count and Herfindahl-Hirschman Index — requires fetching full commit history.", affects: "Repository Team" },
  { key: "securityScan", label: "Security Scan", description: "Static analysis of workflow YAML files for security anti-patterns.", affects: "Repository Security" },
  { key: "costAnalytics", label: "Cost Analytics", description: "GitHub Actions billing breakdown by runner type and SKU.", affects: "Cost Analytics" },
  { key: "runnerUtilization", label: "Runner Utilization", description: "Per-runner job counts, durations, and failure rates across recent workflow runs.", affects: "Repository Team" },
  { key: "reviewBottleneck", label: "Review Bottleneck", description: "Flags overloaded reviewers and stale review requests from PR review data.", affects: "Repository Team" },
  { key: "healthScorecard", label: "Team Health Scorecard", description: "Org-wide ranked view combining DORA tier and bus-factor risk per repo, worst-first.", affects: "Organization Overview" },
  { key: "workloadRisk", label: "Workload Risk Radar", description: "Flags sustained after-hours/weekend work, activity cliffs, and concurrent-PR overload per person.", affects: "Repository Team" },
  { key: "aiInsights", label: "AI Insights", description: "LLM-generated analysis of the metrics already on screen. Requires AI provider keys configured on the server — the surfaces stay hidden without them.", affects: "Repository Overview, Organization Health" },
  { key: "workingHabits", label: "Working Habits", description: "Per-engineer share of oversized commits (too many files or lines) and PRs with too many commits, measured inside merged PRs. Engineers always see their own numbers.", affects: "Team Insights, Contributor Profile" },
  { key: "githubIssueFromAnomaly", label: "File Anomaly as GitHub Issue", description: "Adds a 'File as issue' button to the anomaly card on workflow-detail pages. This is a write capability — it creates issues in the repo on your behalf using your GitHub token. Individual toggle only; excluded from bulk Enable/Disable-all.", affects: "Workflow Detail", writes: true },
];

/**
 * Effective flags: a feature is on only if the server grants it AND the user
 * has not switched it off. `granted === "all"` (standalone mode) means the
 * user's preferences apply unchanged.
 */
export function effectiveFlags(preferences: FeatureFlags, granted: Set<keyof FeatureFlags> | "all"): FeatureFlags {
  if (granted === "all") return preferences;
  const out = { ...preferences };
  for (const k of Object.keys(out) as (keyof FeatureFlags)[]) out[k] = preferences[k] && granted.has(k);
  return out;
}

export const STORAGE_KEY = "gitdash:feature-flags";

// ── External store (useSyncExternalStore-compatible) ──────────────────────────
// Keeps one shared flags object so all subscribers see the same snapshot.

let _flags: FeatureFlags = DEFAULT_FLAGS;
let _clientInitialized = false;
const _listeners = new Set<() => void>();

/** Called by useSyncExternalStore on the client. Lazy-loads from localStorage once. */
export function getSnapshot(): FeatureFlags {
  if (!_clientInitialized && typeof window !== "undefined") {
    _clientInitialized = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) _flags = { ...DEFAULT_FLAGS, ...JSON.parse(raw) };
    } catch {
      // ignore
    }
  }
  return _flags;
}

/** Called by useSyncExternalStore during SSR — must be pure and stable. */
export function getServerSnapshot(): FeatureFlags {
  return DEFAULT_FLAGS;
}

/** Subscribe to store changes. */
export function subscribeFlags(callback: () => void): () => void {
  _listeners.add(callback);
  return () => _listeners.delete(callback);
}

/** Update one flag, persist to localStorage, and notify all subscribers. */
export function updateFlag(key: keyof FeatureFlags, value: boolean): void {
  _flags = { ..._flags, [key]: value };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_flags));
  } catch {
    // ignore
  }
  _listeners.forEach((l) => l());
}

/** @deprecated Use getSnapshot / updateFlag instead. */
export function loadFlags(): FeatureFlags {
  return getSnapshot();
}

/** @deprecated Use updateFlag instead. */
export function saveFlags(flags: FeatureFlags): void {
  _flags = flags;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // ignore
  }
}
