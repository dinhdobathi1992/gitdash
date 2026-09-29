import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_WORKDAY, LEGACY_UTC_WORKDAY, classifyCommitTime, formatWorkday, localHourAndDay, validateWorkday, workdayKey,
} from "@/lib/team-settings";

const saveTeamSettings = vi.fn();
const getTeamSettings = vi.fn();
let denied: (() => NextResponse) | null = null;

vi.mock("@/lib/db", () => ({
  saveTeamSettings: (...a: unknown[]) => saveTeamSettings(...a),
  getTeamSettings: () => getTeamSettings(),
}));
vi.mock("@/lib/session", () => ({
  getTokenFromSession: async () => "tok",
  getSession: async () => ({ user: { login: "admin1" } }),
}));
vi.mock("@/lib/permissions", () => ({ requireAccess: async () => denied?.() ?? null }));

const env = { MODE: process.env.MODE, DATABASE_URL: process.env.DATABASE_URL };

beforeEach(() => {
  denied = null;
  process.env.MODE = "organization";
  process.env.DATABASE_URL = "postgres://x";
  saveTeamSettings.mockReset().mockResolvedValue(undefined);
  getTeamSettings.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("workday rules", () => {
  it("defaults to Asia/Saigon 08–19", () => {
    expect(DEFAULT_WORKDAY).toEqual({ timezone: "Asia/Saigon", start: 8, end: 19 });
    expect(formatWorkday(DEFAULT_WORKDAY)).toBe("08:00–19:00 Asia/Saigon");
    expect(workdayKey(DEFAULT_WORKDAY)).toBe("Asia/Saigon:8-19");
  });

  it("18:30 UTC is 01:30 the next day in Asia/Saigon — after hours", () => {
    const d = new Date("2026-09-22T18:30:00Z"); // Tuesday
    expect(localHourAndDay(d, "Asia/Saigon")).toEqual({ hour: 1, day: 3 });
    expect(classifyCommitTime(d, DEFAULT_WORKDAY).afterHours).toBe(true);
  });

  it("03:00 UTC is 10:00 in Saigon: within the workday there, after hours under UTC 09–18", () => {
    const d = new Date("2026-09-22T03:00:00Z");
    expect(classifyCommitTime(d, DEFAULT_WORKDAY).afterHours).toBe(false);
    expect(classifyCommitTime(d, LEGACY_UTC_WORKDAY).afterHours).toBe(true);
  });

  it("the weekend is read in the workday's zone", () => {
    const fridayNightUtc = new Date("2026-09-25T20:00:00Z"); // Fri 20:00 UTC = Sat 03:00 Saigon
    expect(classifyCommitTime(fridayNightUtc, DEFAULT_WORKDAY).weekend).toBe(true);
    expect(classifyCommitTime(fridayNightUtc, LEGACY_UTC_WORKDAY).weekend).toBe(false);
  });

  it("follows daylight saving in zones that have it", () => {
    const berlin = { timezone: "Europe/Berlin", start: 9, end: 18 };
    // 07:30 UTC is 09:30 in summer (CEST, UTC+2) but 08:30 in winter (CET, UTC+1).
    expect(classifyCommitTime(new Date("2026-07-01T07:30:00Z"), berlin).afterHours).toBe(false);
    expect(classifyCommitTime(new Date("2026-12-01T07:30:00Z"), berlin).afterHours).toBe(true);
  });

  it("validates time zone and hours", () => {
    expect(validateWorkday({ timezone: "Asia/Saigon", start: 8, end: 19 })).toEqual({ ok: true, value: DEFAULT_WORKDAY });
    expect(validateWorkday({ timezone: "Mars/Olympus", start: 8, end: 19 }).ok).toBe(false);
    expect(validateWorkday({ timezone: "UTC", start: 19, end: 8 }).ok).toBe(false);
    expect(validateWorkday({ timezone: "UTC", start: 9, end: 9 }).ok).toBe(false);
    expect(validateWorkday({ timezone: "UTC", start: 24, end: 24 }).ok).toBe(false);
    expect(validateWorkday({ timezone: "UTC", start: 8.5, end: 19 }).ok).toBe(false);
    expect(validateWorkday({ timezone: "UTC", start: 0, end: 24 }).ok).toBe(true);
    expect(validateWorkday(null).ok).toBe(false);
  });
});

describe("getWorkday", () => {
  it("uses the saved row in organization mode, the default elsewhere", async () => {
    const { getWorkday } = await import("@/lib/workday-setting");
    expect(await getWorkday()).toEqual(DEFAULT_WORKDAY);
    getTeamSettings.mockResolvedValue({ timezone: "UTC", workday_start: 9, workday_end: 18, updated_by: null, updated_at: null });
    expect(await getWorkday()).toEqual(LEGACY_UTC_WORKDAY);
    process.env.MODE = "standalone";
    expect(await getWorkday()).toEqual(DEFAULT_WORKDAY);
  });

  it("falls back to the default when the table cannot be read", async () => {
    getTeamSettings.mockRejectedValue(new Error("down"));
    const { getWorkday } = await import("@/lib/workday-setting");
    expect(await getWorkday()).toEqual(DEFAULT_WORKDAY);
  });
});

describe("/api/settings/team", () => {
  async function put(body: unknown) {
    const { PUT } = await import("@/app/api/settings/team/route");
    const res = await PUT(new NextRequest("http://localhost/api/settings/team", {
      method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  }
  async function get() {
    const { GET } = await import("@/app/api/settings/team/route");
    const res = await GET();
    return { status: res.status, body: await res.json() };
  }

  it("non-admins are refused on both verbs", async () => {
    denied = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
    expect((await get()).status).toBe(403);
    expect((await put({ timezone: "UTC", start: 9, end: 18 })).status).toBe(403);
    expect(saveTeamSettings).not.toHaveBeenCalled();
  });

  it("saves a valid workday with the admin's login", async () => {
    const r = await put({ timezone: "Europe/Berlin", start: 9, end: 17 });
    expect(r.status).toBe(200);
    expect(saveTeamSettings).toHaveBeenCalledWith({ timezone: "Europe/Berlin", workday_start: 9, workday_end: 17, updated_by: "admin1" });
  });

  it("rejects a bad zone, end before start and bad JSON", async () => {
    expect((await put({ timezone: "Nowhere/City", start: 9, end: 17 })).status).toBe(400);
    expect((await put({ timezone: "UTC", start: 17, end: 9 })).status).toBe(400);
    expect((await put("{nope")).status).toBe(400);
    expect(saveTeamSettings).not.toHaveBeenCalled();
  });

  it("standalone mode refuses to save and reports the default as read-only", async () => {
    process.env.MODE = "standalone";
    expect((await put({ timezone: "UTC", start: 9, end: 18 })).status).toBe(403);
    expect((await get()).body).toMatchObject({ configurable: false, workday: DEFAULT_WORKDAY });
  });

  it("GET returns the saved row", async () => {
    getTeamSettings.mockResolvedValue({ timezone: "UTC", workday_start: 7, workday_end: 16, updated_by: "x", updated_at: null });
    expect((await get()).body).toMatchObject({ configurable: true, workday: { timezone: "UTC", start: 7, end: 16 }, updated_by: "x" });
  });
});
