/**
 * GET /api/github/runner-stats
 *
 * Aggregates GitHub Actions runner usage across a repo's recent workflow
 * runs: which runner groups/names actually execute jobs, how often, and how
 * long they take. The underlying data (job.runner_name, job.runner_group_name)
 * has always been fetched by listRunJobs — it was just never surfaced in the UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getOctokit, listRunJobs } from "@/lib/github";
import { validateOwner, validateRepo, validatePerPage, safeError } from "@/lib/validation";
import { withCache, hashKey } from "@/lib/cache";
import { pLimitSettled } from "@/lib/concurrency";

const CACHE_TTL = 300; // 5 min

export interface RunnerStat {
  runner_name: string;
  runner_group_name: string | null;
  job_count: number;
  success: number;
  failure: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
}

export interface RunnerStatsResponse {
  runners: RunnerStat[];
  total_jobs: number;
  unique_runners: number;
  partial: boolean;
  fetched_runs: number;
  total_runs: number;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.ceil(p * sorted.length) - 1];
}

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;
  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;
  const perPageResult = validatePerPage(searchParams.get("per_page"), 30);
  if (!perPageResult.ok) return perPageResult.response;

  const owner = ownerResult.data;
  const repo = repoResult.data;
  const perPage = Math.min(perPageResult.data, 50);

  try {
    const response = await withCache<RunnerStatsResponse>(
      `runner-stats:${hashKey(token)}:${owner}/${repo}:${perPage}`,
      CACHE_TTL,
      () => computeRunnerStats(token, owner, repo, perPage),
    );

    return NextResponse.json(response, {
      headers: { "Cache-Control": `private, max-age=${CACHE_TTL}, stale-while-revalidate=120` },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch runner statistics");
  }
}

async function computeRunnerStats(
  token: string,
  owner: string,
  repo: string,
  perPage: number,
): Promise<RunnerStatsResponse> {
  const octokit = getOctokit(token);

  const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    per_page: perPage,
    status: "completed",
  });
  const runs = data.workflow_runs;

  const jobResults = await pLimitSettled(
    runs.map((r) => () => listRunJobs(token, owner, repo, r.id)),
    { concurrency: 8 },
  );

  const fetched = jobResults.filter((r) => r.status === "fulfilled").length;
  const partial = fetched < runs.length;

  const byRunner = new Map<
    string,
    { group: string | null; durations: number[]; success: number; failure: number; jobCount: number }
  >();
  let totalJobs = 0;

  for (const result of jobResults) {
    if (result.status !== "fulfilled") continue;
    for (const job of result.value) {
      const name = job.runner_name ?? "(unassigned)";
      totalJobs++;
      if (!byRunner.has(name)) {
        byRunner.set(name, { group: job.runner_group_name, durations: [], success: 0, failure: 0, jobCount: 0 });
      }
      const entry = byRunner.get(name)!;
      entry.jobCount++;
      if (job.duration_ms !== null) entry.durations.push(job.duration_ms);
      if (job.conclusion === "success") entry.success++;
      else if (job.conclusion === "failure") entry.failure++;
    }
  }

  const runners: RunnerStat[] = Array.from(byRunner.entries())
    .map(([runner_name, v]) => {
      const sorted = [...v.durations].sort((a, b) => a - b);
      return {
        runner_name,
        runner_group_name: v.group,
        job_count: v.jobCount,
        success: v.success,
        failure: v.failure,
        avg_duration_ms: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
        p95_duration_ms: percentile(sorted, 0.95),
      };
    })
    .sort((a, b) => b.job_count - a.job_count);

  return {
    runners,
    total_jobs: totalJobs,
    unique_runners: runners.length,
    partial,
    fetched_runs: fetched,
    total_runs: runs.length,
  };
}
