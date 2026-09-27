import { describe, it, expect } from "vitest";
import { repoHealth } from "@/lib/repo-health";
import type { RepoSummary, RepoRunPoint } from "@/lib/github";

const NOW = Date.parse("2026-09-27T10:00:00Z");
const run = (id: number, conclusion: string | null, status = "completed"): RepoRunPoint => ({
  id, conclusion, status, created_at: "2026-09-27T09:00:00Z",
});
const summary = (runs: RepoRunPoint[], latest = "2026-09-27T09:00:00Z"): RepoSummary => ({
  latest_conclusion: runs[0]?.conclusion ?? null, latest_status: runs[0]?.status ?? null, latest_run_at: runs.length ? latest : null,
  latest_actor: null, latest_sha: null, latest_message: null, recent_runs: runs, trend_30d: [], success_rate: 0,
});

describe("repoHealth", () => {
  it("prefers live state", () => {
    expect(repoHealth(summary([run(1, null, "in_progress"), run(2, "failure")]), NOW).key).toBe("running");
    expect(repoHealth(summary([run(1, null, "queued")]), NOW).key).toBe("queued");
  });

  it("skips cancelled runs to find the decisive outcome", () => {
    expect(repoHealth(summary([run(1, "cancelled"), run(2, "failure")]), NOW).key).toBe("failing");
    expect(repoHealth(summary([run(1, "skipped"), run(2, "success")]), NOW).key).toBe("passing");
  });

  it("reports no recent runs for empty or stale repositories", () => {
    expect(repoHealth(summary([]), NOW).key).toBe("none");
    expect(repoHealth(summary([run(1, "success")], "2026-08-01T00:00:00Z"), NOW).key).toBe("none");
  });
});
