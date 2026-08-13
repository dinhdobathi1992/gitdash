/**
 * Shared GitHub → Neon sync logic, used by both the manual sync route
 * (POST /api/db/sync, user token) and the scheduled cron route
 * (GET /api/cron/sync, service token — see src/lib/github.ts getOctokit
 * fallback to GITHUB_TOKEN).
 */

import { Octokit } from "@octokit/rest";
import {
  upsertRuns, getSyncCursor, updateSyncCursor, getDbRunCount,
  evaluateAlertRulesForRepo,
  getPendingDigestEvents, markDigestSent,
  type RunUpsertRow,
} from "@/lib/db";
import { deliverDigestEmail } from "@/lib/notifier";

const MAX_PAGES = 5;
const PER_PAGE = 100;

export interface SyncResult {
  repo: string;
  synced: number;
  total_in_db: number;
  latest_run_id: number | null;
  alerts_fired: number;
}

export async function syncRepo(
  octokit: Octokit,
  owner: string,
  repoName: string,
  pages = 3,
): Promise<SyncResult> {
  const repoKey = `${owner}/${repoName}`;
  const maxPages = Math.min(pages, MAX_PAGES);

  const cursor = await getSyncCursor(repoKey);
  const rows: RunUpsertRow[] = [];
  let latestRunId: number | null = null;
  let done = false;

  for (let page = 1; page <= maxPages && !done; page++) {
    const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo: repoName,
      per_page: PER_PAGE,
      page,
      exclude_pull_requests: false,
    });

    for (const r of data.workflow_runs) {
      // Stop incremental sync when we reach already-synced runs
      if (cursor && r.id <= cursor) { done = true; break; }

      const startedAt = r.run_started_at ? new Date(r.run_started_at).getTime() : null;
      const updatedAt = new Date(r.updated_at).getTime();
      const createdAt = new Date(r.created_at).getTime();

      const durationMs =
        r.status === "completed" && startedAt
          ? Math.max(0, updatedAt - startedAt)
          : null;

      const queueWaitMs =
        startedAt ? Math.max(0, startedAt - createdAt) : null;

      rows.push({
        id: r.id,
        repo: repoKey,
        workflow_id: r.workflow_id ?? null,
        workflow_name: r.name ?? null,
        run_number: r.run_number ?? null,
        status: r.status ?? null,
        conclusion: r.conclusion ?? null,
        event: r.event ?? null,
        head_branch: r.head_branch ?? null,
        head_sha: r.head_sha ?? null,
        actor: r.actor?.login ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at,
        duration_ms: durationMs,
        queue_wait_ms: queueWaitMs,
        run_attempt: r.run_attempt ?? 1,
      });

      if (latestRunId === null || r.id > latestRunId) {
        latestRunId = r.id;
      }
    }

    if (data.workflow_runs.length < PER_PAGE) break;
  }

  const synced = await upsertRuns(rows);
  if (latestRunId) await updateSyncCursor(repoKey, latestRunId);

  const totalInDb = await getDbRunCount(repoKey);

  // Evaluate alert rules after every sync — only runs if rules exist
  let alertsFired = 0;
  try {
    alertsFired = await evaluateAlertRulesForRepo(repoKey);
  } catch (alertErr) {
    // Alert evaluation is best-effort — log but don't fail the sync response
    console.error("[sync] Alert evaluation error:", alertErr);
  }

  return { repo: repoKey, synced, total_in_db: totalInDb, latest_run_id: latestRunId, alerts_fired: alertsFired };
}

export interface DigestSendResult {
  destinations_notified: number;
  events_included: number;
  failures: number;
}

/**
 * Sends one summary email per destination for all events fired by
 * "digest"-channel alert rules since the last send. Intended to run once
 * per day from the cron route, after the sync pass — new digest events are
 * already in the DB by the time this runs.
 */
export async function sendPendingDigests(): Promise<DigestSendResult> {
  const pending = await getPendingDigestEvents();
  if (!pending.length) return { destinations_notified: 0, events_included: 0, failures: 0 };

  const byDestination = new Map<string, typeof pending>();
  for (const event of pending) {
    if (!event.destination) continue; // no email configured — nothing to send, leave pending
    const list = byDestination.get(event.destination) ?? [];
    list.push(event);
    byDestination.set(event.destination, list);
  }

  let notified = 0;
  let failures = 0;
  const sentEventIds: number[] = [];

  for (const [destination, events] of byDestination) {
    const result = await deliverDigestEmail(
      destination,
      events.map((e) => ({ repo: e.scope.replace(/^repo:/, ""), metric: e.metric, value: e.value, fired_at: e.fired_at })),
    );
    if (result.ok) {
      notified++;
      sentEventIds.push(...events.map((e) => e.id));
    } else {
      failures++;
      console.error(`[digest] Delivery failed for ${destination}: ${result.error}`);
    }
  }

  if (sentEventIds.length) await markDigestSent(sentEventIds);

  return { destinations_notified: notified, events_included: sentEventIds.length, failures };
}
