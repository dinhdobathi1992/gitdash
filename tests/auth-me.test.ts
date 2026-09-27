import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const resolveIdentity = vi.fn();
const resolveAccess = vi.fn();
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  resolveIdentity: (...a: unknown[]) => resolveIdentity(...a),
  resolveAccess: (...a: unknown[]) => resolveAccess(...a),
}));
vi.mock("@/lib/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/session")>()),
  getSession: async () => ({ pat: "ghp_x" }),
}));

describe("GET /api/auth/me (organization mode)", () => {
  beforeEach(() => {
    vi.stubEnv("MODE", "organization");
    resolveIdentity.mockReset();
    resolveAccess.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  const call = async () => {
    const { GET } = await import("@/app/api/auth/me/route");
    const res = await GET();
    return { status: res.status, body: await res.json() };
  };

  it("returns identity, groups and grants", async () => {
    resolveIdentity.mockResolvedValue({ identity: { id: 7, login: "u7" }, allowed: true });
    resolveAccess.mockResolvedValue({ githubId: 7, groups: ["dev"], flags: ["dora"], isAdmin: false });
    vi.stubEnv("GITDASH_RBAC_ENFORCE", "true");
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toMatchObject({ groups: ["dev"], grantedFlags: ["dora"], isAdmin: false, enforce: true });
  });

  it("only a token GitHub rejects is a 401 (client restarts sign-in)", async () => {
    resolveIdentity.mockRejectedValue(Object.assign(new Error("Bad credentials"), { status: 401 }));
    expect((await call()).status).toBe(401);
  });

  it("outages are a 503, never a 401 (no reload loop)", async () => {
    resolveIdentity.mockRejectedValue(Object.assign(new Error("rate limited"), { status: 403 }));
    const r = await call();
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("authz_unavailable");
    resolveIdentity.mockResolvedValue({ identity: { id: 7, login: "u7" }, allowed: true });
    resolveAccess.mockRejectedValue(new Error("db down"));
    expect((await call()).status).toBe(503);
  });

  it("an account outside the allowed orgs is a 403", async () => {
    resolveIdentity.mockResolvedValue({ identity: { id: 7, login: "u7" }, allowed: false });
    expect((await call()).status).toBe(403);
  });
});
