/**
 * POST /api/webhooks/github
 *
 * Receives GitHub `workflow_run` webhook events and upserts the run into Neon
 * DB without requiring the user to manually trigger a sync.
 *
 * Setup (in GitHub repo/org → Settings → Webhooks):
 *   Payload URL : https://<your-gitdash>/api/webhooks/github
 *   Content type: application/json
 *   Secret      : value of GITHUB_WEBHOOK_SECRET env var
 *   Events      : Workflow runs
 *
 * Security: HMAC-SHA256 signature is verified against GITHUB_WEBHOOK_SECRET.
 * If the secret is not configured the endpoint rejects all requests (fail-safe).
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import {
  ensureSchema,
  upsertRuns,
  getSyncCursor,
  updateSyncCursor,
  evaluateAlertRulesForRepo,
  type RunUpsertRow,
} from "@/lib/db";

// ── Signature verification ────────────────────────────────────────────────────

function signBody(secret: string, body: string): Buffer {
  return createHmac("sha256", secret).update(body, "utf8").digest();
}

function verifySignature(secret: string, body: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = signBody(secret, body);
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(expected, received);
}

// ── Payload shape (minimal — only fields we need) ─────────────────────────────

interface WorkflowRunPayload {
  action: "requested" | "in_progress" | "completed";
  workflow_run: {
    id: number;
    name: string | null;
    workflow_id: number;
    run_number: number;
    run_attempt: number;
    status: string;
    conclusion: string | null;
    event: string;
    head_branch: string | null;
    head_sha: string;
    created_at: string;
    updated_at: string;
    run_started_at: string | null;
    actor: { login: string } | null;
  };
  repository: {
    full_name: string;  // "owner/repo"
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Require a configured secret — fail-closed
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook] GITHUB_WEBHOOK_SECRET is not set — rejecting request");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  // 2. Read raw body (needed for signature verification)
  const rawBody = await req.text();

  // 3. Verify HMAC-SHA256 signature
  const sig = req.headers.get("x-hub-signature-256");
  if (!verifySignature(secret, rawBody, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 4. Only handle workflow_run events
  const event = req.headers.get("x-github-event");
  if (event !== "workflow_run") {
    // Return 200 for other events so GitHub doesn't mark delivery as failed
    return NextResponse.json({ skipped: true, event });
  }

  // 5. Parse payload
  let payload: WorkflowRunPayload;
  try {
    payload = JSON.parse(rawBody) as WorkflowRunPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workflow_run: r, repository } = payload;
  const repoKey = repository.full_name;   // "owner/repo"

  // 6. Compute duration and queue wait
  const startedAt   = r.run_started_at  ? new Date(r.run_started_at).getTime()  : null;
  const updatedAt   = new Date(r.updated_at).getTime();
  const createdAt   = new Date(r.created_at).getTime();

  const durationMs =
    r.status === "completed" && startedAt
      ? Math.max(0, updatedAt - startedAt)
      : null;

  const queueWaitMs = startedAt ? Math.max(0, startedAt - createdAt) : null;

  const row: RunUpsertRow = {
    id:            r.id,
    repo:          repoKey,
    workflow_id:   r.workflow_id,
    workflow_name: r.name,
    run_number:    r.run_number,
    status:        r.status,
    conclusion:    r.conclusion,
    event:         r.event,
    head_branch:   r.head_branch,
    head_sha:      r.head_sha,
    actor:         r.actor?.login ?? null,
    created_at:    r.created_at,
    updated_at:    r.updated_at,
    duration_ms:   durationMs,
    queue_wait_ms: queueWaitMs,
    run_attempt:   r.run_attempt,
  };

  try {
    await ensureSchema();
    await upsertRuns([row]);

    // Advance the sync cursor if this run is newer than the stored one
    const cursor = await getSyncCursor(repoKey);
    if (!cursor || r.id > cursor) {
      await updateSyncCursor(repoKey, r.id);
    }

    // Evaluate alert rules on completed runs only (avoid double-firing on in_progress)
    let alertsFired = 0;
    if (payload.action === "completed") {
      try {
        alertsFired = await evaluateAlertRulesForRepo(repoKey);
      } catch (alertErr) {
        console.error("[webhook] Alert evaluation error:", alertErr);
      }
    }

    return NextResponse.json({
      ok: true,
      run_id: r.id,
      action: payload.action,
      alerts_fired: alertsFired,
    });
  } catch (err) {
    console.error("[webhook] DB error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
