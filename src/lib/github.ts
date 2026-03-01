import { Octokit } from "@octokit/rest";

export function getOctokit(token?: string): Octokit {
  const pat = token || process.env.GITHUB_TOKEN;
  if (!pat) throw new Error("GitHub token not configured");
  return new Octokit({ auth: pat });
}

export interface Repo {
  id: number;
  owner: string;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  updated_at: string | null;
  language: string | null;
  stargazers_count: number;
}

export interface Workflow {
  id: number;
  name: string;
  state: string;
  path: string;
  badge_url: string;
  html_url: string;
}

export interface WorkflowRun {
  id: number;
  name: string | null;
  display_title: string | null;
  status: string | null;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  run_started_at?: string | null;
  head_branch: string | null;
  head_sha: string;
  event: string;
  actor: { login: string; avatar_url: string } | null;
  triggering_actor: { login: string; avatar_url: string } | null;
  run_number: number;
  run_attempt: number;
  html_url: string;
  jobs_url: string;
  // computed
  duration_ms?: number;
  queue_wait_ms?: number;
  // extra fields
  head_commit: {
    message: string;
    author: { name: string; email: string } | null;
  } | null;
  pull_requests: { number: number; url: string; head_sha: string }[];
}

export interface WorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  runner_name: string | null;
  runner_group_name: string | null;
  duration_ms: number | null;
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}

// ── Aggregated types returned by /api/github/job-stats ──────────────────────

export interface JobStat {
  name: string;
  runs: number;
  success: number;
  failure: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
}

export interface StepStat {
  job: string;
  step: string;
  runs: number;
  success: number;
  avg_ms: number;
  p95_ms: number;
  max_ms: number;
}

export interface JobStatsResponse {
  jobs: JobStat[];
  steps: StepStat[];
  // per-run job breakdown for the waterfall (last 20 runs)
  waterfall: {
    run_number: number;
    jobs: { name: string; duration_ms: number; conclusion: string | null }[];
  }[];
}

// ── Repo summary (cross-workflow aggregate for the home table) ────────────────

export interface RepoRunPoint {
  id: number;
  conclusion: string | null;
  status: string | null;
  created_at: string;
}

export interface TrendPoint {
  date: string;   // "YYYY-MM-DD"
  success: number;
  total: number;
}

export interface RepoSummary {
  latest_conclusion: string | null;
  latest_status: string | null;
  latest_run_at: string | null;
  latest_actor: string | null;
  latest_sha: string | null;
  latest_message: string | null;
  recent_runs: RepoRunPoint[];   // last 10
  trend_30d: TrendPoint[];       // one bucket per calendar day (last 30 days)
  success_rate: number;          // 0-100, last 10 completed runs
}

export async function getRepoSummary(
  token: string,
  owner: string,
  repo: string
): Promise<RepoSummary> {
  const octokit = getOctokit(token);

  const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    per_page: 30,
  });

  const runs = data.workflow_runs;

  // Latest run (first in list, most recent)
  const latest = runs[0] ?? null;

  // Recent 10 for history bars
  const recent_runs: RepoRunPoint[] = runs.slice(0, 10).map((r) => ({
    id: r.id,
    conclusion: r.conclusion ?? null,
    status: r.status ?? null,
    created_at: r.created_at,
  }));

  // Success rate over last 10 completed runs
  const completed10 = runs.filter((r) => r.status === "completed").slice(0, 10);
  const successCount = completed10.filter((r) => r.conclusion === "success").length;
  const success_rate = completed10.length
    ? Math.round((successCount / completed10.length) * 100)
    : 0;

  // 30-day trend — bucket by calendar day
  const now = Date.now();
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const buckets: Record<string, { success: number; total: number }> = {};

  for (const r of runs) {
    const ts = new Date(r.created_at).getTime();
    if (ts < cutoff) continue;
    if (r.status !== "completed") continue;
    const day = r.created_at.slice(0, 10);
    if (!buckets[day]) buckets[day] = { success: 0, total: 0 };
    buckets[day].total++;
    if (r.conclusion === "success") buckets[day].success++;
  }

  const trend_30d: TrendPoint[] = Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { success, total }]) => ({ date, success, total }));

  return {
    latest_conclusion: latest?.conclusion ?? null,
    latest_status: latest?.status ?? null,
    latest_run_at: latest?.created_at ?? null,
    latest_actor: latest?.actor?.login ?? null,
    latest_sha: latest?.head_sha?.slice(0, 7) ?? null,
    latest_message: latest?.head_commit?.message?.split("\n")[0] ?? null,
    recent_runs,
    trend_30d,
    success_rate,
  };
}

