/**
 * Browser cache policy for per-user API responses — the one place it lives.
 *
 * Every response is `private` (never stored by a shared cache) and carries
 * `Vary: Cookie`, so a browser shared by two GitDash users cannot replay one
 * user's cached response to the other after a re-login.
 *
 * These TTLs are the BROWSER's view only. Server-side caching (withCache) has
 * its own, usually longer, TTL per route.
 */

type Headers = Record<string, string>;

/**
 * Feature-flag-gated routes: max-age + stale-while-revalidate stays within the
 * 60-second revocation contract, since a stale response is still shown while
 * the browser revalidates.
 */
export const GATED_MAX_AGE = 30;
export const GATED_SWR = 30;

/** Routes the UI polls every 30s for in-progress runs — must stay fresh. */
export const POLLED_MAX_AGE = 15;

export function privateCacheHeaders(maxAgeSeconds: number, staleWhileRevalidateSeconds = 0): Headers {
  const swr = staleWhileRevalidateSeconds > 0 ? `, stale-while-revalidate=${staleWhileRevalidateSeconds}` : "";
  return { "Cache-Control": `private, max-age=${maxAgeSeconds}${swr}`, Vary: "Cookie" };
}

export function gatedCacheHeaders(): Headers {
  return privateCacheHeaders(GATED_MAX_AGE, GATED_SWR);
}

export function polledCacheHeaders(): Headers {
  return privateCacheHeaders(POLLED_MAX_AGE);
}

export function noStoreHeaders(): Headers {
  return { "Cache-Control": "private, no-store", Vary: "Cookie" };
}

/**
 * True when the client asked to bypass caches via the `X-GitDash-Refresh: 1`
 * header, which src/lib/swr.tsx sends for user-initiated Refresh actions.
 */
export function wantsFresh(req: Request): boolean {
  return req.headers.get("x-gitdash-refresh") === "1";
}
