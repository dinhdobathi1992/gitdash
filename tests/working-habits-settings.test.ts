import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getWorkingHabitsSettings = vi.fn();
vi.mock("@/lib/db", () => ({ getWorkingHabitsSettings: () => getWorkingHabitsSettings() }));

import { DEFAULT_THRESHOLDS, getThresholds, validateThresholds } from "@/lib/working-habits-settings";

const saved = { MODE: process.env.MODE, DATABASE_URL: process.env.DATABASE_URL };

beforeEach(() => {
  getWorkingHabitsSettings.mockReset();
  process.env.MODE = "organization";
  process.env.DATABASE_URL = "postgres://x";
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("getThresholds", () => {
  it("defaults are the team standard", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ maxCommitFiles: 10, maxCommitLines: 200, maxPrCommits: 20 });
  });

  it("returns the saved row in organization mode", async () => {
    getWorkingHabitsSettings.mockResolvedValue({ max_commit_files: 5, max_commit_lines: 100, max_pr_commits: 8 });
    expect(await getThresholds()).toEqual({ maxCommitFiles: 5, maxCommitLines: 100, maxPrCommits: 8 });
  });

  it("returns defaults when no row is saved", async () => {
    getWorkingHabitsSettings.mockResolvedValue(null);
    expect(await getThresholds()).toEqual(DEFAULT_THRESHOLDS);
  });

  it("returns defaults when the table is unreachable", async () => {
    getWorkingHabitsSettings.mockRejectedValue(new Error("down"));
    expect(await getThresholds()).toEqual(DEFAULT_THRESHOLDS);
  });

  it("standalone and no-database deployments never read the table", async () => {
    process.env.MODE = "standalone";
    expect(await getThresholds()).toEqual(DEFAULT_THRESHOLDS);
    process.env.MODE = "organization";
    delete process.env.DATABASE_URL;
    expect(await getThresholds()).toEqual(DEFAULT_THRESHOLDS);
    expect(getWorkingHabitsSettings).not.toHaveBeenCalled();
  });
});

describe("validateThresholds", () => {
  it("accepts integers in range", () => {
    expect(validateThresholds({ maxCommitFiles: 1, maxCommitLines: 10_000, maxPrCommits: 20 }))
      .toEqual({ ok: true, value: { maxCommitFiles: 1, maxCommitLines: 10_000, maxPrCommits: 20 } });
  });

  it.each([
    [null],
    ["10"],
    [{ maxCommitFiles: 10, maxCommitLines: 200 }],
    [{ maxCommitFiles: 0, maxCommitLines: 200, maxPrCommits: 20 }],
    [{ maxCommitFiles: 10, maxCommitLines: 10_001, maxPrCommits: 20 }],
    [{ maxCommitFiles: 10.5, maxCommitLines: 200, maxPrCommits: 20 }],
    [{ maxCommitFiles: "10", maxCommitLines: 200, maxPrCommits: 20 }],
  ])("rejects %j", (input) => {
    expect(validateThresholds(input).ok).toBe(false);
  });

  it("drops unknown fields", () => {
    const r = validateThresholds({ maxCommitFiles: 10, maxCommitLines: 200, maxPrCommits: 20, extra: 1 });
    expect(r).toEqual({ ok: true, value: DEFAULT_THRESHOLDS });
  });
});
