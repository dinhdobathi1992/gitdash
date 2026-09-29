/**
 * The saved org workday (server only — reads the database). The rules and
 * defaults live in team-settings.ts, which the browser also uses.
 */

import { isStandaloneMode } from "./mode";
import { DEFAULT_WORKDAY, isTimeZone, type Workday } from "./team-settings";

/** Saved workday, or the default when there is nothing to read. */
export async function getWorkday(): Promise<Workday> {
  if (isStandaloneMode() || !process.env.DATABASE_URL) return { ...DEFAULT_WORKDAY };
  try {
    const { getTeamSettings } = await import("./db");
    const row = await getTeamSettings();
    if (!row || !isTimeZone(row.timezone)) return { ...DEFAULT_WORKDAY };
    return { timezone: row.timezone, start: row.workday_start, end: row.workday_end };
  } catch {
    // Table unreachable — the default keeps every figure computable.
    return { ...DEFAULT_WORKDAY };
  }
}
