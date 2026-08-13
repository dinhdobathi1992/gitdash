/**
 * Lightweight in-process server-side cache with TTL and explicit key invalidation.
 *
 * Intended for caching expensive GitHub API summaries across repeated route
 * renders (e.g. org overview fan-out). Not shared across serverless instances —
 * treat as a request-coalescing layer, not a distributed cache.
 */

import { createHash } from "crypto";

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
const inflight = new Map<string, Promise<unknown>>();

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
): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== undefined) return cached;

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = (async () => {
    try {
      const value = await factory();
      cacheSet(key, value, ttlSeconds);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
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
