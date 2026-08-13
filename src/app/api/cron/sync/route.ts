/**
 * GET /api/cron/sync
 *
 * Scheduled background sync — re-syncs every repo that has ever been synced
 * (tracked via sync_cursors, see src/lib/db.ts listSyncedRepos), so Reports
 * and Alerts stay current without a user manually clicking "Sync from GitHub".
 *
 * Triggered by Vercel Cron (see vercel.json `crons`). Vercel does not sign
 * cron requests by default, so this route is protected the standard way:
 * Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on cron
 * invocations when CRON_SECRET is set as an env var — this route rejects
 * any request whose Authorization header doesn't match.
 *
 * Uses the service-level GITHUB_TOKEN (getOctokit's fallback when no user
 * token is passed) — a cron run has no session, so it must run as a single
 * service identity with access to every tracked repo.
 *
 * After syncing, also sends any pending "digest"-channel alert emails —
 * this is the only scheduled entry point, and Vercel Hobby limits cron jobs
 * to once/day, so digest delivery piggybacks here rather than needing its
 * own cron.
 *
 * On Mondays (UTC) only, also sends the Weekly Leadership Digest (v4.0.3)
 * to every "leadership_digest" alert rule. No persisted "last sent" state
 * is needed — the day-of-week check alone is enough to fire once a week,
 * since this cron itself only runs once a day.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOctokit } from "@/lib/github";
import { syncRepo, sendPendingDigests, sendWeeklyLeadershipDigests } from "@/lib/sync";
import { listSyncedRepos } from "@/lib/db";
import { pLimitSettled } from "@/lib/concurrency";

export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if not configured
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN is not configured — cron sync needs a service-level token" },
      { status: 500 },
    );
  }

  const octokit = getOctokit(process.env.GITHUB_TOKEN);
  const tracked = await listSyncedRepos();

  const results = await pLimitSettled(
    tracked.map(({ repo }) => async () => {
      const [owner, repoName] = repo.split("/");
      if (!owner || !repoName) throw new Error(`Malformed repo key: ${repo}`);
      return syncRepo(octokit, owner, repoName, 3);
    }),
    { concurrency: 3 },
  );

  const synced = results
    .map((r, i) => (r.status === "fulfilled" ? r.value : { repo: tracked[i].repo, error: String(r.reason) }));
  const failed = synced.filter((r) => "error" in r);

  let digest;
  try {
    digest = await sendPendingDigests();
  } catch (e) {
    console.error("[cron] Digest send error:", e);
    digest = { destinations_notified: 0, events_included: 0, failures: 0, error: String(e) };
  }

  // Monday = 1 in getUTCDay() (Sunday = 0)
  const isMonday = new Date().getUTCDay() === 1;
  let leadershipDigest: Awaited<ReturnType<typeof sendWeeklyLeadershipDigests>> | { skipped: true } = { skipped: true };
  if (isMonday) {
    try {
      leadershipDigest = await sendWeeklyLeadershipDigests(octokit, process.env.GITHUB_TOKEN);
    } catch (e) {
      console.error("[cron] Leadership digest error:", e);
      leadershipDigest = { rules_processed: 0, sent: 0, failures: 1 };
    }
  }

  return NextResponse.json({
    repos_tracked: tracked.length,
    repos_synced: synced.length - failed.length,
    repos_failed: failed.length,
    results: synced,
    digest,
    leadership_digest: leadershipDigest,
  });
}
