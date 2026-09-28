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
  getLeadershipDigestRules,
  upsertPrFacts,
  getPrSyncCursor, updatePrSyncCursor,
  type RunUpsertRow, type PrFactUpsertRow,
} from "@/lib/db";
import { deliverDigestEmail, deliverLeadershipDigestEmail, deliverLeadershipDigestSlack } from "@/lib/notifier";
import { generateJson } from "@/lib/ai";
import { buildDigestSnapshot } from "@/lib/ai-snapshots";
import { DIGEST_SYSTEM_PROMPT } from "@/lib/ai-prompts";
import { parseDigestContent } from "@/lib/ai-schema";
import { computeScorecard } from "@/lib/org-health-scorecard";
import { generateLeadershipNarrative } from "@/lib/leadership-narrative";
import { computeWorkingHabitsDigestLine } from "@/lib/working-habits";
import { pLimitSettled } from "@/lib/concurrency";

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

export interface LeadershipDigestSendResult {
  rules_processed: number;
  sent: number;
  failures: number;
}

/**
 * Sends the Weekly Leadership Digest to every enabled "leadership_digest"
 * rule (one per org + destination email, created via the Alerts page).
 * Reuses the same org-health-scorecard computation as v4.0.0
 * (src/lib/org-health-scorecard.ts) — same fan-out cost as opening the
 * scorecard page once per subscribed org.
 *
 * Called by the cron only on its weekly cadence (see the day-of-week guard
 * in /api/cron/sync) — this function itself doesn't gate on cadence, so
 * it's straightforward to test or trigger manually if needed.
 */
export async function sendWeeklyLeadershipDigests(
  octokit: Octokit,
  token: string,
): Promise<LeadershipDigestSendResult> {
  const rules = await getLeadershipDigestRules();
  let sent = 0;
  let failures = 0;

  for (const rule of rules) {
    if (!rule.destination) continue; // no email configured — nothing to send
    const org = rule.scope.replace(/^org:/, "");

    try {
      const scorecard = await computeScorecard(token, octokit, org, 10);
      const narrative = generateLeadershipNarrative(scorecard);

      // AI executive summary (v4.1.4) — strictly additive.
      //
      // The digest must never fail because AI is unavailable, so every failure
      // path here degrades to sending the rule-based narrative alone: no keys,
      // provider error, timeout, budget exhausted, unparseable response, or an
      // outright throw. This is the single most important property of the
      // feature — a weekly email that stops arriving because an LLM was down
      // would be worse than never having added the summary.
      let aiSummary: string | undefined;
      try {
        const snapshot = buildDigestSnapshot(scorecard, narrative, new Date());
        const ai = await generateJson(DIGEST_SYSTEM_PROMPT, snapshot, { maxOutputTokens: 600 });
        if (ai.ok) {
          aiSummary = parseDigestContent(ai.content)?.summary;
          if (!aiSummary) {
            console.warn(`[leadership-digest] AI summary failed validation for ${org} — sending without it`);
          }
        } else {
          console.warn(`[leadership-digest] AI summary unavailable for ${org}: ${ai.reason}`);
        }
      } catch (e) {
        console.warn(`[leadership-digest] AI summary threw for ${org}, sending without it:`, e);
      }

      // Working-habits totals — additive in the same way: any failure sends
      // the digest without the line.
      let workingHabitsLine: string | undefined;
      try {
        workingHabitsLine = (await computeWorkingHabitsDigestLine(org)) ?? undefined;
      } catch (e) {
        console.warn(`[leadership-digest] Working-habits line failed for ${org}, sending without it:`, e);
      }

      let result: { ok: boolean; error?: string };
      if (rule.channel === "slack") {
        result = await deliverLeadershipDigestSlack(rule.destination, {
          ...narrative,
          aiSummary,
          workingHabitsLine,
        });
      } else {
        result = await deliverLeadershipDigestEmail(rule.destination, {
          ...narrative,
          aiSummary,
          workingHabitsLine,
        });
      }
      if (result.ok) sent++;
      else {
        failures++;
        console.error(`[leadership-digest] Delivery failed for ${rule.destination} (channel: ${rule.channel ?? "email"}): ${result.error}`);
      }
    } catch (e) {
      failures++;
      console.error(`[leadership-digest] Failed to compute digest for org ${org}:`, e);
    }
  }

  return { rules_processed: rules.length, sent, failures };
}

export interface PrFactsSyncResult {
  repo: string;
  processed: number;
  failed: number;
  backfillComplete: boolean;
  apiCallCount: number;
}

