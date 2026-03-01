/**
 * POST /api/db/sync
 *
 * Syncs recent workflow runs for a given repo from GitHub API into Neon DB.
 * Supports incremental sync — only fetches runs newer than the last stored run.
 *
 * Body: { owner: string; repo: string; pages?: number }
 * Returns: { synced: number; total_in_db: number; latest_run_id: number | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getOctokit } from "@/lib/github";
import {
  upsertRuns, getSyncCursor, updateSyncCursor, getDbRunCount,
  evaluateAlertRulesForRepo,
  type RunUpsertRow,
} from "@/lib/db";
import { safeError } from "@/lib/validation";

const MAX_PAGES = 5;
const PER_PAGE = 100;

export async function POST(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { owner?: string; repo?: string; pages?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { owner, repo: repoName, pages = 3 } = body;
  if (!owner || !repoName) {
    return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
  }

  const repoKey = `${owner}/${repoName}`;
  const octokit = getOctokit(token);
  const maxPages = Math.min(pages, MAX_PAGES);

  try {
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

    return NextResponse.json({
      synced,
      total_in_db: totalInDb,
      latest_run_id: latestRunId,
      alerts_fired: alertsFired,
    });
  } catch (e) {
    return safeError(e, "Sync failed");
  }
}
