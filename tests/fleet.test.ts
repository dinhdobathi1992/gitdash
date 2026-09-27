import { describe, it, expect } from "vitest";
import { fleetKpis, sortRepos, failingRepoAttention } from "@/lib/fleet";
import type { Repo, RepoSummary, RepoRunPoint } from "@/lib/github";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const H = 3_600_000;
const run = (id: number, hoursAgo: number, conclusion: string, duration = 60_000, queue = 5_000): RepoRunPoint => ({
  id, status: "completed", conclusion, created_at: new Date(NOW - hoursAgo * H).toISOString(), duration_ms: duration, queue_ms: queue,
});
const summary = (runs: RepoRunPoint[], extra: Partial<RepoSummary> = {}): RepoSummary => ({
  latest_conclusion: runs[0]?.conclusion ?? null, latest_status: "completed", latest_run_at: runs[0]?.created_at ?? null,
  latest_actor: null, latest_sha: null, latest_message: null, recent_runs: runs.slice(0, 10), trend_30d: [], success_rate: 0,
  window_runs: runs, ...extra,
});
const repo = (name: string): Repo => ({ id: name.length, owner: "adi", name, full_name: `adi/${name}`, description: null, private: true, html_url: "", updated_at: null, language: "TypeScript", stargazers_count: 0 });

describe("fleetKpis", () => {
  it("splits current and previous windows and ignores cancelled runs in rates", () => {
    const s = summary([run(1, 2, "success"), run(2, 5, "failure"), run(3, 10, "cancelled"), run(4, 30, "success")]);
    const k = fleetKpis([s], "24h", NOW);
    expect(k.current.runs).toBe(3);
    expect(k.current.successRate).toBe(50);
    expect(k.previous?.runs).toBe(1);
    expect(k.daily.runs.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("returns null previous when nothing ran before the window", () => {
    const k = fleetKpis([summary([run(1, 1, "success")])], "7d", NOW);
    expect(k.previous).toBeNull();
    expect(k.previousGap).toBe("none");
  });

  it("refuses to compare when a repo's 30 fetched runs stop short of the prior window", () => {
    const busy = summary(Array.from({ length: 30 }, (_, i) => run(i, i, "success")));
    const k = fleetKpis([busy], "24h", NOW);
    expect(k.previous).toBeNull();
    expect(k.previousGap).toBe("truncated");
  });
});

describe("sortRepos", () => {
  it("puts failing repositories first under attention", () => {
    const map = new Map([
      ["adi/ok", summary([run(1, 1, "success")], { success_rate_30d: 100 })],
      ["adi/bad", summary([run(2, 1, "failure")], { success_rate_30d: 60 })],
    ]);
    expect(sortRepos([repo("ok"), repo("bad"), repo("unknown")], map, "attention", NOW).map((r) => r.name)).toEqual(["bad", "ok", "unknown"]);
  });
});

describe("failingRepoAttention", () => {
  it("counts the failure streak and names the branch", () => {
    const map = new Map([["adi/api", summary([run(1, 1, "failure"), run(2, 2, "failure"), run(3, 3, "success")], { latest_branch: "main" })]]);
    const [item] = failingRepoAttention([repo("api")], map, NOW);
    expect(item.title).toBe("api is failing on main");
    expect(item.reason).toBe("2 failures in a row");
  });
});
