import { describe, it, expect } from "vitest";
import {
  withCache,
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheDeleteByPrefix,
  hashKey,
  partialAwareTtl,
  PARTIAL_TTL_SECONDS,
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

describe("withCache shouldCache", () => {
  it("returns but does not store a value rejected by shouldCache", async () => {
    let calls = 0;
    const factory = async () => ({ n: ++calls, partial: true });
    const opts = { shouldCache: (v: { partial: boolean }) => !v.partial };
    expect((await withCache("sc:partial", 60, factory, opts)).n).toBe(1);
    expect((await withCache("sc:partial", 60, factory, opts)).n).toBe(2);
    expect(cacheGet("sc:partial")).toBeUndefined();
  });

  it("stores a value accepted by shouldCache", async () => {
    let calls = 0;
    const factory = async () => ({ n: ++calls, partial: false });
    const opts = { shouldCache: (v: { partial: boolean }) => !v.partial };
    await withCache("sc:full", 60, factory, opts);
    await withCache("sc:full", 60, factory, opts);
    expect(calls).toBe(1);
  });

  it("concurrent callers still share one factory call when the result is not cached", async () => {
    let calls = 0;
    const factory = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { failed: true };
    };
    const opts = { shouldCache: () => false };
    const [a, b] = await Promise.all([
      withCache("sc:concurrent", 60, factory, opts),
      withCache("sc:concurrent", 60, factory, opts),
    ]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });
});

describe("withCache refresh and ttlFor", () => {
  it("refresh skips the cached value and overwrites it", async () => {
    let calls = 0;
    const factory = async () => ++calls;
    await withCache("rf:1", 60, factory);
    expect(await withCache("rf:1", 60, factory)).toBe(1);
    expect(await withCache("rf:1", 60, factory, { refresh: true })).toBe(2);
    expect(await withCache("rf:1", 60, factory)).toBe(2);
  });

  it("refresh with a non-storable result evicts the stale entry", async () => {
    await withCache("rf:2", 60, async () => ({ ok: true }));
    await withCache("rf:2", 60, async () => ({ failed: true }), { refresh: true, shouldCache: () => false });
    expect(cacheGet("rf:2")).toBeUndefined();
  });

  it("ttlFor 0 does not store; partialAwareTtl keeps partials briefly", async () => {
    await withCache("tf:0", 60, async () => 1, { ttlFor: () => 0 });
    expect(cacheGet("tf:0")).toBeUndefined();
    const ttl = partialAwareTtl<{ partial?: boolean }>(300);
    expect(ttl({ partial: true })).toBe(PARTIAL_TTL_SECONDS);
    expect(ttl({ partial: false })).toBe(300);
    expect(ttl({})).toBe(300);
  });
});

describe("withCache in-flight rules", () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("a refresh does not join an ordinary in-flight run", async () => {
    const slow = deferred<string>();
    const normal = withCache("if:1", 60, () => slow.promise);
    const fresh = withCache("if:1", 60, async () => "fresh", { refresh: true });
    expect(await fresh).toBe("fresh");
    slow.resolve("stale");
    expect(await normal).toBe("stale");
    // The superseded ordinary run must not overwrite the refreshed value.
    expect(cacheGet("if:1")).toBe("fresh");
  });

  it("an ordinary call joins an in-flight refresh", async () => {
    const d = deferred<string>();
    let calls = 0;
    const r = withCache("if:2", 60, () => { calls++; return d.promise; }, { refresh: true });
    const n = withCache("if:2", 60, async () => { calls++; return "other"; });
    d.resolve("fresh");
    expect(await Promise.all([r, n])).toEqual(["fresh", "fresh"]);
    expect(calls).toBe(1);
  });

  it("a factory that throws synchronously does not leave a stuck slot", async () => {
    const boom = (() => { throw new Error("sync boom"); }) as unknown as () => Promise<number>;
    await expect(withCache("if:3", 60, boom)).rejects.toThrow("sync boom");
    expect(await withCache("if:3", 60, async () => 7)).toBe(7);
  });

  it("rejections reach every joined caller and clear the slot", async () => {
    const d = deferred<number>();
    const a = withCache("if:4", 60, () => d.promise.then(() => { throw new Error("fail"); }));
    const b = withCache("if:4", 60, async () => 1);
    d.resolve(0);
    await expect(a).rejects.toThrow("fail");
    await expect(b).rejects.toThrow("fail");
    expect(await withCache("if:4", 60, async () => 2)).toBe(2);
  });
});
