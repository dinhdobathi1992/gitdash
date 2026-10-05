import { describe, it, expect } from "vitest";
import {
  buildRepoSummary, successRateLast10, toRunPoint, toWorkflowRun, trendByDay, windowFields,
  type RawWorkflowRun,
} from "@/lib/workflow-run-stats";
import { getRepoSummaryMain, listWorkflowRunsMain } from "./fixtures/github-runs-main";
import { sampleOctokit } from "./fixtures/sample-octokit";
import { SAMPLE_NOW, SAMPLE_REPO } from "@/lib/playground/source";

const NOW = Date.parse("2026-09-30T10:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;

let seq = 0;
function run(o: Partial<RawWorkflowRun> & { createdAgo: number; durMin?: number; queueMin?: number }): RawWorkflowRun {
  seq++;
  const created = NOW - o.createdAgo;
  const started = created + (o.queueMin ?? 1) * MIN;
  return {
    id: seq, name: "CI", status: o.status ?? "completed", conclusion: o.conclusion === undefined ? "success" : o.conclusion,
    created_at: new Date(created).toISOString(), updated_at: new Date(started + (o.durMin ?? 5) * MIN).toISOString(),
    run_started_at: new Date(started).toISOString(), head_branch: o.head_branch ?? "main", head_sha: `sha${seq}abcdef`,
    event: "push", actor: { login: "dev-a", avatar_url: "" }, run_number: seq, html_url: "", jobs_url: "",
    head_commit: { message: "feat: x\n\nbody", author: { name: "A", email: "a@example.com" } }, pull_requests: [],
  };
}

describe("toRunPoint", () => {
  it("computes duration for completed runs only, and queue wait", () => {
    const p = toRunPoint(run({ createdAgo: DAY, durMin: 7, queueMin: 2 }));
    expect(p.duration_ms).toBe(7 * MIN);
    expect(p.queue_ms).toBe(2 * MIN);
    expect(toRunPoint(run({ createdAgo: DAY, status: "in_progress", conclusion: null })).duration_ms).toBeNull();
    expect(toRunPoint({ ...run({ createdAgo: DAY }), run_started_at: null }).queue_ms).toBeNull();
  });
});

describe("windowFields", () => {
  it("success rate, run count and nearest-rank p95 over completed runs in the window", () => {
    const runs = [
      ...Array.from({ length: 19 }, (_, i) => run({ createdAgo: (i + 1) * DAY, durMin: i + 1 })),
      run({ createdAgo: 2 * DAY, durMin: 100, conclusion: "failure" }),
      run({ createdAgo: 40 * DAY, durMin: 999 }), // outside the 30-day window
      run({ createdAgo: MIN, status: "in_progress", conclusion: null }),
    ];
    const w = windowFields(runs.map(toRunPoint), NOW - 30 * DAY);
    expect(w.runs_30d).toBe(20);
    expect(w.success_rate_30d).toBe(95);
    expect(w.p95_duration_ms).toBe(19 * MIN); // ceil(0.95*20)-1 = index 18
  });
  it("is null when there are no completed runs", () => {
    expect(windowFields([], NOW).success_rate_30d).toBeNull();
    expect(windowFields([], NOW).p95_duration_ms).toBeNull();
  });
});

describe("successRateLast10 / trendByDay", () => {
  it("uses the 10 newest completed runs", () => {
    const runs = [
      run({ createdAgo: MIN, status: "in_progress", conclusion: null }),
      ...Array.from({ length: 8 }, (_, i) => run({ createdAgo: (i + 1) * DAY })),
      run({ createdAgo: 9 * DAY, conclusion: "failure" }),
      run({ createdAgo: 10 * DAY, conclusion: "failure" }),
      run({ createdAgo: 11 * DAY, conclusion: "failure" }), // 11th completed: ignored
    ];
    expect(successRateLast10(runs)).toBe(80);
    expect(successRateLast10([])).toBe(0);
  });
  it("buckets completed runs per UTC day since the cutoff", () => {
    const runs = [run({ createdAgo: 1 * DAY }), run({ createdAgo: 1 * DAY + MIN, conclusion: "failure" }), run({ createdAgo: 3 * DAY }), run({ createdAgo: 40 * DAY })];
    const t = trendByDay(runs, NOW - 30 * DAY);
    expect(t).toEqual([
      { date: new Date(NOW - 3 * DAY).toISOString().slice(0, 10), success: 1, total: 1 },
      { date: new Date(NOW - 1 * DAY).toISOString().slice(0, 10), success: 1, total: 2 },
    ]);
  });
});

describe("buildRepoSummary", () => {
  it("summarizes the latest run and windows", () => {
    const runs = [run({ createdAgo: MIN, head_branch: "feat/x" }), run({ createdAgo: DAY, conclusion: "failure" })];
    const s = buildRepoSummary(runs, NOW);
    expect(s).toMatchObject({ latest_branch: "feat/x", latest_conclusion: "success", latest_actor: "dev-a", latest_message: "feat: x", success_rate: 50, runs_30d: 2 });
    expect(s.latest_sha).toHaveLength(7);
    expect(s.recent_runs).toHaveLength(2);
  });
  it("handles no runs", () => {
    expect(buildRepoSummary([], NOW)).toMatchObject({ latest_run_at: null, success_rate: 0, runs_30d: 0, recent_runs: [] });
  });
});

describe("toWorkflowRun", () => {
  it("prefers completed_at, falls back to updated_at, and computes queue wait", () => {
    const r = run({ createdAgo: DAY, durMin: 5, queueMin: 3 });
    expect(toWorkflowRun(r)).toMatchObject({ duration_ms: 5 * MIN, queue_wait_ms: 3 * MIN, run_attempt: 1 });
    const completedAt = new Date(Date.parse(r.run_started_at!) + 9 * MIN).toISOString();
    expect(toWorkflowRun({ ...r, completed_at: completedAt } as RawWorkflowRun).duration_ms).toBe(9 * MIN);
    expect(toWorkflowRun({ ...r, status: "in_progress" }).duration_ms).toBeUndefined();
  });
});

describe("workflow runs: refactor preserves main's output", () => {
  it("repo summary over the sample runs equals the pre-extraction getRepoSummary", async () => {
    const octokit = sampleOctokit();
    const expected = await getRepoSummaryMain(octokit, SAMPLE_REPO.owner, SAMPLE_REPO.repo, SAMPLE_NOW);
    const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({ owner: "o", repo: "r", per_page: 30 });
    expect(buildRepoSummary(data.workflow_runs, SAMPLE_NOW)).toEqual(expected);
  });
  it("run mapping over the sample deploy runs equals the pre-extraction listWorkflowRuns", async () => {
    const octokit = sampleOctokit();
    const expected = await listWorkflowRunsMain(octokit, SAMPLE_REPO.owner, SAMPLE_REPO.repo, 7002, 50);
    const { data } = await octokit.rest.actions.listWorkflowRuns({ owner: "o", repo: "r", workflow_id: 7002, per_page: 50 });
    expect(data.workflow_runs.map(toWorkflowRun)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });
});
