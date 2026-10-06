/**
 * Web sign-in with an explicit redirect_uri. Once the GitHub OAuth App has a
 * second callback URL (the MCP sign-in), GitHub stops matching sub-paths:
 * the login must name the callback, and the code exchange must repeat it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/session")>()),
  getSession: async () => Object.assign(session.current, { save: async () => undefined }),
}));
const lookupWhoAmI = vi.hoisted(() => vi.fn());
vi.mock("@/lib/identity", async (orig) => ({
  ...(await orig<typeof import("@/lib/identity")>()),
  lookupWhoAmI,
  assertOrgModeConfig: () => undefined,
}));
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  upsertUser: async () => undefined,
}));

import { GET as login } from "@/app/api/auth/login/route";
import { GET as callback } from "@/app/api/auth/callback/route";

beforeEach(() => {
  session.current = {};
  vi.stubEnv("MODE", "organization");
  vi.stubEnv("GITHUB_CLIENT_ID", "Iv1.test");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  lookupWhoAmI.mockResolvedValue({ identity: { id: 7, login: "u7", name: null, avatar_url: "", email: null }, allowed: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("web sign-in redirect_uri", () => {
  it("login sends an explicit redirect_uri and the callback repeats it in the code exchange", async () => {
    const headers = { "x-forwarded-host": "dash.example.com", "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.1" };
    const res = await login(new NextRequest("http://0.0.0.0:3000/api/auth/login", { headers }));
    expect(res.status).toBe(307);
    const gh = new URL(res.headers.get("location")!);
    expect(gh.origin + gh.pathname).toBe("https://github.com/login/oauth/authorize");
    const redirectUri = gh.searchParams.get("redirect_uri");
    expect(redirectUri).toBe("https://dash.example.com/api/auth/callback");
    const state = gh.searchParams.get("state")!;

    const exchange = vi.fn(async (_url: string, init: RequestInit) => {
      void init;
      return new Response(JSON.stringify({ access_token: "gho_test" }), { status: 200 });
    });
    vi.stubGlobal("fetch", exchange);
    const back = await callback(new NextRequest(`http://0.0.0.0:3000/api/auth/callback?code=abc&state=${state}`, { headers }));
    expect(new URL(back.headers.get("location")!).pathname).toBe("/");
    expect(exchange).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(exchange.mock.calls[0][1].body));
    expect(body).toMatchObject({ code: "abc", redirect_uri: redirectUri });
  });

  it("with NEXT_PUBLIC_APP_URL set, forwarded headers cannot choose the redirect_uri, and the callback repeats it exactly", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.gitdash.test/");
    const headers = { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.3" };
    const res = await login(new NextRequest("http://0.0.0.0:3000/api/auth/login", { headers }));
    const redirectUri = new URL(res.headers.get("location")!).searchParams.get("redirect_uri");
    expect(redirectUri).toBe("https://www.gitdash.test/api/auth/callback");
    const state = new URL(res.headers.get("location")!).searchParams.get("state")!;

    const exchange = vi.fn(async (_url: string, init: RequestInit) => {
      void init;
      return new Response(JSON.stringify({ access_token: "gho_test" }), { status: 200 });
    });
    vi.stubGlobal("fetch", exchange);
    await callback(new NextRequest(`http://0.0.0.0:3000/api/auth/callback?code=abc&state=${state}`, { headers }));
    expect(JSON.parse(String(exchange.mock.calls[0][1].body)).redirect_uri).toBe(redirectUri);
  });

  it("the web callback is not the MCP callback", async () => {
    const res = await login(new NextRequest("https://www.gitdash.test/api/auth/login", { headers: { "x-forwarded-for": "198.51.100.2" } }));
    expect(new URL(res.headers.get("location")!).searchParams.get("redirect_uri")).toBe("https://www.gitdash.test/api/auth/callback");
  });
});
