import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getOctokit, listOrgRepos, getRepoSummary, type Repo, type RepoSummary } from "@/lib/github";
import { validateOrg, validatePerPage, safeError } from "@/lib/validation";

const CACHE_TTL = 900; // 15 min — this is an expensive multi-request call

// ── Response types ───────────────────────────────────────────────────────────

export interface OrgRepoSummary {
  repo: Repo;
  summary: RepoSummary;
  /** Number of workflows with recent activity */
  workflow_count: number;
}

export interface OrgOverviewResponse {
  org: string;
  /** Total repos in the org (including those without CI activity). */
  total_repos: number;
  /** Repos with at least one workflow run in the last 30 days. */
  active_repos: number;
  /** Aggregate metrics across all fetched repos. */
  aggregate: {
    total_runs: number;
    avg_success_rate: number;
  };
  /** Per-repo summaries (sorted by most recent activity). */
  repos: OrgRepoSummary[];
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  const orgResult = validateOrg(searchParams.get("org"));
  if (!orgResult.ok) return orgResult.response;
  const org = orgResult.data;

  // How many repos to fetch summaries for (default 20, max 50)
  const limitResult = validatePerPage(searchParams.get("limit"), 20);
  if (!limitResult.ok) return limitResult.response;
  const limit = Math.min(limitResult.data, 50);

  try {
    // 1. List all org repos (already sorted by updated desc)
    const allRepos = await listOrgRepos(token, org);
    const totalRepos = allRepos.length;

    // 2. Take top N most recently updated repos for summary fetching
    const topRepos = allRepos.slice(0, limit);

    // 3. Fetch workflow count + summary for each repo in parallel (batched 5 at a time)
    const octokit = getOctokit(token);
    const BATCH = 5;
    const results: OrgRepoSummary[] = [];

    for (let i = 0; i < topRepos.length; i += BATCH) {
      const batch = topRepos.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map(async (repo) => {
          // Fetch workflow count
          const { data: wfData } = await octokit.rest.actions.listRepoWorkflows({
            owner: org,
            repo: repo.name,
            per_page: 1,
          });

          // Fetch repo summary (last 30 runs, computes success rate + trend)
          const summary = await getRepoSummary(token, org, repo.name);

          return {
            repo,
            summary,
            workflow_count: wfData.total_count,
          } satisfies OrgRepoSummary;
        })
      );

      for (const s of settled) {
        if (s.status === "fulfilled") results.push(s.value);
      }
    }

    // 4. Compute aggregates
    const activeRepos = results.filter(
      (r) => r.summary.latest_run_at !== null
    ).length;

    const totalRuns = results.reduce(
      (sum, r) => sum + r.summary.recent_runs.length,
      0
    );

    const ratesWithData = results
      .filter((r) => r.summary.success_rate > 0 || r.summary.recent_runs.length > 0)
      .map((r) => r.summary.success_rate);

    const avgSuccessRate =
      ratesWithData.length > 0
        ? Math.round(
            ratesWithData.reduce((a, b) => a + b, 0) / ratesWithData.length
          )
        : 0;

    const response: OrgOverviewResponse = {
      org,
      total_repos: totalRepos,
      active_repos: activeRepos,
      aggregate: {
        total_runs: totalRuns,
        avg_success_rate: avgSuccessRate,
      },
      repos: results,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=1800`,
      },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch org overview");
  }
}
