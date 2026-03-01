/**
 * /api/alerts
 *
 * GET  → list all alert rules (optionally filtered by ?scope=repo:owner/name)
 * POST → create a new alert rule
 * DELETE → ?id=123 delete a rule
 * PATCH  → ?id=123 toggle enabled state
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import {
  getAllAlertRules, getAlertRules, createAlertRule,
  updateAlertRule, deleteAlertRule, getRecentAlertEvents,
} from "@/lib/db";
import { safeError } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope");
  const includeEvents = searchParams.get("events") === "1";

  try {
    const rules = scope ? await getAlertRules(scope) : await getAllAlertRules();
    const events = includeEvents ? await getRecentAlertEvents(50) : [];
    return NextResponse.json({ rules, events });
  } catch (e) {
    return safeError(e, "Failed to fetch alert rules");
  }
}

export async function POST(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    scope?: string;
    metric?: string;
    threshold?: number;
    window_hours?: number;
    channel?: string;
    destination?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { scope, metric, threshold, window_hours = 24, channel = "browser", destination } = body;
  if (!scope || !metric || threshold === undefined) {
    return NextResponse.json(
      { error: "scope, metric, and threshold are required" },
      { status: 400 }
    );
  }

  const VALID_METRICS = ["failure_rate", "duration_p95", "queue_wait_p95", "success_streak"];
  const VALID_CHANNELS = ["browser", "slack", "email"];
  if (!VALID_METRICS.includes(metric)) {
    return NextResponse.json({ error: `metric must be one of: ${VALID_METRICS.join(", ")}` }, { status: 400 });
  }
  if (!VALID_CHANNELS.includes(channel)) {
    return NextResponse.json({ error: `channel must be one of: ${VALID_CHANNELS.join(", ")}` }, { status: 400 });
  }

  try {
    const rule = await createAlertRule({
      scope, metric, threshold, window_hours, channel,
      destination: destination ?? null,
      enabled: true,
    });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (e) {
    return safeError(e, "Failed to create alert rule");
  }
}

export async function PATCH(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get("id") ?? "0", 10);
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.enabled === undefined) {
    return NextResponse.json({ error: "enabled is required" }, { status: 400 });
  }

  try {
    const rule = await updateAlertRule(id, body.enabled);
    if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ rule });
  } catch (e) {
    return safeError(e, "Failed to update alert rule");
  }
}

export async function DELETE(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get("id") ?? "0", 10);
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    await deleteAlertRule(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return safeError(e, "Failed to delete alert rule");
  }
}
