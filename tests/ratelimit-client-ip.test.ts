/**
 * Rate-limit keys come from the address a trusted proxy saw, never from the
 * client-controlled leftmost X-Forwarded-For entry (except on Vercel, which
 * overwrites the header).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { clientIp, getRateLimitKey } from "@/lib/ratelimit";

const req = (headers: Record<string, string>) => new Request("https://gitdash.test/x", { headers });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getRateLimitKey client IP", () => {
  it("ignores a spoofed leftmost X-Forwarded-For entry: the rightmost (nearest proxy) wins by default", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("GITDASH_TRUSTED_PROXY_HOPS", "");
    const a = getRateLimitKey(req({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }), "p");
    const b = getRateLimitKey(req({ "x-forwarded-for": "2.2.2.2, 203.0.113.7" }), "p");
    expect(a).toBe("p:203.0.113.7");
    expect(b).toBe(a);
  });

  it("GITDASH_TRUSTED_PROXY_HOPS=N takes the entry N hops from the right", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("GITDASH_TRUSTED_PROXY_HOPS", "2");
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.4, 10.0.0.2" }))).toBe("198.51.100.4");
    // Fewer entries than hops: the leftmost is the best available.
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("an invalid hop count falls back to 1", () => {
    vi.stubEnv("VERCEL", "");
    for (const bad of ["0", "-1", "abc", "1.5"]) {
      vi.stubEnv("GITDASH_TRUSTED_PROXY_HOPS", bad);
      expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" })), bad).toBe("198.51.100.4");
    }
  });

  it("without X-Forwarded-For: x-real-ip, then unknown", () => {
    vi.stubEnv("VERCEL", "");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    expect(getRateLimitKey(req({}), "p")).toBe("p:unknown");
  });

  it("strips ports so one client keeps one key across connections", () => {
    vi.stubEnv("VERCEL", "");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 198.51.100.7:51234" }))).toBe("198.51.100.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "[2001:db8::1]:443" }))).toBe("2001:db8::1");
    expect(clientIp(new Headers({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.9:8080" }))).toBe("198.51.100.9");
  });

  it("on Vercel: x-real-ip, falling back to the leftmost X-Forwarded-For entry", () => {
    vi.stubEnv("VERCEL", "1");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "198.51.100.2, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers({}))).toBe("unknown");
  });
});
