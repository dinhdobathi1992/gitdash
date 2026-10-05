import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import { retry } from "@octokit/plugin-retry";
import { createHash } from "crypto";
import { recordGitHubCall } from "./github-telemetry";
import { buildRepoSummary, toWorkflowRun } from "./workflow-run-stats";

const OctokitWithPlugins = Octokit.plugin(throttling, retry);

// ── ETag conditional-request layer ───────────────────────────────────────────
// GitHub returns an ETag on every GET and does NOT count 304 responses against
// the rate limit. We remember { etag, data } per (token, url) and replay
// If-None-Match on the next identical request: unchanged data costs zero
// rate-limit budget. The `link` header is preserved so paginate.iterator
// still sees subsequent pages on a replayed first page.

interface EtagEntry {
  etag: string;
  link: string | undefined;
  data: unknown;
}

const etagStore = new Map<string, EtagEntry>();
const ETAG_MAX_ENTRIES = 1000;

function etagSet(key: string, entry: EtagEntry): void {
  // Refresh recency on rewrite; evict oldest when over the cap.
  if (etagStore.has(key)) etagStore.delete(key);
  else if (etagStore.size >= ETAG_MAX_ENTRIES) {
    const oldest = etagStore.keys().next().value;
    if (oldest !== undefined) etagStore.delete(oldest);
  }
  etagStore.set(key, entry);
}

// ── Per-token Octokit instances ──────────────────────────────────────────────
// Constructing Octokit composes the full plugin/hook chain — not free, and
// getOctokit is called per helper (~100× inside org-overview's fan-out).
// Instances are keyed by a token digest, never the raw token.

const octokitCache = new Map<string, Octokit>();
const OCTOKIT_MAX_INSTANCES = 100;

function noRateLimitWait(options: object): boolean {
  return (options as { request?: { noRateLimitWait?: boolean } }).request?.noRateLimitWait === true;
}

export function getOctokit(token?: string): Octokit {
  const pat = token || process.env.GITHUB_TOKEN;
  if (!pat) throw new Error("GitHub token not configured");

  const tokenKey = createHash("sha256").update(pat).digest("hex").slice(0, 16);
  const cached = octokitCache.get(tokenKey);
  if (cached) return cached;

  const octokit = new OctokitWithPlugins({
    auth: pat,
    throttle: {
      // Retry once after the advised wait; on the second hit, give up so the
      // route can surface a real error instead of hanging. A call made with
      // `request: { noRateLimitWait: true }` never waits: it fails at once and
      // its caller returns partial data (see team-contributors.ts).
      onRateLimit: (_retryAfter: number, options: object, _octokit: unknown, retryCount: number) =>
        retryCount < 1 && !noRateLimitWait(options),
      onSecondaryRateLimit: (_retryAfter: number, options: object, _octokit: unknown, retryCount: number) =>
        retryCount < 1 && !noRateLimitWait(options),
    },
    retry: {
      // Defaults plus 304: Not Modified is our ETag signal, not a failure.
      doNotRetry: [304, 400, 401, 403, 404, 422, 451],
    },
  });

  // Telemetry for every request + ETag layer for GET requests.
  octokit.hook.wrap("request", async (request, options) => {
    // Fully-resolved URL (path params substituted, query string appended).
    const resolvedUrl: string = octokit.request.endpoint(options as never).url;

    // Record the real GitHub exchange (including 304s, which carry the
    // rate-limit headers) before any ETag replay rewrites the response.
    const observed = async (opts: typeof options) => {
      try {
        const res = await request(opts);
        recordGitHubCall(tokenKey, opts.method, resolvedUrl, res.status, res.headers);
        return res;
      } catch (error) {
        const e = error as { status?: number; response?: { headers?: Record<string, string> } };
        recordGitHubCall(tokenKey, opts.method, resolvedUrl, e.status ?? 0, e.response?.headers);
        throw error;
      }
    };

    if (options.method !== "GET") return observed(options);

    const key = `${tokenKey}:${resolvedUrl}`;
    const prev = etagStore.get(key);
    if (prev) {
      options.headers = { ...options.headers, "if-none-match": prev.etag };
    }

    try {
      const response = await observed(options);
      const etag = response.headers?.etag;
      if (etag) {
        // Callers must not mutate response.data — all our helpers map to DTOs.
        etagSet(key, { etag, link: response.headers.link, data: response.data });
      }
      return response;
    } catch (error) {
      if (prev && (error as { status?: number }).status === 304) {
        // Synthesized response replaying the cached payload; double-cast
        // because plugin-retry augments OctokitResponse with extra fields.
        return {
          status: 200,
          url: resolvedUrl,
          headers: { etag: prev.etag, link: prev.link },
          data: prev.data,
        } as unknown as Awaited<ReturnType<typeof request>>;
      }
      throw error;
    }
  });

  if (octokitCache.size >= OCTOKIT_MAX_INSTANCES) {
    const oldest = octokitCache.keys().next().value;
    if (oldest !== undefined) octokitCache.delete(oldest);
  }
  octokitCache.set(tokenKey, octokit);
  return octokit;
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
  /** Completed runs only: updated_at − run_started_at. */
  duration_ms?: number | null;
  /** run_started_at − created_at, when both are known. */
  queue_ms?: number | null;
  head_branch?: string | null;
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
  /** Branch of the latest run. */
  latest_branch?: string | null;
  /** 0-100 over completed runs in the last 30 days (of the 30 most recent runs); null when none. */
  success_rate_30d?: number | null;
  /** Completed runs in the last 30 days (of the 30 most recent runs). */
  runs_30d?: number;
  /** p95 duration of completed runs in the last 30 days, ms; null when none. */
  p95_duration_ms?: number | null;
  /** Durations and queue waits for the fetched window, newest first — fleet KPIs aggregate these. */
  window_runs?: RepoRunPoint[];
}

// ── Run points shared by repo and workflow summaries ─────────────────────────
// The pure math lives in workflow-run-stats.ts (browser-safe, used by the
// public API playground); re-exported here so existing imports keep working.
export { toRunPoint, windowFields } from "./workflow-run-stats";

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

  return buildRepoSummary(data.workflow_runs);
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

        // Same summary as getRepoSummary
        const summary = buildRepoSummary(runs);

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

  return data.workflow_runs.map(toWorkflowRun);
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
