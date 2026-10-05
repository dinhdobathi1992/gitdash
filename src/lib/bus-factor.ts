/**
 * Bus factor calculation — knowledge concentration risk per module and
 * repo-wide. Extracted from the bus-factor route (v4.0.0) so the Team
 * Health Scorecard can compute this per-repo without an internal HTTP
 * round trip; the route itself is now a thin cached wrapper around this.
 */

import type { Octokit } from "@octokit/rest";
import { cacheGet, cacheSet } from "@/lib/cache";
import { pLimitSettled } from "@/lib/concurrency";
import { calculateBusFactor, commitAuthor, commitFiles, type BusFactorResponse } from "./bus-factor-core";

const COMMIT_FILES_TTL = 7 * 24 * 3600;

// Types and the metric math live in bus-factor-core.ts (pure, shared with the
// public API playground). Re-exported so existing imports keep working.
export type { ModuleOwnership, BusFactorResponse } from "./bus-factor-core";

export async function computeBusFactor(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<BusFactorResponse> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // 1. List last 300 commits (3 pages). The listing already carries the
  //    author — the per-commit detail call is only needed for file paths.
  const listed: { sha: string; author: string }[] = [];
  for (let page = 1; page <= 3 && listed.length < 300; page++) {
    const { data } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      since: ninetyDaysAgo,
      per_page: 100,
      page,
    });
    if (data.length === 0) break;
    for (const c of data) {
      listed.push({
        sha: c.sha,
        author: commitAuthor(c),
      });
    }
  }

  // 2. Resolve file lists — from the immutable cache where possible, else
  //    fetch commit details with a bounded worker pool (no straggler waits).
  const commits: { author: string; files: string[] }[] = [];
  const misses: { sha: string; author: string }[] = [];

  for (const c of listed) {
    const files = cacheGet<string[]>(`commit-files:${owner}/${repo}:${c.sha}`);
    if (files) commits.push({ author: c.author, files });
    else misses.push(c);
  }

  const settled = await pLimitSettled(
    misses.map((c) => async () => {
      const { data: detail } = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: c.sha,
      });
      const files = commitFiles(detail);
      cacheSet(`commit-files:${owner}/${repo}:${c.sha}`, files, COMMIT_FILES_TTL);
      return { author: c.author, files };
    }),
    { concurrency: 10 },
  );
  let rejected = 0;
  for (const result of settled) {
    if (result.status === "fulfilled") commits.push(result.value);
    else rejected++;
  }
  const partial = rejected > 0;

  return {
    ...calculateBusFactor(commits),
    partial,
    fetched_commits: commits.length,
    total_commits_listed: listed.length,
  };
}
