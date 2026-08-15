import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The guarantee under test: measured figures never silently replace estimated
 * ones. `source` always says which you are looking at, and a repo with no
 * deployments returns "none" rather than zeros that would read as real.
 */

const listDeployments = vi.fn();
const listDeploymentStatuses = vi.fn();

vi.mock("@/lib/github", () => ({
  getOctokit: () => ({
    rest: {
      repos: {
        listDeployments: (...a: unknown[]) => listDeployments(...a),
        listDeploymentStatuses: (...a: unknown[]) => listDeploymentStatuses(...a),
      },
    },
  }),
}));

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function dep(id: number, environment: string, created_at: string) {
  return { id, environment, created_at, ref: "main", sha: `sha${id}` };
}

/** Status lookups are keyed by deployment_id, so drive them from a map. */
function statusMap(m: Record<number, { state: string; at: string }>) {
  listDeploymentStatuses.mockImplementation(async ({ deployment_id }: { deployment_id: number }) => {
    const s = m[deployment_id];
    return { data: s ? [{ state: s.state, created_at: s.at }] : [] };
  });
}

beforeEach(() => {
  listDeployments.mockReset().mockResolvedValue({ data: [] });
  listDeploymentStatuses.mockReset().mockResolvedValue({ data: [] });
});

async function run(periodDays = 30) {
  const { getDeploymentsSummary } = await import("@/lib/deployments");
  return getDeploymentsSummary("tok", "o", "r", periodDays);
}

describe("getDeploymentsSummary — provenance", () => {
  it('reports source "none" when the repo has no deployments', async () => {
    const r = await run();
    expect(r.source).toBe("none");
    expect(r.deploys_per_day).toBeNull();
    expect(r.change_failure_rate_pct).toBeNull();
  });

  it('reports source "none" when the API is unavailable, without throwing', async () => {
    listDeployments.mockRejectedValue(Object.assign(new Error("404"), { status: 404 }));
    const r = await run();
    expect(r.source).toBe("none");
    expect(r.total_deployments).toBe(0);
  });

  it('reports source "none" when every deployment predates the window', async () => {
    listDeployments.mockResolvedValue({ data: [dep(1, "production", daysAgo(90))] });
    const r = await run(30);
    expect(r.source).toBe("none");
  });

  it('reports source "deployments" once there is data in the window', async () => {
    listDeployments.mockResolvedValue({ data: [dep(1, "production", daysAgo(2))] });
    statusMap({ 1: { state: "success", at: daysAgo(2) } });
    const r = await run();
    expect(r.source).toBe("deployments");
  });
});

describe("getDeploymentsSummary — production environment selection", () => {
  it("prefers a conventionally named production environment", async () => {
    listDeployments.mockResolvedValue({
      data: [
        dep(1, "staging", daysAgo(1)), dep(2, "staging", daysAgo(2)),
        dep(3, "staging", daysAgo(3)), dep(4, "production", daysAgo(4)),
      ],
    });
    statusMap({});
    // staging is busier, but production is what the headline should describe.
    expect((await run()).production_environment).toBe("production");
  });

  it("falls back to the busiest environment when no conventional name exists", async () => {
    listDeployments.mockResolvedValue({
      data: [dep(1, "eu-west", daysAgo(1)), dep(2, "eu-west", daysAgo(2)), dep(3, "canary", daysAgo(3))],
    });
    statusMap({});
    expect((await run()).production_environment).toBe("eu-west");
  });
});

describe("getDeploymentsSummary — rates", () => {
  it("counts only SUCCESSFUL production deploys toward frequency", async () => {
    listDeployments.mockResolvedValue({
      data: [
        dep(1, "production", daysAgo(1)), dep(2, "production", daysAgo(2)),
        dep(3, "production", daysAgo(3)),
      ],
    });
    statusMap({
      1: { state: "success", at: daysAgo(1) },
      2: { state: "failure", at: daysAgo(2) }, // a failed rollout is not a delivery
      3: { state: "success", at: daysAgo(3) },
    });
    const r = await run(30);
    // 2 successes / 30 days, rounded to 2dp for display.
    expect(r.deploys_per_day).toBe(0.07);
    expect(r.change_failure_rate_pct).toBe(33); // 1 of 3 conclusive
  });

  it("excludes pending and in-progress deploys from the failure rate", async () => {
    listDeployments.mockResolvedValue({
      data: [
        dep(1, "production", daysAgo(1)), dep(2, "production", daysAgo(2)),
        dep(3, "production", daysAgo(3)),
      ],
    });
    statusMap({
      1: { state: "success", at: daysAgo(1) },
      2: { state: "in_progress", at: daysAgo(2) },
      3: { state: "failure", at: daysAgo(3) },
    });
    // 1 failure of 2 conclusive — the in-progress one is not counted either way.
    expect((await run()).change_failure_rate_pct).toBe(50);
  });

  it("returns a null failure rate rather than 0% when nothing is conclusive", async () => {
    listDeployments.mockResolvedValue({ data: [dep(1, "production", daysAgo(1))] });
    statusMap({ 1: { state: "pending", at: daysAgo(1) } });
    // 0% would read as flawless delivery; null reads as no signal.
    expect((await run()).change_failure_rate_pct).toBeNull();
  });

  it("segments stats by environment", async () => {
    listDeployments.mockResolvedValue({
      data: [
        dep(1, "production", daysAgo(1)), dep(2, "staging", daysAgo(2)), dep(3, "staging", daysAgo(3)),
      ],
    });
    statusMap({
      1: { state: "success", at: daysAgo(1) },
      2: { state: "failure", at: daysAgo(2) },
      3: { state: "success", at: daysAgo(3) },
    });
    const r = await run();
    const staging = r.by_environment.find((e) => e.environment === "staging")!;
    expect(staging.total).toBe(2);
    expect(staging.failure_rate_pct).toBe(50);
  });
});

