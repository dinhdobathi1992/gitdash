/**
 * Simple in-process sliding-window rate limiter.
 * No external dependencies — works across single-instance deployments.
 * For multi-instance deployments, swap out the store for Redis.
 */

interface WindowEntry {
  timestamps: number[];
}

const store = new Map<string, WindowEntry>();

/**
 * Check whether `key` has exceeded `limit` requests within `windowMs`.
 * Returns { allowed: true } or { allowed: false, retryAfterMs: number }.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Evict timestamps older than the window
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= limit) {
    // Oldest timestamp tells us when a slot will free up
    const oldest = entry.timestamps[0];
    return { allowed: false, retryAfterMs: oldest + windowMs - now };
  }

  entry.timestamps.push(now);
  return { allowed: true };
}

/**
 * Token-hash-keyed limiter for authenticated, cost-bearing routes (v4.1.0).
 *
 * getRateLimitKey() below keys on IP, which is the wrong axis for AI routes:
 * the cost follows the *token*, so one user moving between networks should
 * still be limited. Callers pass hashKey(token) from src/lib/cache.ts —
 * never the raw token.
 *
 * Like the underlying limiter this is in-process, so on a multi-instance
 * deployment it bounds per instance rather than globally. It is one of two
 * guards; the other is the daily token budget in src/lib/ai.ts.
 */
export function aiRateLimit(
  tokenHash: string,
  surface: string,
  limit: number,
): { allowed: boolean; retryAfterMs?: number } {
  return rateLimit(`ai:${surface}:${tokenHash}`, limit, 60_000);
}

/** GITDASH_TRUSTED_PROXY_HOPS as a positive integer; anything else means 1. */
function trustedProxyHops(): number {
  const n = Number(process.env.GITDASH_TRUSTED_PROXY_HOPS);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * The client IP, from headers a trusted proxy controls. The leftmost
 * X-Forwarded-For entry is whatever the client sent, so it is trusted only on
 * Vercel, which overwrites the header (and sets x-real-ip). Elsewhere each
 * proxy appends the address it saw, so the trustworthy entry is the one
 * GITDASH_TRUSTED_PROXY_HOPS from the right (default 1: the rightmost, the
 * address the nearest proxy saw). Set it to the number of proxies in front of
 * GitDash that append to X-Forwarded-For.
 */
export function clientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim() || null;
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (process.env.VERCEL) return realIp ?? chain[0] ?? "unknown";
  if (chain.length > 0) return chain[Math.max(0, chain.length - trustedProxyHops())];
  return realIp ?? "unknown";
}

/** Derive a rate-limit key from the request: `<prefix>:<client IP>` (see clientIp). */
export function getRateLimitKey(req: Request, prefix: string): string {
  return `${prefix}:${clientIp(req.headers as Headers)}`;
}

// Periodically evict fully-expired entries to prevent memory growth.
// Runs every 10 minutes in the background.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.timestamps.every((t) => t < now - 10 * 60 * 1000)) {
        store.delete(key);
      }
    }
  }, 10 * 60 * 1000);
}
