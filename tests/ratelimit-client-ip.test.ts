/**
 * Rate-limit keys come from the address a trusted proxy saw, never from the
 * client-controlled leftmost X-Forwarded-For entry (except on Vercel, which
 * overwrites the header).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { clientIp, getRateLimitKey, rateLimitIdentity } from "@/lib/ratelimit";

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

describe("rate-limit keys for IPv6", () => {
  it("collapse an IPv6 client to its /64, whatever the notation; IPv4 and IPv4-mapped IPv6 key on the IPv4 address", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("GITDASH_TRUSTED_PROXY_HOPS", "");
    const key = (xff: string) => getRateLimitKey(req({ "x-forwarded-for": xff }), "p");
    expect(key("2001:db8:1:2::1")).toBe("p:2001:db8:1:2::/64");
    // Another address in the same /64, in other notations, shares the key.
    expect(key("2001:0db8:0001:0002:ffff:ffff:ffff:fffe")).toBe("p:2001:db8:1:2::/64");
    expect(key("[2001:db8:1:2:aaaa::5]:443")).toBe("p:2001:db8:1:2::/64");
    expect(key("2001:DB8:1:2::7%eth0")).toBe("p:2001:db8:1:2::/64");
    // A different /64 does not.
    expect(key("2001:db8:1:3::1")).toBe("p:2001:db8:1:3::/64");
    expect(key("::ffff:198.51.100.7")).toBe("p:198.51.100.7");
    expect(key("::ffff:c633:6407")).toBe("p:198.51.100.7");
    expect(key("198.51.100.7")).toBe("p:198.51.100.7");
    expect(getRateLimitKey(req({}), "p")).toBe("p:unknown");
  });

  it("rateLimitIdentity leaves anything unparsable unchanged", () => {
    for (const v of ["unknown", "not-an-ip", "1:2:3", "2001:db8::1::2"]) expect(rateLimitIdentity(v)).toBe(v);
  });

  it("clientIp itself stays exact (it also feeds security logs)", () => {
    vi.stubEnv("VERCEL", "");
    expect(clientIp(new Headers({ "x-forwarded-for": "2001:db8:1:2::1" }))).toBe("2001:db8:1:2::1");
  });
});

describe("a private address in the trusted X-Forwarded-For slot", () => {
  it("logs one warning suggesting GITDASH_TRUSTED_PROXY_HOPS, and does not change the selection", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("GITDASH_TRUSTED_PROXY_HOPS", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await import("@/lib/ratelimit");
    expect(m.clientIp(new Headers({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(warn).not.toHaveBeenCalled();
    for (const internal of ["10.1.2.3", "172.20.0.4", "192.168.1.1", "127.0.0.1", "169.254.1.1", "::1", "fd00::1", "fe80::1"]) {
      expect(m.clientIp(new Headers({ "x-forwarded-for": `203.0.113.9, ${internal}` }))).toBe(internal);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("GITDASH_TRUSTED_PROXY_HOPS");
    warn.mockRestore();
  });

  it("is not raised for a public address or on Vercel", async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await import("@/lib/ratelimit");
    vi.stubEnv("VERCEL", "1");
    m.clientIp(new Headers({ "x-forwarded-for": "10.0.0.1" }));
    vi.stubEnv("VERCEL", "");
    m.clientIp(new Headers({ "x-forwarded-for": "10.0.0.1, 100.64.0.1" }));
    m.clientIp(new Headers({ "x-forwarded-for": "2001:db8::1" }));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("the periodic sweep", () => {
  it("keeps an hourly limit for the whole hour, even past the 10-minute sweep", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      const m = await import("@/lib/ratelimit");
      const hour = 60 * 60_000;
      expect(m.rateLimit("sweep:hourly", 1, hour).allowed).toBe(true);
      expect(m.rateLimit("sweep:hourly", 1, hour).allowed).toBe(false);
      // Two sweeps run (at 10 and 20 minutes); the hit is still inside its hour.
      vi.advanceTimersByTime(21 * 60_000);
      expect(m.rateLimit("sweep:hourly", 1, hour).allowed).toBe(false);
      // Past the hour, the hourly key frees up.
      vi.advanceTimersByTime(40 * 60_000);
      expect(m.rateLimit("sweep:hourly", 1, hour).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