describe("getDeploymentsSummary — MTTR", () => {
  it("measures from failure to the next success", async () => {
    listDeployments.mockResolvedValue({
      data: [dep(1, "production", hoursAgo(10)), dep(2, "production", hoursAgo(6))],
    });
    statusMap({
      1: { state: "failure", at: hoursAgo(10) },
      2: { state: "success", at: hoursAgo(6) },
    });
    const r = await run();
    expect(r.mttr_hours).toBeCloseTo(4, 0);
    expect(r.mttr_samples).toBe(1);
  });

  it("measures from the FIRST failure of a streak, not the last", async () => {
    // Recovery starts when things broke, not at the final symptom before the fix.
    listDeployments.mockResolvedValue({
      data: [
        dep(1, "production", hoursAgo(12)),
        dep(2, "production", hoursAgo(10)),
        dep(3, "production", hoursAgo(2)),
      ],
    });
    statusMap({
      1: { state: "failure", at: hoursAgo(12) },
      2: { state: "failure", at: hoursAgo(10) },
      3: { state: "success", at: hoursAgo(2) },
    });
    const r = await run();
    expect(r.mttr_hours).toBeCloseTo(10, 0); // 12h → 2h, not 10h → 2h
    expect(r.mttr_samples).toBe(1);
  });

  it("returns null with zero samples when nothing ever failed", async () => {
    listDeployments.mockResolvedValue({ data: [dep(1, "production", daysAgo(1))] });
    statusMap({ 1: { state: "success", at: daysAgo(1) } });
    const r = await run();
    expect(r.mttr_hours).toBeNull();
    expect(r.mttr_samples).toBe(0);
  });

  it("ignores a failure that was never recovered", async () => {
    listDeployments.mockResolvedValue({ data: [dep(1, "production", hoursAgo(5))] });
    statusMap({ 1: { state: "failure", at: hoursAgo(5) } });
    const r = await run();
    expect(r.mttr_hours).toBeNull(); // still broken — not a recovery time
  });

  it("averages across multiple recoveries", async () => {
    listDeployments.mockResolvedValue({
      data: [
        dep(1, "production", hoursAgo(20)), dep(2, "production", hoursAgo(18)),
        dep(3, "production", hoursAgo(10)), dep(4, "production", hoursAgo(4)),
      ],
    });
    statusMap({
      1: { state: "failure", at: hoursAgo(20) },
      2: { state: "success", at: hoursAgo(18) }, // 2h
      3: { state: "failure", at: hoursAgo(10) },
      4: { state: "success", at: hoursAgo(4) },  // 6h
    });
    const r = await run();
    expect(r.mttr_samples).toBe(2);
    expect(r.mttr_hours).toBeCloseTo(4, 0);
  });
});

describe("getDeploymentsSummary — resilience", () => {
  it("flags partial when a status fetch fails but still returns figures", async () => {
    listDeployments.mockResolvedValue({
      data: [dep(1, "production", daysAgo(1)), dep(2, "production", daysAgo(2))],
    });
    listDeploymentStatuses.mockImplementation(async ({ deployment_id }: { deployment_id: number }) => {
      if (deployment_id === 2) throw new Error("boom");
      return { data: [{ state: "success", created_at: daysAgo(1) }] };
    });
    const r = await run();
    expect(r.partial).toBe(true);
    expect(r.total_deployments).toBe(2);
    expect(r.successful).toBe(1);
  });

  it("treats a deployment with no status as inconclusive rather than failed", async () => {
    listDeployments.mockResolvedValue({ data: [dep(1, "production", daysAgo(1))] });
    statusMap({}); // no statuses at all
    const r = await run();
    expect(r.failed).toBe(0);
    expect(r.change_failure_rate_pct).toBeNull();
  });
});
