/**
 * Pure CI-health math over GitHub Actions workflow runs — the success rate,
 * 30-day window, p95 duration and the run → GitDash shape mapping.
 *
 * Input is the raw REST shape (`GET /repos/{owner}/{repo}/actions/runs` and
 * `…/actions/workflows/{id}/runs` → `workflow_runs[]`). No I/O and no
 * server-only imports, so the public API playground can run the exact same
 * code in the browser. src/lib/github.ts fetches and calls these.
 */

import type { RepoRunPoint, RepoSummary, TrendPoint, WorkflowRun } from "@/lib/github";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The fields of a REST workflow run the summary reads. */
export type ListedRun = {
  id: number;
  conclusion?: string | null;
  status?: string | null;
  created_at: string;
  updated_at: string;
  run_started_at?: string | null;
  head_branch?: string | null;
};

/** The fields of a REST workflow run the repo summary and the run mapping read. */
export interface RawWorkflowRun extends ListedRun {
  name?: string | null;
  display_title?: string | null;
  head_sha: string;
  event: string;
  actor?: { login: string; avatar_url: string } | null;
  triggering_actor?: { login: string; avatar_url: string } | null;
  run_number: number;
  run_attempt?: number;
  html_url: string;
  jobs_url: string;
  head_commit?: { message: string; author?: { name: string; email: string } | null } | null;
  pull_requests?: { number: number; url: string; head: { sha: string } }[] | null;
}

/** One run as a summary point, with duration (completed only) and queue wait. */
export function toRunPoint(r: ListedRun): RepoRunPoint {
  const created = new Date(r.created_at).getTime();
  const started = r.run_started_at ? new Date(r.run_started_at).getTime() : NaN;
  const updated = new Date(r.updated_at).getTime();
  return {
    id: r.id,
    conclusion: r.conclusion ?? null,
    status: r.status ?? null,
    created_at: r.created_at,
    duration_ms: r.status === "completed" && Number.isFinite(started) && updated >= started ? updated - started : null,
    queue_ms: Number.isFinite(started) && started >= created ? started - created : null,
    head_branch: r.head_branch ?? null,
  };
}

/** 30-day success rate, run count and p95 duration over completed runs since `cutoff`. */
export function windowFields(points: RepoRunPoint[], cutoff: number): Pick<RepoSummary, "success_rate_30d" | "runs_30d" | "p95_duration_ms" | "window_runs"> {
  const win = points.filter((p) => p.status === "completed" && new Date(p.created_at).getTime() >= cutoff);
  const pass = win.filter((p) => p.conclusion === "success").length;
  const durations = win.map((p) => p.duration_ms).filter((d): d is number => typeof d === "number").sort((a, b) => a - b);
  return {
    success_rate_30d: win.length ? Math.round((pass / win.length) * 1000) / 10 : null,
    runs_30d: win.length,
    p95_duration_ms: durations.length ? durations[Math.min(durations.length - 1, Math.ceil(0.95 * durations.length) - 1)] : null,
    window_runs: points,
  };
}

/** 0–100 success rate over the 10 most recent completed runs (newest-first input); 0 when none. */
export function successRateLast10(runs: ListedRun[]): number {
  const completed10 = runs.filter((r) => r.status === "completed").slice(0, 10);
  const successCount = completed10.filter((r) => r.conclusion === "success").length;
  return completed10.length ? Math.round((successCount / completed10.length) * 100) : 0;
}

/** Completed runs since `cutoff`, bucketed per calendar day (UTC date of created_at), oldest day first. */
export function trendByDay(runs: ListedRun[], cutoff: number): TrendPoint[] {
  const buckets: Record<string, { success: number; total: number }> = {};
  for (const r of runs) {
    const ts = new Date(r.created_at).getTime();
    if (ts < cutoff || r.status !== "completed") continue;
    const day = r.created_at.slice(0, 10);
    if (!buckets[day]) buckets[day] = { success: 0, total: 0 };
    buckets[day].total++;
    if (r.conclusion === "success") buckets[day].success++;
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { success, total }]) => ({ date, success, total }));
}

/**
 * Repo (or workflow) summary from one page of runs, newest first — what the
 * repositories table, pinned list and workflow cards show. `now` is injectable.
 */
export function buildRepoSummary(runs: RawWorkflowRun[], now: number = Date.now()): RepoSummary {
  const latest = runs[0] ?? null;
  const points = runs.map(toRunPoint);
  const cutoff = now - 30 * DAY_MS;
  return {
    ...windowFields(points, cutoff),
    latest_branch: latest?.head_branch ?? null,
    latest_conclusion: latest?.conclusion ?? null,
    latest_status: latest?.status ?? null,
    latest_run_at: latest?.created_at ?? null,
    latest_actor: latest?.actor?.login ?? null,
    latest_sha: latest?.head_sha?.slice(0, 7) ?? null,
    latest_message: latest?.head_commit?.message?.split("\n")[0] ?? null,
    recent_runs: points.slice(0, 10),
    trend_30d: trendByDay(runs, cutoff),
    success_rate: successRateLast10(runs),
  };
}

/** A REST workflow run in GitDash's WorkflowRun shape, with execution time and queue wait. */
export function toWorkflowRun(r: RawWorkflowRun): WorkflowRun {
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
  // duration_ms = pure execution time (first job started → completed), excluding queue wait.
  // Falls back to created_at if run_started_at is missing so we always have a value.
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
}
