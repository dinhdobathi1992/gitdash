/**
 * The org workday: which hours of which days count as work time for the
 * after-hours and weekend workload figures (Team insights and the repo Team
 * tab). One time zone for the whole organization — hours and weekdays of every
 * commit are read in that zone.
 *
 * Admins edit it in Settings → Team insights (organization mode). Standalone
 * deployments, and any deployment without a database or a saved row, use the
 * default: Asia/Saigon, 08:00–19:00. Pure and browser-safe; the saved value is
 * read by getWorkday() in workday-setting.ts (server only).
 */

export interface Workday {
  /** IANA time zone name, e.g. "Asia/Saigon". */
  timezone: string;
  /** First work hour (0–23), inclusive. */
  start: number;
  /** End of the workday (1–24), exclusive. */
  end: number;
}

export const DEFAULT_WORKDAY: Workday = { timezone: "Asia/Saigon", start: 8, end: 19 };

/** The rule the workload route used before the setting existed (kept for tests and docs). */
export const LEGACY_UTC_WORKDAY: Workday = { timezone: "UTC", start: 9, end: 18 };

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Validate an untrusted payload `{ timezone, start, end }`. */
export function validateWorkday(input: unknown): { ok: true; value: Workday } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Body must be an object" };
  const { timezone, start, end } = input as Record<string, unknown>;
  if (!isTimeZone(timezone)) return { ok: false, error: "timezone must be an IANA time zone name, e.g. Asia/Saigon" };
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0 || start > 23) {
    return { ok: false, error: "start must be a whole hour from 0 to 23" };
  }
  if (typeof end !== "number" || !Number.isInteger(end) || end < 1 || end > 24) {
    return { ok: false, error: "end must be a whole hour from 1 to 24" };
  }
  if (end <= start) return { ok: false, error: "end must be later than start" };
  return { ok: true, value: { timezone, start, end } };
}

/** Cache key fragment: counters computed under one workday must not be served under another. */
export function workdayKey(w: Workday): string {
  return `${w.timezone}:${w.start}-${w.end}`;
}

/** "08:00–19:00 Asia/Saigon" */
export function formatWorkday(w: Workday): string {
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `${hh(w.start)}–${hh(w.end)} ${w.timezone}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Hour (0–23) and weekday (0 = Sunday) of `date` in time zone `tz`. */
export function localHourAndDay(date: Date, tz: string): { hour: number; day: number } {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23", weekday: "short" });
    formatters.set(tz, f);
  }
  let hour = 0;
  let day = 0;
  for (const p of f.formatToParts(date)) {
    if (p.type === "hour") hour = Number(p.value) % 24;
    else if (p.type === "weekday") day = WEEKDAY[p.value] ?? 0;
  }
  return { hour, day };
}

/** After hours = outside [start, end) in the workday's zone; weekend = Saturday or Sunday there. */
export function classifyCommitTime(date: Date, w: Workday): { afterHours: boolean; weekend: boolean } {
  const { hour, day } = localHourAndDay(date, w.timezone);
  return { afterHours: hour < w.start || hour >= w.end, weekend: day === 0 || day === 6 };
}
