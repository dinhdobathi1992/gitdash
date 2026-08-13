/**
 * Bus factor calculation — knowledge concentration risk per module and
 * repo-wide. Extracted from the bus-factor route (v4.0.0) so the Team
 * Health Scorecard can compute this per-repo without an internal HTTP
 * round trip; the route itself is now a thin cached wrapper around this.
 */

import type { Octokit } from "@octokit/rest";
import { cacheGet, cacheSet } from "@/lib/cache";
import { pLimitSettled } from "@/lib/concurrency";

const COMMIT_FILES_TTL = 7 * 24 * 3600;

export interface ModuleOwnership {
  /** Directory path prefix (e.g. "src/lib", "src/components") */
  module: string;
  /** Contributors and their commit share */
  contributors: { login: string; commits: number; pct: number }[];
  /** Number of unique contributors */
  unique_contributors: number;
  /** Bus factor (contributors needed for >=80% of commits) */
  bus_factor: number;
  /** Total commits in this module */
  total_commits: number;
  /** Risk level */
  risk: "critical" | "warning" | "healthy";
}

export interface BusFactorResponse {
  modules: ModuleOwnership[];
  /** Overall repo bus factor */
  overall_bus_factor: number;
  /** Total commits analysed */
  total_commits: number;
  /** Modules with bus factor = 1 (critical risk) */
  critical_modules: number;
  /** Total unique contributors across all modules */
  total_contributors: number;
  /** True if some commit detail fetches were rate-limited or failed */
  partial: boolean;
  /** Commits successfully resolved to a file list */
  fetched_commits: number;
  /** Commits listed (fetched_commits <= total_commits_listed when partial) */
  total_commits_listed: number;
}

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
        author: c.author?.login ?? c.commit?.author?.name ?? "unknown",
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
      const files = (detail.files ?? []).map((f) => f.filename);
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

  if (commits.length === 0) {
    return {
      modules: [],
      overall_bus_factor: 0,
      total_commits: 0,
      critical_modules: 0,
      total_contributors: 0,
      partial,
      fetched_commits: 0,
      total_commits_listed: listed.length,
    };
  }

  // ── Group commits by module (top-2 directory level) ─────────────────────
  // e.g. "src/lib/dora.ts" → "src/lib"
  // e.g. ".github/workflows/ci.yml" → ".github/workflows"
  function getModule(filePath: string): string {
    const parts = filePath.split("/");
    if (parts.length <= 1) return "(root)";
    if (parts.length === 2) return parts[0];
    return `${parts[0]}/${parts[1]}`;
  }

  const moduleMap = new Map<string, Map<string, number>>();
  const allContributors = new Set<string>();

  for (const commit of commits) {
    allContributors.add(commit.author);
    const seenModules = new Set<string>();
    for (const file of commit.files) {
      const mod = getModule(file);
      if (seenModules.has(mod)) continue; // count each module once per commit
      seenModules.add(mod);

      if (!moduleMap.has(mod)) moduleMap.set(mod, new Map());
      const authorMap = moduleMap.get(mod)!;
      authorMap.set(commit.author, (authorMap.get(commit.author) ?? 0) + 1);
    }
  }

  // ── Compute per-module bus factor ───────────────────────────────────────
  const modules: ModuleOwnership[] = [];

  for (const [mod, authorMap] of moduleMap) {
    const totalCommits = Array.from(authorMap.values()).reduce((s, c) => s + c, 0);
    const contributors = Array.from(authorMap.entries())
      .map(([login, commitCount]) => ({
        login,
        commits: commitCount,
        pct: Math.round((commitCount / totalCommits) * 100),
      }))
      .sort((a, b) => b.commits - a.commits);

    // Bus factor: contributors needed for >= 80% of commits
    let cumulative = 0;
    let busFactor = 0;
    for (const c of contributors) {
      cumulative += c.commits;
      busFactor++;
      if (cumulative >= totalCommits * 0.8) break;
    }

    const risk: ModuleOwnership["risk"] =
      busFactor <= 1 ? "critical" : busFactor <= 2 ? "warning" : "healthy";

    modules.push({
      module: mod,
      contributors: contributors.slice(0, 5), // top 5 per module
      unique_contributors: contributors.length,
      bus_factor: busFactor,
      total_commits: totalCommits,
      risk,
    });
  }

  // Sort: critical first, then by total commits descending
  modules.sort((a, b) => {
    const riskOrder = { critical: 0, warning: 1, healthy: 2 };
    if (riskOrder[a.risk] !== riskOrder[b.risk]) {
      return riskOrder[a.risk] - riskOrder[b.risk];
    }
    return b.total_commits - a.total_commits;
  });

  // Overall bus factor (across all commits, by author)
  const overallAuthorMap = new Map<string, number>();
  for (const commit of commits) {
    overallAuthorMap.set(commit.author, (overallAuthorMap.get(commit.author) ?? 0) + 1);
  }
  const overallSorted = Array.from(overallAuthorMap.entries()).sort(
    ([, a], [, b]) => b - a
  );
  let overallCum = 0;
  let overallBf = 0;
  for (const [, count] of overallSorted) {
    overallCum += count;
    overallBf++;
    if (overallCum >= commits.length * 0.8) break;
  }

  return {
    modules: modules.slice(0, 30), // cap at 30 modules
    overall_bus_factor: overallBf,
    total_commits: commits.length,
    critical_modules: modules.filter((m) => m.risk === "critical").length,
    total_contributors: allContributors.size,
    partial,
    fetched_commits: commits.length,
    total_commits_listed: listed.length,
  };
}
