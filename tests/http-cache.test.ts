import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, dirname } from "path";
import {
  wantsFresh,
  privateCacheHeaders,
  gatedCacheHeaders,
  polledCacheHeaders,
  noStoreHeaders,
  GATED_MAX_AGE,
  GATED_SWR,
  POLLED_MAX_AGE,
} from "@/lib/http-cache";

const API_ROOT = join(__dirname, "..", "src", "app", "api");

function routeFiles(dir = API_ROOT): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return name === "route.ts" ? [p] : [];
  });
}

const routeName = (file: string) => relative(API_ROOT, dirname(file));
const source = (file: string) => readFileSync(file, "utf8");

// Feature-flag-gated routes (plan phase 5 registry) — must use the gated policy.
const GATED = [
  "github/repo-dora", "github/open-pr-health", "github/job-stats", "github/bus-factor",
  "github/security-scan", "github/billing", "github/billing/cost-analysis", "github/runner-stats",
  "github/org-health-scorecard", "github/team-workload-risk",
  "ai/insights", "ai/root-cause", "ai/anomaly-explanation",
];
// Routes the UI polls every 30s for in-progress runs.
const POLLED = ["github/runs", "github/run-details"];
const WORKFLOW_POLL_INTERVAL_S = 30;

describe("http-cache helpers", () => {
  it("every policy is private and varies on Cookie", () => {
    for (const h of [privateCacheHeaders(60, 120), gatedCacheHeaders(), polledCacheHeaders(), noStoreHeaders()]) {
      expect(h["Cache-Control"]).toMatch(/^private, /);
      expect(h.Vary).toBe("Cookie");
    }
  });

  it("formats max-age and optional stale-while-revalidate", () => {
    expect(privateCacheHeaders(60)["Cache-Control"]).toBe("private, max-age=60");
    expect(privateCacheHeaders(60, 120)["Cache-Control"]).toBe("private, max-age=60, stale-while-revalidate=120");
  });

  it("gated responses stay within the 60s revocation contract", () => {
    expect(GATED_MAX_AGE + GATED_SWR).toBeLessThanOrEqual(60);
  });

  it("polled responses expire before the next poll", () => {
    expect(POLLED_MAX_AGE).toBeLessThanOrEqual(WORKFLOW_POLL_INTERVAL_S / 2);
    expect(polledCacheHeaders()["Cache-Control"]).not.toContain("stale-while-revalidate");
  });
});

describe("route header policy (static scan)", () => {
  const files = routeFiles().filter((f) => routeName(f) !== "demo");

  it("no route writes a raw Cache-Control literal or s-maxage", () => {
    const offenders = files.filter((f) => /["'`]cache-control["'`]|s-maxage/i.test(source(f))).map(routeName);
    expect(offenders).toEqual([]);
  });

  it("gated routes use gatedCacheHeaders", () => {
    for (const r of GATED) expect(source(join(API_ROOT, r, "route.ts")), r).toContain("gatedCacheHeaders()");
  });

  it("polled routes use polledCacheHeaders", () => {
    for (const r of POLLED) expect(source(join(API_ROOT, r, "route.ts")), r).toContain("polledCacheHeaders()");
  });

  it("every route that calls GitHub labels its calls for telemetry", () => {
    const callsGitHub = (f: string) =>
      routeName(f).startsWith("github/") || /@\/lib\/(github|ai-snapshots)"/.test(source(f));
    const missing = files
      .filter((f) => callsGitHub(f) && routeName(f) !== "ai/status")
      .filter((f) => !source(f).includes("labelGitHubRoute("))
      .map(routeName);
    expect(missing).toEqual([]);
  });
});

// Former `private, s-maxage` routes were never browser-cached; keep it that way
// so Refresh buttons and post-sync reloads see fresh data.
const NOT_BROWSER_CACHED = [
  "github/repos", "github/orgs", "github/org-repos", "github/repo-overview", "github/repo-summary",
  "github/workflows", "github/audit-log", "github/org-overview", "github/team-stats", "db/trends", "db/runs",
];
// Routes behind a Refresh button must honour ?refresh=1.
const REFRESHABLE = ["github/repos", "github/org-repos", "github/repo-summary", "github/repo-overview", "github/audit-log", "github/runs"];

describe("freshness policy", () => {
  it("routes that were never browser-cached still send max-age=0", () => {
    for (const r of NOT_BROWSER_CACHED) {
      const calls = source(join(API_ROOT, r, "route.ts")).match(/privateCacheHeaders\(([^)]*)\)/g) ?? [];
      expect(calls.length, r).toBeGreaterThan(0);
      for (const c of calls) expect(c, r).toBe("privateCacheHeaders(0)");
    }
  });

  it("refreshable routes pass wantsFresh(req) to withCache", () => {
    for (const r of REFRESHABLE) expect(source(join(API_ROOT, r, "route.ts")), r).toContain("refresh: wantsFresh(req)");
  });

  it("wantsFresh reads the X-GitDash-Refresh header only", () => {
    expect(wantsFresh(new Request("http://x/api/a", { headers: { "X-GitDash-Refresh": "1" } }))).toBe(true);
    expect(wantsFresh(new Request("http://x/api/a", { headers: { "X-GitDash-Refresh": "0" } }))).toBe(false);
    expect(wantsFresh(new Request("http://x/api/a?refresh=1"))).toBe(false);
  });
});
