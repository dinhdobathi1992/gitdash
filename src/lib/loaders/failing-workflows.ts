import type { Repo, RepoSummary } from "@/lib/github";
import { pLimitSettled } from "@/lib/concurrency";
import { repoHealth } from "@/lib/repo-health";
import { validateOwner } from "@/lib/validation";
import { loadRepos } from "./repos";
import { loadRepoSummary } from "./repo-summary";
import { applyLabel, loaderOk, validationFailure, type LoaderOptions, type LoaderResult } from "./types";

/** Upper bound on repos inspected per call; each costs one summary fetch. */
export const FAILING_WORKFLOWS_MAX_REPOS = 25;
const CONCURRENCY = 5;

export interface FailingRepo {
  repo: string;
  url: string;
  latest_conclusion: string | null;
  latest_branch: string | null;
  latest_run_at: string | null;
  latest_message: string | null;
  success_rate: number;
}

export interface FailingWorkflowsResponse {
  failing: FailingRepo[];
  /** Repos whose summary was inspected. */
  checked: number;
  /** Repos in scope (all of them, or all under `owner`). */
  total: number;
  /** Inspected repos whose summary could not be loaded. */
  errors: number;
}

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

/**
 * Repos whose newest decisive run failed, worst first. Inspects at most
 * FAILING_WORKFLOWS_MAX_REPOS repos, most recently updated first, so the cost
 * of one call is bounded; `checked` and `total` let the caller say so.
 * Reuses the repos and repo-summary cache entries.
 */
export async function loadFailingWorkflows(
  token: string,
  owner?: string | null,
  opts?: LoaderOptions,
): Promise<LoaderResult<FailingWorkflowsResponse>> {
  applyLabel(opts);

  let validOwner: string | null = null;
  if (owner !== undefined && owner !== null && owner !== "") {
    const ownerResult = validateOwner(owner);
    if (!ownerResult.ok) return validationFailure(ownerResult);
    validOwner = ownerResult.data;
  }

  const reposResult = await loadRepos(token);
  if (!reposResult.ok) return reposResult;

  const inScope: Repo[] = validOwner
    ? reposResult.data.filter((r) => r.owner.toLowerCase() === validOwner.toLowerCase())
    : reposResult.data;
  const selected = [...inScope]
    .sort((a, b) => time(b.updated_at) - time(a.updated_at))
    .slice(0, FAILING_WORKFLOWS_MAX_REPOS);

  const settled = await pLimitSettled(
    selected.map((r) => async () => {
      const res = await loadRepoSummary(token, r.owner, r.name);
      if (!res.ok) throw new Error(res.error);
      return { repo: r, summary: res.data };
    }),
    { concurrency: CONCURRENCY },
  );

  const now = Date.now();
  const failing: Array<{ repo: Repo; summary: RepoSummary }> = [];
  let errors = 0;
  for (const s of settled) {
    if (s.status === "rejected") {
      errors++;
      continue;
    }
    if (repoHealth(s.value.summary, now).key === "failing") failing.push(s.value);
  }

  failing.sort(
    (a, b) =>
      a.summary.success_rate - b.summary.success_rate ||
      time(b.summary.latest_run_at) - time(a.summary.latest_run_at),
  );

  return loaderOk({
    failing: failing.map(({ repo, summary }) => ({
      repo: repo.full_name,
      url: repo.html_url,
      latest_conclusion: summary.latest_conclusion,
      latest_branch: summary.latest_branch ?? null,
      latest_run_at: summary.latest_run_at,
      latest_message: summary.latest_message,
      success_rate: summary.success_rate,
    })),
    checked: selected.length,
    total: inScope.length,
    errors,
  });
}
