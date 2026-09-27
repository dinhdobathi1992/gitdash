import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, dirname } from "path";
import { __resetCacheForTests } from "@/lib/cache";

// ── Static coverage: every GitHub read route goes through withCache ─────────

const GITHUB_API = join(__dirname, "..", "src", "app", "api", "github");
function routeFiles(dir = GITHUB_API): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return name === "route.ts" ? [p] : [];
  });
}

// Not cached on purpose: a write, and the live rate-limit readout.
const UNCACHED_ALLOWLIST = ["create-issue", "rate-limit"];

describe("withCache coverage", () => {
  it("only the allowlisted /api/github routes skip withCache", () => {
    const uncached = routeFiles()
      .filter((f) => !/withCache(<[^>]*>)?\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(GITHUB_API, dirname(f)))
      .sort();
    expect(uncached).toEqual(UNCACHED_ALLOWLIST);
  });
});

// ── Behaviour: repeat and junk-param requests cost one GitHub call ───────────

const getRepoOverview = vi.fn(async (_t: string, owner: string, repo: string) => ({ owner, repo }));
vi.mock("@/lib/session", () => ({ getTokenFromSession: async () => "test-token" }));
vi.mock("@/lib/github", async (orig) => ({
  ...(await orig<typeof import("@/lib/github")>()),
  getRepoOverview: (...a: Parameters<typeof getRepoOverview>) => getRepoOverview(...a),
}));

const req = (qs: string) => new NextRequest(`http://localhost/api/github/repo-overview?${qs}`);

describe("repo-overview caching", () => {
  beforeEach(() => {
    __resetCacheForTests();
    getRepoOverview.mockClear();
  });

  it("serves a repeat request from cache (one GitHub fetch)", async () => {
    const { GET } = await import("@/app/api/github/repo-overview/route");
    const a = await GET(req("owner=acme&repo=web"));
    const b = await GET(req("owner=acme&repo=web"));
    expect(a.status).toBe(200);
    expect(await b.json()).toEqual({ owner: "acme", repo: "web" });
    expect(getRepoOverview).toHaveBeenCalledTimes(1);
  });

  it("ignores unknown query params when building the key", async () => {
    const { GET } = await import("@/app/api/github/repo-overview/route");
    await GET(req("owner=acme&repo=web&x=1"));
    await GET(req("owner=acme&repo=web&x=2"));
    expect(getRepoOverview).toHaveBeenCalledTimes(1);
  });

  it("keys differ per repo", async () => {
    const { GET } = await import("@/app/api/github/repo-overview/route");
    await GET(req("owner=acme&repo=web"));
    await GET(req("owner=acme&repo=api"));
    expect(getRepoOverview).toHaveBeenCalledTimes(2);
  });
});
