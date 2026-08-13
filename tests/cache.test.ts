import { describe, it, expect } from "vitest";
import {
  withCache,
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheDeleteByPrefix,
  hashKey,
} from "@/lib/cache";

describe("withCache", () => {
  it("returns the cached value on a hot key without calling the factory", async () => {
    let calls = 0;
    const factory = async () => {
      calls++;
      return "value";
    };
    const a = await withCache("t:hot", 60, factory);
    const b = await withCache("t:hot", 60, factory);
    expect(a).toBe("value");
    expect(b).toBe("value");
    expect(calls).toBe(1);
  });

  it("coalesces concurrent misses onto a single factory call", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const factory = async () => {
      calls++;
      await gate;
      return calls;
    };

    const p1 = withCache("t:concurrent", 60, factory);
    const p2 = withCache("t:concurrent", 60, factory);
    const p3 = withCache("t:concurrent", 60, factory);
    release();

    const results = await Promise.all([p1, p2, p3]);
    expect(calls).toBe(1);
    expect(results).toEqual([1, 1, 1]);
  });

  it("does not cache a rejected factory; the next caller retries", async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("boom");
    };
    await expect(withCache("t:reject", 60, failing)).rejects.toThrow("boom");

    const ok = await withCache("t:reject", 60, async () => {
      calls++;
      return "recovered";
    });
    expect(ok).toBe("recovered");
    expect(calls).toBe(2);
  });
});

describe("cache primitives", () => {
  it("expires entries after their TTL", () => {
    cacheSet("t:ttl", "v", -1); // already expired
    expect(cacheGet("t:ttl")).toBeUndefined();
  });

  it("deletes by key and by prefix", () => {
    cacheSet("t:pfx:a", 1, 60);
    cacheSet("t:pfx:b", 2, 60);
    cacheSet("t:other", 3, 60);
    cacheDelete("t:other");
    cacheDeleteByPrefix("t:pfx:");
    expect(cacheGet("t:pfx:a")).toBeUndefined();
    expect(cacheGet("t:pfx:b")).toBeUndefined();
    expect(cacheGet("t:other")).toBeUndefined();
  });
});

describe("hashKey", () => {
  it("is deterministic, short, and never contains the secret", () => {
    const secret = "ghp_super_secret_token_value";
    const a = hashKey(secret);
    const b = hashKey(secret);
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
    expect(a).not.toContain(secret);
    expect(hashKey("other")).not.toBe(a);
  });
});
