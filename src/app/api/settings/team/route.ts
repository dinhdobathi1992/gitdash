/**
 * GET /api/settings/team — the org workday in effect.
 * PUT /api/settings/team — save it (admin, organization mode).
 *
 * The workday (time zone + hours) decides what counts as an after-hours or
 * weekend commit on Team insights and the repo Team tab. Standalone
 * deployments always use the default, so PUT refuses there rather than
 * storing config that would never be read.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession, getTokenFromSession } from "@/lib/session";
import { isStandaloneMode } from "@/lib/mode";
import { getTeamSettings, saveTeamSettings } from "@/lib/db";
import { DEFAULT_WORKDAY, isTimeZone, validateWorkday, type Workday } from "@/lib/team-settings";
import { requireAccess } from "@/lib/permissions";
import { safeError } from "@/lib/validation";
import { noStoreHeaders } from "@/lib/http-cache";

export interface TeamSettingsResponse {
  /** False in standalone mode or without a database — the form is read-only. */
  configurable: boolean;
  workday: Workday;
  defaults: Workday;
  updated_by: string | null;
  updated_at: string | null;
}

export async function GET() {
  const denied = await requireAccess(null, "admin");
  if (denied) return denied;
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isStandaloneMode() || !process.env.DATABASE_URL) {
    return NextResponse.json(
      { configurable: false, workday: DEFAULT_WORKDAY, defaults: DEFAULT_WORKDAY, updated_by: null, updated_at: null } satisfies TeamSettingsResponse,
      { headers: noStoreHeaders() },
    );
  }
  try {
    const s = await getTeamSettings();
    return NextResponse.json(
      {
        configurable: true,
        workday: s && isTimeZone(s.timezone) ? { timezone: s.timezone, start: s.workday_start, end: s.workday_end } : DEFAULT_WORKDAY,
        defaults: DEFAULT_WORKDAY,
        updated_by: s?.updated_by ?? null,
        updated_at: s?.updated_at ? new Date(s.updated_at).toISOString() : null,
      } satisfies TeamSettingsResponse,
      { headers: noStoreHeaders() },
    );
  } catch (e) {
    return safeError(e, "Failed to load team settings");
  }
}

export async function PUT(req: NextRequest) {
  const denied = await requireAccess(req, "admin");
  if (denied) return denied;
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isStandaloneMode()) {
    return NextResponse.json(
      { error: "The workday is configurable in organization mode only. Standalone deployments use the default (Asia/Saigon, 08:00–19:00)." },
      { status: 403 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const v = validateWorkday(payload);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  try {
    const updatedBy = (await getSession()).user?.login ?? null;
    await saveTeamSettings({ timezone: v.value.timezone, workday_start: v.value.start, workday_end: v.value.end, updated_by: updatedBy });
    return NextResponse.json({ ok: true, workday: v.value }, { headers: noStoreHeaders() });
  } catch (e) {
    return safeError(e, "Failed to save team settings");
  }
}
