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
    const startedAt = r.run_started_at ? new Date(r.run_started_at).getTime() : null;
    // Use completed_at (when the run actually finished) rather than updated_at
    // (which can drift forward whenever GitHub updates run metadata).
    // The Octokit type omits completed_at from listWorkflowRuns but the field
    // is present in the API response, so we cast through unknown to access it.
    const rawCompletedAt = (r as unknown as { completed_at?: string | null }).completed_at;
    const completedAt = rawCompletedAt ? new Date(rawCompletedAt).getTime() : null;
    const duration_ms =
      r.status === "completed" && startedAt && completedAt ? completedAt - startedAt : undefined;
    const queue_wait_ms = startedAt ? startedAt - createdAt : undefined;

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
