/**
 * /oauth and /.well-known get baseline security headers from next.config.ts
 * even when MCP is off. When it is on, the routes set their own headers too;
 * the shared ones must carry the same value, so a response never has two
 * different values for one header.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function rules(nodeEnv: string): Promise<HeaderRule[]> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  const config = (await import("../next.config")).default;
  return (await config.headers!()) as HeaderRule[];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config.ts headers for the MCP OAuth paths", () => {
  it("sends nosniff, X-Frame-Options DENY, Referrer-Policy same-origin and HSTS on /oauth and /.well-known", async () => {
    const all = await rules("production");
    for (const source of ["/oauth/:path*", "/.well-known/:path*"]) {
      const rule = all.find((r) => r.source === source);
      expect(rule, source).toBeDefined();
      expect(Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]))).toEqual({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "same-origin",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      });
    }
  });

  it("omits HSTS outside production", async () => {
    const rule = (await rules("development")).find((r) => r.source === "/oauth/:path*")!;
    expect(rule.headers.map((h) => h.key)).not.toContain("Strict-Transport-Security");
  });

  it("the global block (CORS null, the app CSP) still excludes these paths", async () => {
    const global = (await rules("production")).find((r) => r.headers.some((h) => h.key === "Access-Control-Allow-Origin"))!;
    const re = new RegExp(`^${global.source}$`);
    for (const path of ["/oauth/token", "/oauth/authorize", "/.well-known/oauth-authorization-server", "/mcp/me"]) {
      expect(re.test(path), path).toBe(false);
    }
    expect(re.test("/settings")).toBe(true);
  });

  it("every header the routes also set carries the same value (one value per header)", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    const { pageHeaders, corsJson } = await import("@/lib/mcp/oauth/headers");
    const rule = (await rules("production")).find((r) => r.source === "/oauth/:path*")!;
    const page = pageHeaders();
    const machine = corsJson({}).headers;
    for (const { key, value } of rule.headers) {
      if (page.has(key)) expect(page.get(key), `page ${key}`).toBe(value);
      if (machine.has(key)) expect(machine.get(key), `machine ${key}`).toBe(value);
    }
  });
});
