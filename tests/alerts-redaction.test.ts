import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const rules = [
  { id: 1, scope: "repo:o/visible", metric: "failure_rate", destination: "https://hooks.slack.com/services/T0/B0/secret" },
  { id: 2, scope: "repo:o/hidden", metric: "failure_rate", destination: "ops@example.com" },
  { id: 3, scope: "global", metric: "failure_rate", destination: null },
];
const events = [
  { id: 10, scope: "repo:o/visible", details: { repo: "o/visible" } },
  { id: 11, scope: "global", details: { repo: "o/hidden" } },
];
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  getAllAlertRules: async () => rules,
  getRecentAlertEvents: async () => events,
}));
vi.mock("@/lib/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/session")>()),
  getTokenFromSession: async () => "tok",
}));
vi.mock("@/lib/repo-access", () => ({
  canSeeRepo: async (_t: string, _o: string, repo: string) => repo === "visible",
  canSeeOwner: async () => false,
}));
const isAdmin = vi.fn();
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  requireAccess: async () => null,
  isCurrentUserAdmin: () => isAdmin(),
}));

const get = async () => {
  const { GET } = await import("@/app/api/alerts/route");
  return (await GET(new NextRequest("http://localhost/api/alerts?events=1"))).json();
};

describe("GET /api/alerts", () => {
  beforeEach(() => isAdmin.mockReset());

  it("non-admins see only rules/events for repos they can see, without destinations", async () => {
    isAdmin.mockResolvedValue(false);
    const body = await get();
    expect(body.rules.map((r: { id: number }) => r.id)).toEqual([1, 3]);
    expect(body.rules.every((r: { destination: unknown }) => r.destination === null)).toBe(true);
    expect(body.events.map((e: { id: number }) => e.id)).toEqual([10]); // global event about a hidden repo is dropped
  });

  it("admins see everything, including destinations", async () => {
    isAdmin.mockResolvedValue(true);
    const body = await get();
    expect(body.rules).toHaveLength(3);
    expect(body.rules[0].destination).toContain("hooks.slack.com");
    expect(body.events).toHaveLength(2);
  });
});

describe("GET /api/health", () => {
  it("reports 503 with a generic reason when organization mode is misconfigured", async () => {
    vi.resetModules();
    vi.stubEnv("MODE", "organization");
    vi.stubEnv("DATABASE_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("DATABASE_URL");
    vi.unstubAllEnvs();
  });
});
