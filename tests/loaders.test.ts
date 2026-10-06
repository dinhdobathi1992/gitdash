import { describe, it, expect, beforeEach, vi } from "vitest";
import { __resetCacheForTests, hashKey } from "@/lib/cache";
import type { Repo, RepoSummary } from "@/lib/github";

const github = vi.hoisted(() => ({
  listRepos: vi.fn(),
  getRepoSummary: vi.fn(),
  getRepoOverview: vi.fn(),
  getOctokit: vi.fn(),
}));
const dora = vi.hoisted(() => ({ getRepoDoraSummary: vi.fn() }));
const cacheKeys = vi.hoisted(() => ({ seen: [] as string[] }));

vi.mock("@/lib/github", async (orig) => ({
  ...(await orig<typeof import("@/lib/github")>()),
  ...github,
}));
vi.mock("@/lib/github-dora", () => dora);
vi.mock("@/lib/cache", async (orig) => {
  const real = await orig<typeof import("@/lib/cache")>();
  return {
    ...real,
    withCache: ((key: string, ...rest: unknown[]) => {
      cacheKeys.seen.push(key);
      return (real.withCache as (...a: unknown[]) => unknown)(key, ...rest);
    }) as typeof real.withCache,
  };
});

import { loadRepoDora, repoDoraCacheKey } from "@/lib/loaders/repo-dora";
import { loadRepoOverview } from "@/lib/loaders/repo-overview";
import { loadRepoSummary } from "@/lib/loaders/repo-summary";
import { loadOpenPrHealth } from "@/lib/loaders/open-pr-health";
import { loadOrgHealth } from "@/lib/loaders/org-health";
import { loadCostAnalysis } from "@/lib/loaders/cost-analysis";
import { loadFailingWorkflows, FAILING_WORKFLOWS_MAX_REPOS } from "@/lib/loaders/failing-workflows";

const TOKEN = "test-token";

beforeEach(() => {
  __resetCacheForTests();
  cacheKeys.seen.length = 0;
  for (const fn of [...Object.values(github), ...Object.values(dora)]) fn.mockReset();
});