// Page cap: 10 pages × 100 PRs = 1,000 PRs max per run.
// Large repos backfill incrementally across multiple cron runs.
const PR_PAGE_CAP = 10;
const PR_PER_PAGE = 100;
const PR_CONCURRENCY = 5; // lower than github-dora.ts's 10 — cost visibility matters

/**
 * Fetches all PRs for a repo (paginated, mandatory per-PR detail) and upserts
 * into pr_facts. Uses an UPDATE-only cursor so it cannot enroll new repos.
 * Only sets pr_backfill_complete when the page loop exhausted naturally (not
 * truncated by the cap) — a repo that hits the cap stays incomplete and
 * resumes on the next scheduled run from where it left off.
 */
export async function fetchAndUpsertPrFacts(
  octokit: Octokit,
  owner: string,
  repoName: string,
): Promise<PrFactsSyncResult> {
  const repoKey = `${owner}/${repoName}`;
  const { cursor: lastCursor } = await getPrSyncCursor(repoKey);
  let apiCallCount = 0;
  let processed = 0;
  let failed = 0;
  let exhausted = false;
  let oldestProcessedUpdatedAt: string | null = null;

  for (let page = 1; page <= PR_PAGE_CAP; page++) {
    const { data: prList } = await octokit.rest.pulls.list({
      owner,
      repo: repoName,
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: PR_PER_PAGE,
      page,
    });
    apiCallCount++;

    if (prList.length === 0) { exhausted = true; break; }

    // Build per-PR detail tasks for ALL PRs in this page
    const detailTasks = prList.map((pr) => async (): Promise<PrFactUpsertRow | null> => {
      try {
        const [reviewsRes, detailRes] = await Promise.all([
          octokit.rest.pulls.listReviews({ owner, repo: repoName, pull_number: pr.number }),
          octokit.rest.pulls.get({ owner, repo: repoName, pull_number: pr.number }),
        ]);
        apiCallCount += 2;
        const reviews = reviewsRes.data;
        const firstReview = reviews.length
          ? reviews.reduce((min, r) => r.submitted_at && r.submitted_at < min ? r.submitted_at : min, reviews[0].submitted_at ?? "")
          : null;
        const approvedAt = reviews.find((r) => r.state === "APPROVED")?.submitted_at ?? null;
        return {
          repo: repoKey,
          pr_number: pr.number,
          author: pr.user?.login ?? null,
          created_at: pr.created_at,
          merged_at: pr.merged_at ?? null,
          closed_at: pr.closed_at ?? null,
          first_review_at: firstReview,
          approved_at: approvedAt,
          additions: detailRes.data.additions ?? null,
          deletions: detailRes.data.deletions ?? null,
          review_count: reviews.length,
          state: pr.state,
          commit_count: detailRes.data.commits ?? null,
          changed_files: detailRes.data.changed_files ?? null,
        };
      } catch {
        return null; // detail fetch failed — PR not upserted this run
      }
    });

    const settled = await pLimitSettled(detailTasks, { concurrency: PR_CONCURRENCY });

    const rows: PrFactUpsertRow[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value !== null) {
        rows.push(result.value);
      } else {
        failed++;
      }
    }

    if (rows.length > 0) {
      await upsertPrFacts(rows);
      processed += rows.length;
      // Track oldest successfully processed PR's updated_at for cursor advancement
      const oldest = prList
        .filter((pr) => rows.some((r) => r.pr_number === pr.number))
        .reduce((min, pr) => pr.updated_at < min ? pr.updated_at : min, prList[0].updated_at);
      if (oldestProcessedUpdatedAt === null || oldest < oldestProcessedUpdatedAt) {
        oldestProcessedUpdatedAt = oldest;
      }
    }

    if (prList.length < PR_PER_PAGE) { exhausted = true; break; }

    // Cursor-based incremental: stop if we've reached already-processed PRs
    if (lastCursor) {
      const lastPr = prList[prList.length - 1];
      if (lastPr.updated_at <= lastCursor) { exhausted = true; break; }
    }
  }

  // Advance cursor to oldest successfully-processed PR's updated_at
  // Only mark complete if loop exhausted naturally (not page-capped)
  const newCursor = oldestProcessedUpdatedAt ?? lastCursor;
  const backfillComplete = exhausted;
  await updatePrSyncCursor(repoKey, newCursor, backfillComplete);

  console.log(`[pr-facts] ${repoKey}: processed=${processed} failed=${failed} apiCalls=${apiCallCount} complete=${backfillComplete}`);
  return { repo: repoKey, processed, failed, backfillComplete, apiCallCount };
}