// ── Workflow-level overview (for repo detail page) ────────────────────────────

export interface WorkflowDurPoint {
  created_at: string;
  duration_ms: number;
}

export interface WorkflowOverview {
  id: number;
  name: string;
  state: string;
  path: string;
  summary: RepoSummary;
  dur_points: WorkflowDurPoint[];  // last 20 completed runs, chronological
}

/** Fetch all workflows (≤10) + recent runs for each, return per-workflow overview */
export async function getRepoOverview(
  token: string,
  owner: string,
  repo: string
): Promise<WorkflowOverview[]> {
  const octokit = getOctokit(token);

  // 1. List workflows (cap at 10)
  const { data: wfData } = await octokit.rest.actions.listRepoWorkflows({
    owner, repo, per_page: 10,
  });
  const workflows = wfData.workflows.slice(0, 10);

  // 2. Fetch last 20 runs per workflow in parallel (5 at a time)
  const BATCH = 5;
  const results: WorkflowOverview[] = [];

  for (let i = 0; i < workflows.length; i += BATCH) {
    const batch = workflows.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async (wf) => {
        const { data: runsData } = await octokit.rest.actions.listWorkflowRuns({
          owner, repo, workflow_id: wf.id, per_page: 20,
        });
        const runs = runsData.workflow_runs;

        // Build summary (same logic as getRepoSummary)
        const latest = runs[0] ?? null;
        const recent_runs: RepoRunPoint[] = runs.slice(0, 10).map((r) => ({
          id: r.id,
          conclusion: r.conclusion ?? null,
          status: r.status ?? null,
          created_at: r.created_at,
        }));

        const completed10 = runs.filter((r) => r.status === "completed").slice(0, 10);
        const successCount = completed10.filter((r) => r.conclusion === "success").length;
        const success_rate = completed10.length
          ? Math.round((successCount / completed10.length) * 100)
          : 0;

        const now = Date.now();
        const cutoff = now - 30 * 24 * 60 * 60 * 1000;
        const buckets: Record<string, { success: number; total: number }> = {};
        for (const r of runs) {
          const ts = new Date(r.created_at).getTime();
          if (ts < cutoff || r.status !== "completed") continue;
          const day = r.created_at.slice(0, 10);
          if (!buckets[day]) buckets[day] = { success: 0, total: 0 };
          buckets[day].total++;
          if (r.conclusion === "success") buckets[day].success++;
        }
        const trend_30d: TrendPoint[] = Object.entries(buckets)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, { success, total }]) => ({ date, success, total }));

        const summary: RepoSummary = {
          latest_conclusion: latest?.conclusion ?? null,
          latest_status: latest?.status ?? null,
          latest_run_at: latest?.created_at ?? null,
          latest_actor: latest?.actor?.login ?? null,
          latest_sha: latest?.head_sha?.slice(0, 7) ?? null,
          latest_message: latest?.head_commit?.message?.split("\n")[0] ?? null,
          recent_runs,
          trend_30d,
          success_rate,
        };

        // Build duration points for chart (completed runs only, chronological)
        const dur_points: WorkflowDurPoint[] = runs
          .filter((r) => r.status === "completed")
          .map((r) => {
            const rawCompletedAt = (r as unknown as { completed_at?: string | null }).completed_at;
            const startedAt = r.run_started_at
              ? new Date(r.run_started_at).getTime()
              : new Date(r.created_at).getTime();
            const completedAt = rawCompletedAt
              ? new Date(rawCompletedAt).getTime()
              : new Date(r.updated_at).getTime();
            return { created_at: r.created_at, duration_ms: completedAt - startedAt };
          })
          .filter((p) => p.duration_ms > 0)
          .reverse(); // oldest first

        return { id: wf.id, name: wf.name, state: wf.state, path: wf.path, summary, dur_points };
      })
    );

    for (const s of settled) {
      if (s.status === "fulfilled") results.push(s.value);
    }
  }

  return results;
}

// ── Types for orgs ───────────────────────────────────────────────────────────

export interface GitHubOrg {
  login: string;
  avatar_url: string;
  description: string | null;
}

// ── API functions ────────────────────────────────────────────────────────────

