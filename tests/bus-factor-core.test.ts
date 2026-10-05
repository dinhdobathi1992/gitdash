import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { calculateBusFactor, commitAuthor, commitFiles, moduleOf } from "@/lib/bus-factor-core";
import { computeBusFactor } from "@/lib/bus-factor";
import { __resetCacheForTests } from "@/lib/cache";
import { computeBusFactorMain } from "./fixtures/bus-factor-main";
import { sampleOctokit } from "./fixtures/sample-octokit";
import { SAMPLE_NOW, SAMPLE_REPO } from "@/lib/playground/source";

describe("moduleOf", () => {
  it("groups by the top-two directory levels", () => {
    expect(moduleOf("src/lib/dora.ts")).toBe("src/lib");
    expect(moduleOf(".github/workflows/ci.yml")).toBe(".github/workflows");
    expect(moduleOf("docs/x.md")).toBe("docs");
    expect(moduleOf("README.md")).toBe("(root)");
  });
});

describe("commitAuthor / commitFiles", () => {
  it("prefers the GitHub login, then the git name, then 'unknown'", () => {
    expect(commitAuthor({ author: { login: "dev-a" }, commit: { author: { name: "A" } } })).toBe("dev-a");
    expect(commitAuthor({ author: null, commit: { author: { name: "Laptop" } } })).toBe("Laptop");
    expect(commitAuthor({ author: {}, commit: { author: { name: "Laptop" } } })).toBe("Laptop");
    expect(commitAuthor({ author: null, commit: { author: null } })).toBe("unknown");
  });
  it("reads file names, tolerating a missing files list", () => {
    expect(commitFiles({ files: [{ filename: "a.ts" }, { filename: "b/c.ts" }] })).toEqual(["a.ts", "b/c.ts"]);
    expect(commitFiles({})).toEqual([]);
    expect(commitFiles({ files: null })).toEqual([]);
  });
});

describe("calculateBusFactor", () => {
  it("returns zeros with no commits", () => {
    expect(calculateBusFactor([])).toEqual({ modules: [], overall_bus_factor: 0, total_commits: 0, critical_modules: 0, total_contributors: 0 });
  });

  it("computes per-module bus factor, risk and ordering", () => {
    const commits = [
      ...Array.from({ length: 8 }, () => ({ author: "ana", files: ["src/pay/a.ts", "src/pay/b.ts"] })), // counted once per module
      { author: "bo", files: ["src/pay/a.ts"] },
      ...Array.from({ length: 3 }, () => ({ author: "bo", files: ["src/api/x.ts"] })),
      ...Array.from({ length: 3 }, () => ({ author: "cy", files: ["src/api/y.ts"] })),
      ...Array.from({ length: 3 }, () => ({ author: "dee", files: ["src/api/z.ts", "README.md"] })),
    ];
    const bf = calculateBusFactor(commits);
    const pay = bf.modules.find((m) => m.module === "src/pay")!;
    expect(pay).toMatchObject({ total_commits: 9, bus_factor: 1, risk: "critical", unique_contributors: 2 });
    expect(pay.contributors[0]).toEqual({ login: "ana", commits: 8, pct: 89 });
    const api = bf.modules.find((m) => m.module === "src/api")!;
    expect(api).toMatchObject({ total_commits: 9, bus_factor: 3, risk: "healthy" });
    // critical first, then by commits desc
    expect(bf.modules.map((m) => m.risk)).toEqual(["critical", "critical", "healthy"]);
    expect(bf.modules[0].module).toBe("src/pay");
    expect(bf.critical_modules).toBe(2); // src/pay and (root)
    expect(bf.total_commits).toBe(18);
    expect(bf.total_contributors).toBe(4);
    // ana 8, bo 4, cy 3, dee 3 → 80% of 18 = 14.4 → ana+bo+cy = 15
    expect(bf.overall_bus_factor).toBe(3);
  });

  it("caps modules at 30 (critical count is over all modules)", () => {
    const commits = Array.from({ length: 40 }, (_, i) => ({ author: `u${i % 7}`, files: [`m${i}/x/y.ts`] }));
    const bf = calculateBusFactor(commits);
    expect(bf.modules).toHaveLength(30);
    expect(bf.critical_modules).toBe(40);
  });

  it("keeps the top 5 contributors per module", () => {
    const commits = Array.from({ length: 14 }, (_, i) => ({ author: `u${i % 7}`, files: ["shared/x/a.ts"] }));
    const mod = calculateBusFactor(commits).modules[0];
    expect(mod.contributors).toHaveLength(5);
    expect(mod.unique_contributors).toBe(7);
  });
});

describe("bus factor: refactor preserves main's output", () => {
  // Both implementations list commits since "now − 90 days"; pin the clock to the sample's capture instant.
  beforeEach(() => {
    __resetCacheForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SAMPLE_NOW);
  });
  afterEach(() => vi.useRealTimers());
  it("computeBusFactor over the sample repo equals the pre-extraction implementation", async () => {
    const expected = await computeBusFactorMain(sampleOctokit(), SAMPLE_REPO.owner, SAMPLE_REPO.repo);
    __resetCacheForTests();
    const actual = await computeBusFactor(sampleOctokit(), SAMPLE_REPO.owner, SAMPLE_REPO.repo);
    expect(actual).toEqual(expected);
    expect(expected.total_commits).toBeGreaterThan(0);
  });
});
