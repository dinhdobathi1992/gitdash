/**
 * GET /api/settings/working-habits — thresholds in effect.
 * PUT /api/settings/working-habits — save them (admin, organization mode).
 *
 * The thresholds decide what counts as an oversized commit or PR on Team
 * insights, the contributor profile, the oversized_commit_pct alert and the
 * digest line. Standalone deployments always use the defaults, so PUT refuses
 * there rather than storing config that would never be read.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession, getTokenFromSession } from "@/lib/session";
import { isStandaloneMode } from "@/lib/mode";
import { getWorkingHabitsSettings, saveWorkingHabitsSettings } from "@/lib/db";
import {
  DEFAULT_THRESHOLDS, THRESHOLD_MAX, THRESHOLD_MIN, validateThresholds, type WorkingHabitsThresholds,
} from "@/lib/working-habits-settings";
import { requireAccess } from "@/lib/permissions";
import { safeError } from "@/lib/validation";
import { noStoreHeaders } from "@/lib/http-cache";

export interface WorkingHabitsSettingsResponse {
  /** False in standalone mode or without a database — the form is read-only. */
  configurable: boolean;
  thresholds: WorkingHabitsThresholds;
  defaults: WorkingHabitsThresholds;
  min: number;
  max: number;
  updated_by: string | null;
  updated_at: string | null;
}

export async function GET() {
  const denied = await requireAccess(null, "admin");
  if (denied) return denied;
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const base = { defaults: DEFAULT_THRESHOLDS, min: THRESHOLD_MIN, max: THRESHOLD_MAX };
  if (isStandaloneMode() || !process.env.DATABASE_URL) {
    return NextResponse.json(
      { ...base, configurable: false, thresholds: DEFAULT_THRESHOLDS, updated_by: null, updated_at: null } satisfies WorkingHabitsSettingsResponse,
      { headers: noStoreHeaders() },
    );
  }
  try {
    const s = await getWorkingHabitsSettings();
    return NextResponse.json(
      {
        ...base,
        configurable: true,
        thresholds: s
          ? { maxCommitFiles: s.max_commit_files, maxCommitLines: s.max_commit_lines, maxPrCommits: s.max_pr_commits }
          : DEFAULT_THRESHOLDS,
        updated_by: s?.updated_by ?? null,
        updated_at: s?.updated_at ?? null,
      } satisfies WorkingHabitsSettingsResponse,
      { headers: noStoreHeaders() },
    );
  } catch (e) {
    return safeError(e, "Failed to load working-habits settings");
  }
}

export async function PUT(req: NextRequest) {
  const denied = await requireAccess(req, "admin");
  if (denied) return denied;
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isStandaloneMode()) {
    return NextResponse.json(
      { error: "Working-habits thresholds are configurable in organization mode only. Standalone deployments use the defaults." },
      { status: 403 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const v = validateThresholds(payload);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  try {
    const updatedBy = (await getSession()).user?.login ?? null;
    await saveWorkingHabitsSettings({
      max_commit_files: v.value.maxCommitFiles,
      max_commit_lines: v.value.maxCommitLines,
      max_pr_commits: v.value.maxPrCommits,
      updated_by: updatedBy,
    });
    return NextResponse.json({ ok: true, thresholds: v.value });
  } catch (e) {
    return safeError(e, "Failed to save working-habits settings");
  }
}