function mapRepo(r: {
  id: number; owner: { login: string }; name: string; full_name: string;
  description: string | null; private: boolean; html_url: string;
  updated_at?: string | null; language?: string | null; stargazers_count?: number;
}): Repo {
  return {
    id: r.id,
    owner: r.owner.login,
    name: r.name,
    full_name: r.full_name,
    description: r.description ?? null,
    private: r.private,
    html_url: r.html_url,
    updated_at: r.updated_at ?? null,
    language: r.language ?? null,
    stargazers_count: r.stargazers_count ?? 0,
  };
}

/** All repos the authenticated user can access (personal + org, mixed) */
export async function listRepos(token: string): Promise<Repo[]> {
  const octokit = getOctokit(token);
  const repos: Repo[] = [];
  for await (const page of octokit.paginate.iterator(
    octokit.rest.repos.listForAuthenticatedUser,
    // type: "all" includes org repos the user is a member of.
    // The default ("owner") only returns repos the user personally owns —
    // which is empty for users who keep all repos under orgs.
    { per_page: 100, sort: "updated", direction: "desc", type: "all" }
  )) {
    for (const r of page.data) repos.push(mapRepo(r));
  }
  return repos;
}

/** Repos belonging to a specific org — respects team membership visibility */
export async function listOrgRepos(token: string, org: string): Promise<Repo[]> {
  const octokit = getOctokit(token);
  const repos: Repo[] = [];
  for await (const page of octokit.paginate.iterator(
    octokit.rest.repos.listForOrg,
    { org, per_page: 100, sort: "updated", direction: "desc", type: "all" }
  )) {
    for (const r of page.data) repos.push(mapRepo(r as Parameters<typeof mapRepo>[0]));
  }
  return repos;
}

/** Orgs the authenticated user belongs to */
export async function listUserOrgs(token: string): Promise<GitHubOrg[]> {
  const octokit = getOctokit(token);
  const { data } = await octokit.rest.orgs.listForAuthenticatedUser({ per_page: 100 });
  return data.map((o) => ({
    login: o.login,
    avatar_url: o.avatar_url,
    description: o.description ?? null,
  }));
}

export async function listWorkflows(
  token: string,
  owner: string,
  repo: string
): Promise<Workflow[]> {
  const octokit = getOctokit(token);
  const { data } = await octokit.rest.actions.listRepoWorkflows({
    owner,
    repo,
    per_page: 100,
  });
  return data.workflows.map((w) => ({
    id: w.id,
    name: w.name,
    state: w.state,
    path: w.path,
    badge_url: w.badge_url,
    html_url: w.html_url,
  }));
}

export async function listWorkflowRuns(
  token: string,
  owner: string,
  repo: string,
  workflow_id: number,
  per_page = 50
): Promise<WorkflowRun[]> {
  const octokit = getOctokit(token);
  const { data } = await octokit.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id,
    per_page,
  });

  return data.workflow_runs.map((r) => {
    const createdAt = new Date(r.created_at).getTime();
    // Prefer run_started_at; fall back to created_at so queue_wait is always computable.
    const startedAt = r.run_started_at
      ? new Date(r.run_started_at).getTime()
      : new Date(r.created_at).getTime();
    // completed_at is present in the REST response but the Octokit v22 type omits it.
    // Cast through unknown to read it; fall back to updated_at for completed runs
    // (GitHub sets updated_at = finish time for completed runs, making it a reliable proxy).
    const rawCompletedAt = (r as unknown as { completed_at?: string | null }).completed_at;
    const completedAt = rawCompletedAt
      ? new Date(rawCompletedAt).getTime()
      : r.status === "completed" ? new Date(r.updated_at).getTime() : null;
    const duration_ms =
      r.status === "completed" && completedAt ? completedAt - startedAt : undefined;
    const queue_wait_ms = r.run_started_at
      ? new Date(r.run_started_at).getTime() - createdAt
      : undefined;

    return {
      id: r.id,
      name: r.name ?? null,
      display_title: r.display_title ?? null,
      status: r.status ?? null,
      conclusion: r.conclusion ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      run_started_at: r.run_started_at ?? null,
      head_branch: r.head_branch ?? null,
      head_sha: r.head_sha,
      event: r.event,
      actor: r.actor ? { login: r.actor.login, avatar_url: r.actor.avatar_url } : null,
      triggering_actor: r.triggering_actor
        ? { login: r.triggering_actor.login, avatar_url: r.triggering_actor.avatar_url }
        : null,
      run_number: r.run_number,
      run_attempt: r.run_attempt ?? 1,
      html_url: r.html_url,
      jobs_url: r.jobs_url,
      duration_ms,
      queue_wait_ms,
      head_commit: r.head_commit
        ? {
            message: r.head_commit.message,
            author: r.head_commit.author
              ? { name: r.head_commit.author.name, email: r.head_commit.author.email }
              : null,
          }
        : null,
      pull_requests: (r.pull_requests ?? []).map((pr) => ({
        number: pr.number,
        url: pr.url,
        head_sha: pr.head.sha,
      })),
    };
  });
}

