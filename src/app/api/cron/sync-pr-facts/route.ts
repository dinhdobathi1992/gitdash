/**
 * GET /api/cron/sync-pr-facts
 *
 * Dedicated nightly cron for populating pr_facts for every tracked repo.
 * Runs on its own schedule (vercel.json) — structurally decoupled from
 * /api/cron/sync so a slow or rate-limited PR sync can never delay
 * sendPendingDigests or sendWeeklyLeadershipDigests.
 *
 * Auth: same CRON_SECRET bearer pattern as /api/cron/sync.
 * Identity: GITHUB_TOKEN service identity (same as run-sync cron).
 * Iterates listSyncedRepos() — only repos with Actions-run history get
 * PR-facts synced. New repos are enrolled by the run-sync cron, not here.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOctokit } from "@/lib/github";
import { fetchAndUpsertPrFacts, type PrFactsSyncResult } from "@/lib/sync";
import { listSyncedRepos } from "@/lib/db";
import { pLimitSettled } from "@/lib/concurrency";
import { labelGitHubRoute } from "@/lib/github-telemetry";

export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  labelGitHubRoute("cron/sync-pr-facts");
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json({ error: "GITHUB_TOKEN not set" }, { status: 500 });
  }

  const octokit = getOctokit(process.env.GITHUB_TOKEN);
  const tracked = await listSyncedRepos();

  const results = await pLimitSettled(
    tracked.map(({ repo }) => async () => {
      const [owner, repoName] = repo.split("/");
      return fetchAndUpsertPrFacts(octokit, owner, repoName);
    }),
    { concurrency: 2 }, // lower than run-sync's 3 — PR-facts uses more API calls per repo
  );

  const synced = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { repo: tracked[i].repo, error: String(r.reason) },
  );
  const failed = synced.filter((r) => "error" in r);
  const totalProcessed = synced
    .filter((r): r is PrFactsSyncResult => "processed" in r)
    .reduce((sum, r) => sum + r.processed, 0);

  return NextResponse.json({
    repos_synced: synced.length - failed.length,
    repos_failed: failed.length,
    total_prs_processed: totalProcessed,
    results: synced,
  });
}
