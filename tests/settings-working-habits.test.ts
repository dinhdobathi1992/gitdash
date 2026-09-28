import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const saveWorkingHabitsSettings = vi.fn();
const getWorkingHabitsSettings = vi.fn();
let denied: (() => NextResponse) | null = null;

vi.mock("@/lib/db", () => ({
  saveWorkingHabitsSettings: (...a: unknown[]) => saveWorkingHabitsSettings(...a),
  getWorkingHabitsSettings: () => getWorkingHabitsSettings(),
}));
vi.mock("@/lib/session", () => ({
  getTokenFromSession: async () => "tok",
  getSession: async () => ({ user: { login: "admin1" } }),
}));
vi.mock("@/lib/permissions", () => ({ requireAccess: async () => denied?.() ?? null }));

const env = { MODE: process.env.MODE, DATABASE_URL: process.env.DATABASE_URL };
const valid = { maxCommitFiles: 12, maxCommitLines: 300, maxPrCommits: 25 };

async function put(body: unknown) {
  const { PUT } = await import("@/app/api/settings/working-habits/route");
  const res = await PUT(new NextRequest("http://localhost/api/settings/working-habits", {
    method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}
async function get() {
  const { GET } = await import("@/app/api/settings/working-habits/route");
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  denied = null;
  process.env.MODE = "organization";
  process.env.DATABASE_URL = "postgres://x";
  saveWorkingHabitsSettings.mockReset().mockResolvedValue(undefined);
  getWorkingHabitsSettings.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("/api/settings/working-habits", () => {
  it("non-admins are refused on both verbs", async () => {
    denied = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
    expect((await get()).status).toBe(403);
    expect((await put(valid)).status).toBe(403);
    expect(saveWorkingHabitsSettings).not.toHaveBeenCalled();
  });

  it("saves valid thresholds with the admin's login", async () => {
    const r = await put(valid);
    expect(r.status).toBe(200);
    expect(saveWorkingHabitsSettings).toHaveBeenCalledWith({
      max_commit_files: 12, max_commit_lines: 300, max_pr_commits: 25, updated_by: "admin1",
    });
  });

  it("rejects invalid values and bad JSON", async () => {
    expect((await put({ ...valid, maxPrCommits: 0 })).status).toBe(400);
    expect((await put({ maxCommitFiles: 10 })).status).toBe(400);
    expect((await put("{nope")).status).toBe(400);
    expect(saveWorkingHabitsSettings).not.toHaveBeenCalled();
  });

  it("standalone mode refuses to save and reports the defaults as read-only", async () => {
    process.env.MODE = "standalone";
    expect((await put(valid)).status).toBe(403);
    const g = await get();
    expect(g.body).toMatchObject({ configurable: false, thresholds: { maxCommitFiles: 10, maxCommitLines: 200, maxPrCommits: 20 } });
  });

  it("GET returns the saved row", async () => {
    getWorkingHabitsSettings.mockResolvedValue({ max_commit_files: 5, max_commit_lines: 50, max_pr_commits: 8, updated_by: "x", updated_at: null });
    expect((await get()).body).toMatchObject({ configurable: true, thresholds: { maxCommitFiles: 5, maxCommitLines: 50, maxPrCommits: 8 }, updated_by: "x" });
  });
});