export async function listRunJobs(
  token: string,
  owner: string,
  repo: string,
  run_id: number
): Promise<WorkflowJob[]> {
  const octokit = getOctokit(token);
  const { data } = await octokit.rest.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id,
    per_page: 100,
  });
  return data.jobs.map((j) => {
    const jStart = j.started_at ? new Date(j.started_at).getTime() : null;
    const jEnd = j.completed_at ? new Date(j.completed_at).getTime() : null;
    const duration_ms = jStart && jEnd ? jEnd - jStart : null;

    return {
      id: j.id,
      name: j.name,
      status: j.status,
      conclusion: j.conclusion ?? null,
      started_at: j.started_at ?? null,
      completed_at: j.completed_at ?? null,
      runner_name: j.runner_name ?? null,
      runner_group_name: j.runner_group_name ?? null,
      duration_ms,
      steps: (j.steps ?? []).map((s) => {
        const sStart = s.started_at ? new Date(s.started_at).getTime() : null;
        const sEnd = s.completed_at ? new Date(s.completed_at).getTime() : null;
        return {
          name: s.name,
          status: s.status,
          conclusion: s.conclusion ?? null,
          number: s.number,
          started_at: s.started_at ?? null,
          completed_at: s.completed_at ?? null,
          duration_ms: sStart && sEnd ? sEnd - sStart : null,
        };
      }),
    };
  });
}

// ── Server-side job aggregation ──────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.ceil(p * sorted.length) - 1];
}

export async function getJobStats(
  token: string,
  owner: string,
  repo: string,
  workflow_id: number,
  per_page = 50
): Promise<JobStatsResponse> {
  // Fetch runs first
  const runs = await listWorkflowRuns(token, owner, repo, workflow_id, per_page);
  const completedRuns = runs.filter((r) => r.status === "completed");

  // Fetch jobs for each run in parallel (batched 8 at a time)
  type RunJobs = { run: WorkflowRun; jobs: WorkflowJob[] };
  const runJobs: RunJobs[] = [];
  const batches: WorkflowRun[][] = [];
  for (let i = 0; i < completedRuns.length; i += 8)
    batches.push(completedRuns.slice(i, i + 8));

  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map(async (r) => ({
        run: r,
        jobs: await listRunJobs(token, owner, repo, r.id),
      }))
    );
    for (const res of results) {
      if (res.status === "fulfilled") runJobs.push(res.value);
    }
  }

  // Aggregate per-job stats
  const jobMap: Record<string, number[]> = {};
  const jobFail: Record<string, number> = {};
  const jobSuccess: Record<string, number> = {};

  const stepMap: Record<string, number[]> = {};
  const stepFail: Record<string, number> = {};
  const stepSuccess: Record<string, number> = {};
  const stepJobName: Record<string, string> = {};

  for (const { jobs } of runJobs) {
    for (const job of jobs) {
      if (!jobMap[job.name]) { jobMap[job.name] = []; jobFail[job.name] = 0; jobSuccess[job.name] = 0; }
      if (job.duration_ms !== null) jobMap[job.name].push(job.duration_ms);
      if (job.conclusion === "success") jobSuccess[job.name]++;
      else if (job.conclusion === "failure") jobFail[job.name]++;

      for (const step of job.steps) {
        const key = `${job.name}::${step.name}`;
        if (!stepMap[key]) { stepMap[key] = []; stepFail[key] = 0; stepSuccess[key] = 0; stepJobName[key] = job.name; }
        if (step.duration_ms !== null) stepMap[key].push(step.duration_ms);
        if (step.conclusion === "success") stepSuccess[key]++;
        else if (step.conclusion === "failure") stepFail[key]++;
      }
    }
  }

  const jobs: JobStat[] = Object.entries(jobMap).map(([name, durations]) => {
    const sorted = [...durations].sort((a, b) => a - b);
    const runs = (jobSuccess[name] ?? 0) + (jobFail[name] ?? 0);
    return {
      name,
      runs,
      success: jobSuccess[name] ?? 0,
      failure: jobFail[name] ?? 0,
      avg_ms: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
      p50_ms: percentile(sorted, 0.5),
      p95_ms: percentile(sorted, 0.95),
      max_ms: sorted[sorted.length - 1] ?? 0,
    };
  });

  const steps: StepStat[] = Object.entries(stepMap).map(([key, durations]) => {
    // Key is `jobName::stepName`. Split only on the first `::` so step names
    // that themselves contain `::` (e.g. "Set up: node::cache") are preserved.
    const sepIdx = key.indexOf("::");
    const stepName = sepIdx >= 0 ? key.slice(sepIdx + 2) : key;
    const sorted = [...durations].sort((a, b) => a - b);
    const runs = (stepSuccess[key] ?? 0) + (stepFail[key] ?? 0);
    return {
      job: stepJobName[key],
      step: stepName,
      runs,
      success: stepSuccess[key] ?? 0,
      avg_ms: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
      p95_ms: percentile(sorted, 0.95),
      max_ms: sorted[sorted.length - 1] ?? 0,
    };
  });

  // Waterfall: last 20 runs
  const waterfall = runJobs.slice(0, 20).map(({ run, jobs }) => ({
    run_number: run.run_number,
    jobs: jobs
      .filter((j) => j.duration_ms !== null)
      .map((j) => ({
        name: j.name,
        duration_ms: j.duration_ms!,
        conclusion: j.conclusion,
      })),
  }));

  return { jobs, steps, waterfall };
}

