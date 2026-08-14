import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Snapshot-builder tests, with the privacy allowlist checked mechanically.
 *
 * The point of the builders is that a field absent from the interface cannot
 * leak into a prompt. `assertNoForbiddenKeys` enforces that by walking the
 * serialized snapshot, so an upstream fetcher that starts returning commit
 * messages or file contents fails a test rather than quietly shipping them
 * to a model.
 *
 * Every AI snapshot builder added later must reuse this helper.
 */

/** Keys that must never appear anywhere in a snapshot, at any depth. */
const FORBIDDEN_KEYS = [
  "token", "pat", "accessToken", "access_token", "apiKey", "api_key",
  "logs", "log", "body", "content", "yaml", "yml",
  "message", "commit_message", "patch", "diff",
  "email", "html_url", "sha",
];

export function assertNoForbiddenKeys(obj: unknown, path = "$"): void {
  if (obj === null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => assertNoForbiddenKeys(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    expect(
      FORBIDDEN_KEYS,
      `forbidden key "${k}" found at ${path}.${k} — snapshots must not carry it`,
    ).not.toContain(k);
    assertNoForbiddenKeys(v, `${path}.${k}`);
  }
}

// ── Mocks for every fetcher a builder reuses ─────────────────────────────────

const getRepoSummary = vi.fn();
const listWorkflowFileCommits = vi.fn();
const getRepoDoraSummary = vi.fn();
const computeBusFactor = vi.fn();
const computeScorecard = vi.fn();
const listWorkflowRuns = vi.fn();
const listRunJobs = vi.fn();

vi.mock("@/lib/github", () => ({
  getRepoSummary: (...a: unknown[]) => getRepoSummary(...a),
  listWorkflowFileCommits: (...a: unknown[]) => listWorkflowFileCommits(...a),
  listWorkflowRuns: (...a: unknown[]) => listWorkflowRuns(...a),
  listRunJobs: (...a: unknown[]) => listRunJobs(...a),
  getOctokit: () => ({}),
}));
vi.mock("@/lib/github-dora", () => ({
  getRepoDoraSummary: (...a: unknown[]) => getRepoDoraSummary(...a),
}));
vi.mock("@/lib/bus-factor", () => ({
  computeBusFactor: (...a: unknown[]) => computeBusFactor(...a),
}));
vi.mock("@/lib/org-health-scorecard", () => ({
  computeScorecard: (...a: unknown[]) => computeScorecard(...a),
}));

// ── Fixtures — deliberately carrying forbidden fields ────────────────────────
// Each fixture mimics the *real* upstream shape, including the sensitive
// fields the builder is responsible for dropping.

const repoSummaryFixture = {
  latest_conclusion: "success",
  latest_status: "completed",
  latest_run_at: "2026-08-13T10:00:00Z",
  latest_actor: "octocat",
  latest_sha: "deadbeef",
  latest_message: "fix: do not leak this commit message",
  recent_runs: [],
  trend_30d: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, "0")}`,
    success: 8,
    total: 10,
  })),
  success_rate: 80,
};

const doraFixture = {
  deployment_frequency: { per_day: 1.5, total: 45, period_days: 30, level: "high", label: "High" },
  lead_time: { median_ms: 7_200_000, p95_ms: 20_000_000, sample_size: 20, level: "high", label: "High" },
  change_failure_rate: { rate: 12, failures: 5, total: 42, level: "medium", label: "Medium" },
  mttr: { mean_ms: 3_600_000, recoveries: 4, level: "high", label: "High" },
  overall_level: "high",
  cycle_breakdown: {},
  pr_scatter: [],
  throughput_by_week: [],
  prs_analysed: 42,
  releases_analysed: 3,
  partial: false,
  fetched_prs: 42,
  total_prs_attempted: 42,
};

const busFactorFixture = {
  modules: [{ path: "src/app", bus_factor: 1 }],
  overall_bus_factor: 2,
  total_commits: 120,
  critical_modules: 3,
  total_contributors: 4,
  partial: false,
};

const workflowCommitsFixture = [
  {
    sha: "abc123",
    message: "ci: bump node — this message must not reach a prompt",
    author_login: "octocat",
    author_avatar: "https://example.test/a.png",
    author_name: "Octo Cat",
    date: "2026-08-10T09:00:00Z",
    html_url: "https://github.com/o/r/commit/abc123",
    file_path: ".github/workflows/ci.yml",
  },
];

const scorecardFixture = {
  org: "acme",
  repos: [
    { owner: "acme", repo: "alpha", dora_level: "low", overall_bus_factor: 1, critical_modules: 5, composite_score: 25, risk_band: "at_risk", trend: "flat", partial: false },
    { owner: "acme", repo: "beta", dora_level: "medium", overall_bus_factor: 2, critical_modules: 1, composite_score: 54, risk_band: "watch", trend: "up", partial: false },
    { owner: "acme", repo: "gamma", dora_level: "high", overall_bus_factor: 3, critical_modules: 0, composite_score: 85, risk_band: "healthy", trend: "up", partial: false },
  ],
  repos_analysed: 3,
  repos_attempted: 3,
};

beforeEach(() => {
  getRepoSummary.mockReset().mockResolvedValue(repoSummaryFixture);
  getRepoDoraSummary.mockReset().mockResolvedValue(doraFixture);
  computeBusFactor.mockReset().mockResolvedValue(busFactorFixture);
  listWorkflowFileCommits.mockReset().mockResolvedValue(workflowCommitsFixture);
  computeScorecard.mockReset().mockResolvedValue(scorecardFixture);
});

// ── Repo surface ──────────────────────────────────────────────────────────────

describe("buildInsightsSnapshot — repo surface", () => {
  it("produces the expected shape from healthy fixtures", async () => {
    const { buildInsightsSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildInsightsSnapshot("tok", { surface: "repo", owner: "o", repo: "r" });

    expect(snap.surface).toBe("repo");
    expect(snap.scope).toBe("o/r");
    expect(snap.period_days).toBe(30);
    expect(snap.dora).toEqual({
      deployments_per_day: 1.5,
      lead_time_p50_hours: 2,
      change_failure_rate_pct: 12,
      mttr_mean_hours: 1,
      benchmark: "high",
    });
    expect(snap.ci).toMatchObject({ total_runs: 300, success_rate_pct: 80 });
    expect(snap.bus_factor).toEqual({ overall: 2, critical_modules: 3, total_contributors: 4 });
    expect(snap.partial).toBe(false);
  });

  it("carries no forbidden keys", async () => {
    const { buildInsightsSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildInsightsSnapshot("tok", { surface: "repo", owner: "o", repo: "r" });
    assertNoForbiddenKeys(snap);
  });

  it("drops commit messages, shas and urls from workflow-change metadata", async () => {
    const { buildInsightsSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildInsightsSnapshot("tok", { surface: "repo", owner: "o", repo: "r" });

    expect(snap.recent_workflow_changes).toEqual([
      { date: "2026-08-10T09:00:00Z", author_login: "octocat" },
    ]);
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("must not reach a prompt");
    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain("github.com");
  });

  it("never serializes the latest commit message from the repo summary", async () => {
    const { buildInsightsSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildInsightsSnapshot("tok", { surface: "repo", owner: "o", repo: "r" });
    expect(JSON.stringify(snap)).not.toContain("do not leak this commit message");
  });

  it("degrades to a partial snapshot when a sub-fetch fails instead of throwing", async () => {
    getRepoDoraSummary.mockRejectedValue(new Error("rate limited"));
    computeBusFactor.mockRejectedValue(new Error("rate limited"));

    const { buildInsightsSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildInsightsSnapshot("tok", { surface: "repo", owner: "o", repo: "r" });

    expect(snap.dora).toBeNull();
    expect(snap.bus_factor).toBeNull();
    expect(snap.ci).not.toBeNull();
    expect(snap.partial).toBe(true);
  });

  it("flags partial when an upstream fetcher reports partial data", async () => {
    getRepoDoraSummary.mockResolvedValue({ ...doraFixture, partial: true });

    const { buildInsightsSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildInsightsSnapshot("tok", { surface: "repo", owner: "o", repo: "r" });
    expect(snap.partial).toBe(true);
  });

  it("reports a null MTTR rather than inventing a zero", async () => {
    getRepoDoraSummary.mockResolvedValue({
      ...doraFixture,
      mttr: { mean_ms: null, recoveries: 0, level: "high", label: "High" },
    });

    const { buildInsightsSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildInsightsSnapshot("tok", { surface: "repo", owner: "o", repo: "r" });
    expect(snap.dora?.mttr_mean_hours).toBeNull();
  });
});

// ── Org surface ───────────────────────────────────────────────────────────────

describe("buildInsightsSnapshot — org surface", () => {
  it("summarises the scorecard into bands and worst repos", async () => {
    const { buildInsightsSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildInsightsSnapshot("tok", { surface: "org", org: "acme" });

    expect(snap.surface).toBe("org");
    expect(snap.scope).toBe("acme");
    expect(snap.risk_bands).toEqual({ healthy: 1, watch: 1, at_risk: 1, median_score: 54 });
    expect(snap.worst_repos[0]).toEqual({
      repo: "alpha",
      score: 25,
      band: "at_risk",
      dora_level: "low",
    });
    expect(snap.bus_factor).toEqual({
      overall: 1,
      critical_modules: 6,
      total_contributors: 0,
    });
  });

  it("carries no forbidden keys", async () => {
    const { buildInsightsSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildInsightsSnapshot("tok", { surface: "org", org: "acme" });
    assertNoForbiddenKeys(snap);
  });

  it("caps worst_repos at five entries", async () => {
    computeScorecard.mockResolvedValue({
      ...scorecardFixture,
      repos: Array.from({ length: 12 }, (_, i) => ({
        ...scorecardFixture.repos[0],
        repo: `r${i}`,
        composite_score: i * 5,
      })),
      repos_analysed: 12,
      repos_attempted: 12,
    });

    const { buildInsightsSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildInsightsSnapshot("tok", { surface: "org", org: "acme" });
    expect(snap.worst_repos).toHaveLength(5);
    expect(snap.worst_repos[0].score).toBe(0);
  });

  it("marks partial when the scorecard could not score every repo", async () => {
    computeScorecard.mockResolvedValue({ ...scorecardFixture, repos_analysed: 2, repos_attempted: 3 });

    const { buildInsightsSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildInsightsSnapshot("tok", { surface: "org", org: "acme" });
    expect(snap.partial).toBe(true);
  });

  it("handles an org with no scoreable repos", async () => {
    computeScorecard.mockResolvedValue({ org: "acme", repos: [], repos_analysed: 0, repos_attempted: 0 });

    const { buildInsightsSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildInsightsSnapshot("tok", { surface: "org", org: "acme" });

    expect(snap.bus_factor).toBeNull();
    expect(snap.worst_repos).toEqual([]);
    expect(snap.risk_bands).toEqual({ healthy: 0, watch: 0, at_risk: 0, median_score: 0 });
  });
});

// ── Anomaly snapshot (v4.1.1) ─────────────────────────────────────────────────

/**
 * A run list carrying one deliberate duration outlier.
 *
 * Two constraints from src/lib/anomaly.ts that the fixture must respect:
 *   - runs arrive NEWEST-FIRST (as the GitHub API returns them), and detection
 *     is causal — a run is only flagged against runs that precede it in time,
 *     so the outlier has to sit at index 0 to have a baseline behind it;
 *   - baseline stddev must exceed 1ms, so the normal runs vary slightly.
 *     Identical durations are skipped as a false-positive guard.
 */
function makeRun(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: "CI",
    run_number: 1,
    status: "completed",
    conclusion: "success",
    created_at: "2026-08-01T10:00:00Z",
    run_started_at: "2026-08-01T10:00:05Z",
    updated_at: "2026-08-01T10:01:05Z",
    event: "push",
    actor: { login: "octocat", avatar_url: "" },
    triggering_actor: { login: "octocat", avatar_url: "" },
    head_branch: "main",
    head_sha: "abc",
    run_attempt: 1,
    html_url: "https://github.com/o/r/actions/runs/1",
    display_title: "some commit title that must not leak",
    ...over,
  };
}

function runsWithOutlier() {
  // Index 0 = newest = the outlier (30 min against a ~60s baseline).
  const outlier = makeRun({
    id: 999,
    run_number: 999,
    created_at: "2026-08-12T10:00:00Z",
    run_started_at: "2026-08-12T10:00:05Z",
    updated_at: "2026-08-12T10:30:05Z",
  });

  const baseline = Array.from({ length: 20 }, (_, i) =>
    makeRun({
      id: i + 1,
      run_number: i + 1,
      created_at: "2026-08-01T10:00:00Z",
      run_started_at: "2026-08-01T10:00:05Z",
      // 60s ± a few seconds so stddev clears the > 1ms guard.
      updated_at: `2026-08-01T10:01:${String(5 + (i % 7)).padStart(2, "0")}Z`,
    }),
  );

  return [outlier, ...baseline];
}

describe("buildAnomalySnapshot", () => {
  beforeEach(() => {
    listWorkflowRuns.mockReset().mockResolvedValue(runsWithOutlier());
  });

  it("returns the flagged outliers with baseline stats", async () => {
    const { buildAnomalySnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildAnomalySnapshot("tok", {
      owner: "o", repo: "r", workflowId: 7, metric: "duration",
    });

    expect(snap.repo).toBe("o/r");
    expect(snap.workflow_name).toBe("CI");
    expect(snap.metric).toBe("duration");
    expect(snap.baseline).not.toBeNull();
    expect(snap.outliers.length).toBeGreaterThan(0);
    expect(snap.outliers[0].run_number).toBe(999);
    expect(snap.total_runs_analysed).toBe(21);
  });

  it("carries no forbidden keys", async () => {
    const { buildAnomalySnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildAnomalySnapshot("tok", {
      owner: "o", repo: "r", workflowId: 7, metric: "duration",
    });
    assertNoForbiddenKeys(snap);
  });

  it("does not leak run titles, SHAs or URLs", async () => {
    const { buildAnomalySnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildAnomalySnapshot("tok", {
      owner: "o", repo: "r", workflowId: 7, metric: "duration",
    });
    const s = JSON.stringify(snap);
    expect(s).not.toContain("must not leak");
    expect(s).not.toContain("github.com");
  });

  it("caps outliers at five", async () => {
    // 10 slow runs (newest) against a 20-run varied baseline: every one of the
    // slow runs clears the threshold, so more than five are flagged.
    const slow = Array.from({ length: 10 }, (_, i) =>
      makeRun({
        id: 900 + i,
        run_number: 900 + i,
        created_at: `2026-08-${String(12 + i).padStart(2, "0")}T10:00:00Z`,
        run_started_at: "2026-08-12T10:00:05Z",
        updated_at: "2026-08-12T10:30:05Z",
      }),
    );
    const baseline = Array.from({ length: 20 }, (_, i) =>
      makeRun({
        id: i + 1,
        run_number: i + 1,
        updated_at: `2026-08-01T10:01:${String(5 + (i % 7)).padStart(2, "0")}Z`,
      }),
    );
    listWorkflowRuns.mockResolvedValue([...slow, ...baseline]);

    const { buildAnomalySnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildAnomalySnapshot("tok", {
      owner: "o", repo: "r", workflowId: 7, metric: "duration",
    });
    expect(snap.outliers.length).toBeLessThanOrEqual(5);
  });

  it("summarises the trigger mix", async () => {
    const { buildAnomalySnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildAnomalySnapshot("tok", {
      owner: "o", repo: "r", workflowId: 7, metric: "duration",
    });
    expect(snap.concurrent_signals.trigger_mix).toEqual({ push: 21 });
  });

  it("returns an empty snapshot rather than throwing when the run fetch fails", async () => {
    listWorkflowRuns.mockRejectedValue(new Error("rate limited"));

    const { buildAnomalySnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildAnomalySnapshot("tok", {
      owner: "o", repo: "r", workflowId: 7, metric: "duration",
    });

    expect(snap.outliers).toEqual([]);
    expect(snap.total_runs_analysed).toBe(0);
    expect(snap.workflow_name).toBe("workflow");
  });
});

// ── Root-cause snapshot (v4.1.2) ──────────────────────────────────────────────

describe("buildRootCauseSnapshot", () => {
  /** 5 failures (newest) then 10 successes, so there is a clear pattern. */
  function failingRuns() {
    const failures = Array.from({ length: 5 }, (_, i) =>
      makeRun({
        id: 500 + i,
        run_number: 500 + i,
        conclusion: "failure",
        created_at: `2026-08-${String(10 + i).padStart(2, "0")}T10:00:00Z`,
        updated_at: "2026-08-10T10:05:00Z",
      }),
    );
    const successes = Array.from({ length: 10 }, (_, i) =>
      makeRun({ id: i + 1, run_number: i + 1, conclusion: "success" }),
    );
    return [...failures, ...successes];
  }

  const jobsFixture = [
    {
      id: 1,
      name: "build",
      status: "completed",
      conclusion: "failure",
      duration_ms: 45_000,
      steps: [
        { name: "Checkout", status: "completed", conclusion: "success" },
        { name: "Run tests", status: "completed", conclusion: "failure" },
      ],
    },
    {
      id: 2,
      name: "lint",
      status: "completed",
      conclusion: "success",
      duration_ms: 9_000,
      steps: [{ name: "ESLint", status: "completed", conclusion: "success" }],
    },
  ];

  beforeEach(() => {
    listWorkflowRuns.mockReset().mockResolvedValue(failingRuns());
    listRunJobs.mockReset().mockResolvedValue(jobsFixture);
  });

  it("summarises failures, steps and clustering", async () => {
    const { buildRootCauseSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildRootCauseSnapshot("tok", { owner: "o", repo: "r", workflowId: 7 });

    expect(snap.repo).toBe("o/r");
    expect(snap.failure_count).toBe(5);
    expect(snap.run_count).toBe(15);
    expect(snap.failure_rate_pct).toBe(33);
    expect(snap.failures).toHaveLength(5);
    // Only the failed job is reported, and only its failed step.
    expect(snap.failures[0].failed_jobs).toEqual([
      { job_name: "build", failed_step_names: ["Run tests"], duration_ms: 45_000 },
    ]);
    expect(snap.step_failure_frequency[0]).toEqual({
      step_name: "Run tests",
      failure_count: 5,
      share_of_failures_pct: 100,
    });
    expect(snap.failure_clustering.same_step_share_pct).toBe(100);
  });

  it("carries no forbidden keys", async () => {
    const { buildRootCauseSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildRootCauseSnapshot("tok", { owner: "o", repo: "r", workflowId: 7 });
    assertNoForbiddenKeys(snap);
  });

  it("counts the success streak preceding the newest failure", async () => {
    // Newest-first: 2 successes, then failures.
    const runs = [
      makeRun({ id: 1, run_number: 1, conclusion: "success" }),
      makeRun({ id: 2, run_number: 2, conclusion: "success" }),
      ...Array.from({ length: 4 }, (_, i) =>
        makeRun({ id: 10 + i, run_number: 10 + i, conclusion: "failure" }),
      ),
    ];
    listWorkflowRuns.mockResolvedValue(runs);

    const { buildRootCauseSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildRootCauseSnapshot("tok", { owner: "o", repo: "r", workflowId: 7 });
    expect(snap.prior_success_streak).toBe(2);
  });

  it("inspects at most ten failed runs", async () => {
    listWorkflowRuns.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) =>
        makeRun({ id: i + 1, run_number: i + 1, conclusion: "failure" }),
      ),
    );

    const { buildRootCauseSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildRootCauseSnapshot("tok", { owner: "o", repo: "r", workflowId: 7 });

    expect(snap.failure_count).toBe(25);        // all counted
    expect(snap.failures).toHaveLength(10);     // but only ten fetched
    expect(listRunJobs).toHaveBeenCalledTimes(10);
  });

  it("flags partial when a job fetch fails, without dropping the snapshot", async () => {
    listRunJobs.mockRejectedValueOnce(new Error("rate limited"));

    const { buildRootCauseSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildRootCauseSnapshot("tok", { owner: "o", repo: "r", workflowId: 7 });

    expect(snap.partial).toBe(true);
    expect(snap.failures.length).toBe(4); // the other four still made it
  });

  it("computes a duration shift between passing and failing runs", async () => {
    const { buildRootCauseSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildRootCauseSnapshot("tok", { owner: "o", repo: "r", workflowId: 7 });
    expect(snap.duration_shift).not.toBeNull();
    expect(snap.duration_shift!.during_failures_p50_ms).toBeGreaterThan(0);
  });

  it("returns an empty snapshot rather than throwing when runs cannot be fetched", async () => {
    listWorkflowRuns.mockRejectedValue(new Error("boom"));

    const { buildRootCauseSnapshot } = await import("@/lib/ai-snapshots");
    const snap = await buildRootCauseSnapshot("tok", { owner: "o", repo: "r", workflowId: 7 });

    expect(snap.failure_count).toBe(0);
    expect(snap.failures).toEqual([]);
    expect(snap.partial).toBe(true);
  });
});
