import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { sealData } from "iron-session";
import { proxy } from "@/proxy";
import { sessionOptions } from "@/lib/session";

/** Signed-out visitors at "/" see the product page only when GITDASH_LANDING_PAGE=true. */

const request = async (path: string, session?: Record<string, unknown>) => {
  const req = new NextRequest(`http://localhost${path}`);
  if (session) {
    req.cookies.set(sessionOptions.cookieName, await sealData(session, { password: sessionOptions.password as string }));
  }
  return proxy(req);
};

const location = (res: Response) => {
  const to = res.headers.get("location");
  return to ? new URL(to).pathname : null;
};

describe("proxy — product landing page", () => {
  afterEach(() => vi.unstubAllEnvs());

  const orgMode = () => {
    vi.stubEnv("MODE", "organization");
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("GITDASH_ADMIN_GITHUB_IDS", "1");
    vi.stubEnv("GITDASH_ALLOWED_ORGS", "acme");
  };

  it("organization mode: signed-out '/' goes to /welcome when enabled", async () => {
    orgMode();
    vi.stubEnv("GITDASH_LANDING_PAGE", "true");
    expect(location(await request("/"))).toBe("/welcome");
  });

  it("organization mode: signed-out '/' goes to /login when not enabled", async () => {
    orgMode();
    expect(location(await request("/"))).toBe("/login");
  });

  it("organization mode: other signed-out pages still go to /login when enabled", async () => {
    orgMode();
    vi.stubEnv("GITDASH_LANDING_PAGE", "true");
    expect(location(await request("/team"))).toBe("/login");
  });

  it("standalone mode: signed-out '/' goes to /welcome when enabled, /setup otherwise", async () => {
    vi.stubEnv("MODE", "standalone");
    expect(location(await request("/"))).toBe("/setup");
    vi.stubEnv("GITDASH_LANDING_PAGE", "true");
    expect(location(await request("/"))).toBe("/welcome");
  });

  it("standalone mode: a signed-in visitor at '/' reaches the dashboard", async () => {
    vi.stubEnv("MODE", "standalone");
    vi.stubEnv("GITDASH_LANDING_PAGE", "true");
    const res = await request("/", { pat: "ghp_test" });
    expect(location(res)).toBeNull();
  });

  it("/welcome and /login are reachable signed out", async () => {
    orgMode();
    vi.stubEnv("GITDASH_LANDING_PAGE", "true");
    expect(location(await request("/welcome"))).toBeNull();
    expect(location(await request("/login"))).toBeNull();
  });
});