// ── Audit Trail: workflow file change history ─────────────────────────────────

export interface WorkflowFileCommit {
  sha: string;
  message: string;
  author_login: string | null;
  author_avatar: string | null;
  author_name: string | null;
  date: string;
  html_url: string;
  /** Which workflow file was changed (e.g. ".github/workflows/ci.yml"). */
  file_path: string;
}

/**
 * Fetch commits that modified workflow files under `.github/workflows/`.
 *
 * Uses `repos.listCommits` with `path` filter for each workflow file path.
 * Falls back to listing the `.github/workflows` directory first.
 *
 * Returns up to `limit` most recent commits, deduplicated by SHA.
 */
export async function listWorkflowFileCommits(
  token: string,
  owner: string,
  repo: string,
  limit: number = 30,
): Promise<WorkflowFileCommit[]> {
  const octokit = getOctokit(token);

  // Step 1: List workflow files
  let workflowPaths: string[] = [];
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: ".github/workflows",
    });
    if (Array.isArray(data)) {
      workflowPaths = data
        .filter((f) => f.type === "file" && /\.(ya?ml)$/i.test(f.name))
        .map((f) => f.path);
    }
  } catch {
    // Directory doesn't exist or no access — return empty
    return [];
  }

  if (workflowPaths.length === 0) return [];

  // Step 2: Fetch commits for each workflow file (parallel, capped)
  const perFile = Math.max(5, Math.ceil(limit / workflowPaths.length));
  const commitsByFile = await Promise.allSettled(
    workflowPaths.map(async (filePath) => {
      const { data: commits } = await octokit.rest.repos.listCommits({
        owner,
        repo,
        path: filePath,
        per_page: perFile,
      });
      return commits.map((c): WorkflowFileCommit => ({
        sha: c.sha,
        message: (c.commit.message ?? "").split("\n")[0],
        author_login: c.author?.login ?? null,
        author_avatar: c.author?.avatar_url ?? null,
        author_name: c.commit.author?.name ?? null,
        date: c.commit.author?.date ?? c.commit.committer?.date ?? "",
        html_url: c.html_url,
        file_path: filePath,
      }));
    }),
  );

  // Step 3: Merge, deduplicate by SHA (same commit may touch multiple files), sort by date
  const seen = new Set<string>();
  const all: WorkflowFileCommit[] = [];
  for (const result of commitsByFile) {
    if (result.status === "fulfilled") {
      for (const c of result.value) {
        if (!seen.has(c.sha)) {
          seen.add(c.sha);
          all.push(c);
        }
      }
    }
  }

  all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return all.slice(0, limit);
}
