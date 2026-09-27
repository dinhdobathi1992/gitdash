/**
 * Lightweight in-process server-side cache with TTL and explicit key invalidation.
 *
 * Intended for caching expensive GitHub API summaries across repeated route
 * renders (e.g. org overview fan-out). Not shared across serverless instances —
 * treat as a request-coalescing layer, not a distributed cache.
 */

import { createHash } from "crypto";
import { l2Get, l2Set, l2Delete } from "./cache-l2";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Cap on stored entries. When exceeded, expired entries are swept first;
 * if still over, the oldest entries (insertion order) are evicted. Prevents
 * unbounded growth on long-lived containers (Docker/k8s deploys).
 */
const MAX_ENTRIES = 2000;

/** In-flight factory calls, so concurrent misses share one execution. */
interface InflightEntry {
  promise: Promise<unknown>;
  /** True when this computation bypasses cached data (a refresh) — a refresh may only join such an entry. */
  fresh: boolean;
}
const inflight = new Map<string, InflightEntry>();

/**
 * Derive a short stable hash from a secret (e.g. a GitHub token) for use in
 * cache keys. Never store or log the raw secret — only this digest.
 * Scoping cache keys by token prevents one user's cached data (which reflects
 * their private-repo visibility) from being served to another user.
 */
export function hashKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

/**
 * Get a cached value by key. Returns undefined if missing or expired.
 */
export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * Set a cache entry with an explicit TTL in seconds.
 */
export function cacheSet<T>(key: string, value: T, ttlSeconds: number): void {
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    // Sweep expired entries first
    const now = Date.now();
    for (const [k, entry] of store.entries()) {
      if (now > entry.expiresAt) store.delete(k);
    }
    // Still over? Evict oldest (Map preserves insertion order)
    while (store.size >= MAX_ENTRIES) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Invalidate a single key.
 */
export function cacheDelete(key: string): void {
  store.delete(key);
}

/**
 * Invalidate all keys matching a prefix.
 */
export function cacheDeleteByPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Partial results (some sub-requests failed) are kept briefly, not for the full TTL. */
export const PARTIAL_TTL_SECONDS = 30;

/** TTL policy for results carrying a `partial` flag: short TTL when partial. */
export function partialAwareTtl<T extends { partial?: boolean }>(ttlSeconds: number) {
  return (value: T) => (value.partial ? PARTIAL_TTL_SECONDS : ttlSeconds);
}

export interface WithCacheOptions<T> {
  /**
   * Return false to hand the value to callers without storing it — e.g. an
   * LLM failure payload. Concurrent callers still share the in-flight result.
   */
  shouldCache?: (value: T) => boolean;
  /**
   * Per-value TTL override in seconds (0 = do not store). Used to keep
   * partial results only briefly — see partialAwareTtl().
   */
  ttlFor?: (value: T) => number;
  /**
   * User-initiated refresh: skip the cached value, recompute, and overwrite
   * it. Joins an in-flight computation only if that one is also a refresh —
   * an ordinary one may be about to return an old shared (L2) row.
   */
  refresh?: boolean;
  /**
   * Also read/write the shared Postgres layer (src/lib/cache-l2.ts) so other
   * instances reuse the result. Only for GitHub DTOs — never for settings,
   * secrets or AI output, which would be stored as plaintext.
   */
  shared?: boolean;
}

/**
 * Wrap an async factory in a cache: if the key is hot, return the cached
 * value; otherwise call factory(), cache the result, and return it.
 *
 * Concurrent misses on the same key coalesce onto a single factory call —
 * without this, N simultaneous cold requests would each run the (expensive)
 * factory, e.g. 3 users opening /org/acme at once = 3 × ~100 GitHub calls.
 * A rejected factory clears the in-flight slot so the next caller retries.
 *
 * @example
 * const data = await withCache(`org-overview:${userKey}:${org}`, 300, () => fetchOrgOverview(org));
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  factory: () => Promise<T>,
  opts: WithCacheOptions<T> = {},
): Promise<T> {
  if (!opts.refresh) {
    const cached = cacheGet<T>(key);
    if (cached !== undefined) return cached;
  }

  const existing = inflight.get(key);
  if (existing && (existing.fresh || !opts.refresh)) return existing.promise as Promise<T>;

  const entry: InflightEntry = { promise: Promise.resolve(), fresh: Boolean(opts.refresh) };
  // Deferred start: the entry is registered before the factory runs, so even a
  // factory that throws synchronously cannot leave a stale in-flight slot.
  const promise = Promise.resolve().then(async () => {
    try {
      // A refresh that replaced this entry owns the key now; a superseded run
      // still answers its own callers but must not write over fresher data.
      const superseded = () => inflight.get(key) !== entry;
      if (opts.shared && !opts.refresh) {
        const hit = await l2Get<T>(key);
        if (hit) {
          if (!superseded()) cacheSet(key, hit.value, hit.ttlSeconds);
          return hit.value;
        }
      }
      const value = await factory();
      if (superseded()) return value;
      const ttl = opts.ttlFor ? opts.ttlFor(value) : ttlSeconds;
      const storable = ttl > 0 && (!opts.shouldCache || opts.shouldCache(value));
      if (storable) {
        cacheSet(key, value, ttl);
        // Awaited (bounded by the L2 timeout) so a later delete/overwrite from
        // this instance can never be overtaken by this write.
        if (opts.shared) await l2Set(key, value, ttl);
      } else if (opts.refresh) {
        cacheDelete(key);
        if (opts.shared) await l2Delete(key);
      }
      return value;
    } finally {
      // A refresh may have replaced this entry; only remove our own.
      if (inflight.get(key) === entry) inflight.delete(key);
    }
  });

  entry.promise = promise;
  inflight.set(key, entry);
  return promise;
}

/**
 * Test hook: drop every entry and in-flight promise, simulating a fresh
 * process (e.g. a second replica with a cold in-memory cache).
 */
export function __resetCacheForTests(): void {
  store.clear();
  inflight.clear();
}

/**
 * Return basic cache stats for observability.
 */
export function cacheStats(): { size: number; keys: string[] } {
  const now = Date.now();
  // Purge expired before reporting
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(key);
  }
  return { size: store.size, keys: Array.from(store.keys()) };
}
