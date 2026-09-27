/**
 * /api/alerts/test
 *
 * POST { rule_id: number }
 *
 * Sends a test alert for the given rule without requiring a real threshold
 * breach. Uses a synthetic value of 1 for all metrics.
 * Returns { ok: boolean; result: DeliveryResult }.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getAllAlertRules } from "@/lib/db";
import { buildPayload, dispatchAlert } from "@/lib/notifier";
import { safeError } from "@/lib/validation";
import { requireAccess } from "@/lib/permissions";

export async function POST(req: NextRequest) {
  const denied = await requireAccess(req, "admin");
  if (denied) return denied;
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { rule_id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { rule_id } = body;
  if (!rule_id) {
    return NextResponse.json({ error: "rule_id is required" }, { status: 400 });
  }

  try {
    const rules = await getAllAlertRules();
    const rule = rules.find((r) => r.id === rule_id);
    if (!rule) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    const payload = buildPayload(rule, rule.scope, rule.threshold, undefined);
    const result = await dispatchAlert(payload);

    return NextResponse.json({ ok: result.ok, result });
  } catch (e) {
    return safeError(e, "Failed to send test alert");
  }
}