describe("input validation", () => {
  it("returns 400 without calling GitHub for an invalid owner or repo", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const calls: Array<[string, () => Promise<{ ok: boolean; status?: number; error?: string }>]> = [
      ["overview owner", () => loadRepoOverview(TOKEN, "bad owner!", "web")],
      ["overview repo", () => loadRepoOverview(TOKEN, "acme", "../etc")],
      ["dora owner", () => loadRepoDora(TOKEN, null, "web")],
      ["dora repo", () => loadRepoDora(TOKEN, "acme", "")],
      ["summary owner", () => loadRepoSummary(TOKEN, "-acme", "web")],
      ["pr health repo", () => loadOpenPrHealth(TOKEN, "acme", "a/b")],
      ["org health org", () => loadOrgHealth(TOKEN, "not valid")],
      ["cost org", () => loadCostAnalysis(TOKEN, "not valid", 2026, 1)],
    ];
    for (const [name, call] of calls) {
      const r = await call();
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect((r as { status: number }).status, name).toBe(400);
    }
    const bad = await loadRepoDora(TOKEN, "bad owner!", "web");
    expect(bad).toEqual({ ok: false, status: 400, error: "Invalid owner parameter" });

    expect(github.getRepoOverview).not.toHaveBeenCalled();
    expect(github.getRepoSummary).not.toHaveBeenCalled();
    expect(github.getOctokit).not.toHaveBeenCalled();
    expect(dora.getRepoDoraSummary).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(cacheKeys.seen).toEqual([]);
    fetchSpy.mockRestore();
  });

  it("rejects an out-of-range cost year or month with 400", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await loadCostAnalysis(TOKEN, "acme", 1999, 1)).toEqual({ ok: false, status: 400, error: "Invalid year" });
    expect(await loadCostAnalysis(TOKEN, "acme", NaN, 1)).toEqual({ ok: false, status: 400, error: "Invalid year" });
    expect(await loadCostAnalysis(TOKEN, "acme", 2026, 13)).toEqual({ ok: false, status: 400, error: "Invalid month" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("cache keys", () => {
  it("loadRepoDora uses the same key format as the original route", async () => {
    dora.getRepoDoraSummary.mockResolvedValue({ partial: false });
    const r = await loadRepoDora(TOKEN, "acme", "web");
    expect(r.ok).toBe(true);

    const expected = `github/repo-dora:${hashKey(TOKEN)}:acme:web`;
    expect(cacheKeys.seen).toEqual([expected]);
    expect(repoDoraCacheKey(TOKEN, "acme", "web")).toBe(expected);
    // Format snapshot: prefix, token digest, owner, repo.
    expect(expected.replace(hashKey(TOKEN), "<digest>")).toBe("github/repo-dora:<digest>:acme:web");
  });

  it("keeps the other loaders' keys in the original format", async () => {
    github.listRepos.mockResolvedValue([]);
    github.getRepoOverview.mockResolvedValue({});
    github.getRepoSummary.mockResolvedValue({});
    const { loadRepos } = await import("@/lib/loaders/repos");
    await loadRepos(TOKEN);
    await loadRepoOverview(TOKEN, "acme", "web");
    await loadRepoSummary(TOKEN, "acme", "web");
    const d = hashKey(TOKEN);
    expect(cacheKeys.seen).toEqual([
      `github/repos:${d}`,
      `github/repo-overview:${d}:acme:web`,
      `github/repo-summary:${d}:acme:web`,
    ]);
  });
});

function repo(i: number): Repo {
  return {
    id: i,
    owner: "acme",
    name: `r${i}`,
    full_name: `acme/r${i}`,
    description: null,
    private: false,
    html_url: `https://github.com/acme/r${i}`,
    // Higher index = more recently updated.
    updated_at: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(),
    language: null,
    stargazers_count: 0,
  };
}

function summary(conclusion: "success" | "failure", successRate: number): RepoSummary {
  const at = new Date().toISOString();
  return {
    latest_conclusion: conclusion,
    latest_status: "completed",
    latest_run_at: at,
    latest_actor: null,
    latest_sha: null,
    latest_message: null,
    recent_runs: [{ id: 1, conclusion, status: "completed", created_at: at }],
    trend_30d: [],
    success_rate: successRate,
  };
}

describe("loadFailingWorkflows", () => {
  it("inspects at most 25 of 40 repos, newest first, and reports 25 of 40", async () => {
    github.listRepos.mockResolvedValue(Array.from({ length: 40 }, (_, i) => repo(i)));
    const inspected: string[] = [];
    let inFlight = 0;
    let peak = 0;
    github.getRepoSummary.mockImplementation(async (_t: string, _o: string, name: string) => {
      inspected.push(name);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return summary("failure", 50);
    });

    const r = await loadFailingWorkflows(TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(github.getRepoSummary).toHaveBeenCalledTimes(FAILING_WORKFLOWS_MAX_REPOS);
    expect(r.data.checked).toBe(25);
    expect(r.data.total).toBe(40);
    expect(r.data.failing).toHaveLength(25);
    expect(peak).toBeLessThanOrEqual(5);
    // Repos 15..39 are the 25 most recently updated.
    expect(new Set(inspected)).toEqual(new Set(Array.from({ length: 25 }, (_, i) => `r${i + 15}`)));
  });

  it("returns only failing repos, lowest success rate first, and scopes by owner", async () => {
    const repos = [repo(1), repo(2), repo(3), { ...repo(4), owner: "other", full_name: "other/r4" }];
    github.listRepos.mockResolvedValue(repos);
    github.getRepoSummary.mockImplementation(async (_t: string, _o: string, name: string) => {
      if (name === "r1") return summary("failure", 40);
      if (name === "r2") return summary("success", 100);
      return summary("failure", 10);
    });

    const all = await loadFailingWorkflows(TOKEN);
    expect(all.ok && all.data.failing.map((f) => f.repo)).toEqual(["other/r4", "acme/r3", "acme/r1"]);

    const scoped = await loadFailingWorkflows(TOKEN, "acme");
    expect(scoped.ok && scoped.data.failing.map((f) => f.repo)).toEqual(["acme/r3", "acme/r1"]);
    expect(scoped.ok && { checked: scoped.data.checked, total: scoped.data.total }).toEqual({ checked: 3, total: 3 });
  });

  it("counts a repo whose summary fails as an error instead of aborting", async () => {
    github.listRepos.mockResolvedValue([repo(1), repo(2)]);
    github.getRepoSummary.mockImplementation(async (_t: string, _o: string, name: string) => {
      if (name === "r1") throw new Error("boom");
      return summary("failure", 0);
    });
    const r = await loadFailingWorkflows(TOKEN);
    expect(r.ok && { failing: r.data.failing.length, errors: r.data.errors }).toEqual({ failing: 1, errors: 1 });
  });

  it("returns 400 for an invalid owner without listing repos", async () => {
    const r = await loadFailingWorkflows(TOKEN, "bad owner!");
    expect(r).toEqual({ ok: false, status: 400, error: "Invalid owner parameter" });
    expect(github.listRepos).not.toHaveBeenCalled();
  });
});
