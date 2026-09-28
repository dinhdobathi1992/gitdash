/**
 * GET /api/cron/sync-commit-facts
 *
 * Nightly working-habits sync: stores each merged PR's commits with their
 * size (src/lib/commit-facts-sync.ts), then evaluates the
 * oversized_commit_pct alert for that repo so it always sees fresh data.
 *
 * Scheduled 30 minutes after /api/cron/sync-pr-facts (vercel.json) so the
 * night's new PRs are already in pr_facts. Own route, own 300 s budget: it
 * never delays the PR-facts sync. It stops starting new work at 240 s; the
 * remaining PRs are picked up on the next run.
 *
 * Auth: same CRON_SECRET bearer pattern as the other crons.
 * Identity: GITHUB_TOKEN service identity.
 * Repos: listSyncedRepos() — the same tracked set as sync-pr-facts.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOctokit } from "@/lib/github";
import { syncPrCommitFacts, type CommitFactsSyncResult } from "@/lib/commit-facts-sync";
import { evaluateAlertRulesForRepo, listSyncedRepos } from "@/lib/db";
import { pLimitSettled } from "@/lib/concurrency";
import { labelGitHubRoute } from "@/lib/github-telemetry";

export const maxDuration = 300;

/** Stop starting new chunks after this, leaving headroom before maxDuration. */
const WORK_BUDGET_MS = 240_000;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  labelGitHubRoute("cron/sync-commit-facts");
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json({ error: "GITHUB_TOKEN not set" }, { status: 500 });
  }

  const deadline = Date.now() + WORK_BUDGET_MS;
  const octokit = getOctokit(process.env.GITHUB_TOKEN);
  const tracked = await listSyncedRepos();

  const results = await pLimitSettled(
    tracked.map(({ repo }) => async () => {
      const [owner, repoName] = repo.split("/");
      const synced = await syncPrCommitFacts(octokit, owner, repoName, deadline);
      let alertsFired = 0;
      try {
        alertsFired = await evaluateAlertRulesForRepo(repo, { only: ["oversized_commit_pct"] });
      } catch (err) {
        console.error(`[commit-facts] alert evaluation failed for ${repo}:`, err);
      }
      return { ...synced, alerts_fired: alertsFired };
    }),
    { concurrency: 2 },
  );

  const synced = results.map((r, i) =>
    r.status === "fulfilled" ? r.value : { repo: tracked[i].repo, error: String(r.reason) },
  );
  const ok = synced.filter((r): r is CommitFactsSyncResult & { alerts_fired: number } => !("error" in r));

  return NextResponse.json({
    repos_synced: ok.length,
    repos_failed: synced.length - ok.length,
    total_prs_synced: ok.reduce((sum, r) => sum + r.prs_synced, 0),
    total_remaining: ok.reduce((sum, r) => sum + r.remaining, 0),
    results: synced,
  });
}
