/**
 * /mcp/me hands the docs tools the configured issuer as their origin, never
 * the origin of the incoming request URL (which a proxy or Host header sets).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const handleMeRequest = vi.hoisted(() => vi.fn<(req: Request, origin: string) => Promise<Response>>(async () => new Response("{}", { status: 200 })));
vi.mock("@/lib/mcp/server", () => ({ handleMeRequest }));
vi.mock("@/lib/mcp/auth", () => ({
  bearerToken: () => "token",
  verifyToken: async () => ({ ok: true, authInfo: { token: "token", clientId: "c", scopes: [], extra: { grant_id: "g-1" } } }),
  touchGrant: () => undefined,
  unauthorized: () => new Response(null, { status: 401 }),
  authUnavailable: () => new Response(null, { status: 503 }),
}));

import { POST } from "@/app/mcp/me/route";

beforeEach(() => {
  vi.stubEnv("MODE", "organization");
  vi.stubEnv("GITDASH_MCP", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://gitdash.test");
  handleMeRequest.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/mcp/me docs-tool origin", () => {
  it("is the configured issuer, not the request URL's origin", async () => {
    // Behind a proxy: the URL is the container address; the gate accepts the forwarded host.
    const res = await POST(
      new NextRequest("http://10.0.0.5:3000/mcp/me", {
        method: "POST",
        headers: { "x-forwarded-host": "gitdash.test", "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.20", "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    expect(handleMeRequest).toHaveBeenCalledTimes(1);
    expect(handleMeRequest.mock.calls[0][1]).toBe("https://gitdash.test");
  });
});
