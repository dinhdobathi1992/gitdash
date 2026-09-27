"use client";

import { SWRConfig, useSWRConfig, mutate as globalMutate } from "swr";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Fetcher that relies on the HTTP-only session cookie set by OAuth callback.
 * No token is passed in the URL or headers — the server reads it from the cookie.
 *
 * Attaches a numeric `status` property to the thrown Error so that the global
 * SWRConfig onError handler can redirect to /login on 401.
 */
export class FetchError extends Error {
  status: number;
  /** Machine-readable reason from the API (e.g. "no_groups", "forbidden", "authz_unavailable"). */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ── Fresh fetches for Refresh buttons ─────────────────────────────────────────
// API responses are cached in the browser and on the server. A user-initiated
// Refresh must bypass both, so it marks the URLs it is about to revalidate.
// For a few seconds, matching fetches send `X-GitDash-Refresh: 1` (server
// cache bypass) with `cache: "reload"`, which skips the browser cache AND
// replaces its entry for the same URL, so a later revalidation cannot bring
// the pre-refresh response back.

const FRESH_WINDOW_MS = 5_000;
const freshRequests: { match: (url: string) => boolean; until: number }[] = [];

/** Mark URLs (exact string or predicate) so fetches in the next few seconds skip every cache. */
export function requestFresh(match: string | ((url: string) => boolean)): void {
  const fn = typeof match === "string" ? (u: string) => u === match : match;
  freshRequests.push({ match: fn, until: Date.now() + FRESH_WINDOW_MS });
}

function isMarkedFresh(url: string): boolean {
  const now = Date.now();
  for (let i = freshRequests.length - 1; i >= 0; i--) {
    if (freshRequests[i].until < now) freshRequests.splice(i, 1);
  }
  return freshRequests.some((f) => f.match(url));
}

// ── Last successful load (top bar "Updated n min ago") ─────────────────────────
// Browser-side time of the most recent successful API response. It is when
// this tab last received data, not when GitHub was last queried — server
// caches may be older, which the top bar says in its tooltip.

let lastLoadedAt = 0;
const loadListeners = new Set<() => void>();

function markLoaded() {
  lastLoadedAt = Date.now();
  for (const l of loadListeners) l();
}

function subscribeLoaded(l: () => void) {
  loadListeners.add(l);
  return () => { loadListeners.delete(l); };
}

/** Epoch ms of the last successful API response in this tab; 0 before any. */
export function useLastLoadedAt(): number {
  return useSyncExternalStore(subscribeLoaded, () => lastLoadedAt, () => 0);
}

/**
 * Global Refresh for the top bar: every SWR key on the page revalidates,
 * bypassing the browser and server caches (see requestFresh above).
 */
export function useRefreshAll(): () => Promise<unknown> {
  const { mutate } = useSWRConfig();
  return useCallback(() => {
    requestFresh(() => true);
    // Matcher only (no data argument) = revalidate in place. Passing
    // `undefined` as data would clear every cached value first.
    return mutate(() => true);
  }, [mutate]);
}

export async function fetcher<T>(url: string): Promise<T> {
  const fresh = isMarkedFresh(url);
  const res = await fetch(url, {
    credentials: "same-origin",
    ...(fresh ? { cache: "reload" as const, headers: { "X-GitDash-Refresh": "1" } } : {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new FetchError(
      (body as { error?: string }).error ?? `HTTP ${res.status}`,
      res.status,
      (body as { code?: string }).code,
    );
  }
  const data = (await res.json()) as T;
  markLoaded();
  return data;
}

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        dedupingInterval: 600_000,   // 10 min — dedup across all components on the same URL
        keepPreviousData: true,       // show stale data instantly while revalidating (no loading flash)
        errorRetryCount: 2,
        onError(err: unknown) {
          // If any API call returns 401 (session expired / missing), redirect to the
          // auth entry-point. We redirect to "/" and let the proxy middleware forward
          // to /login (organization mode) or /setup (standalone mode) based on MODE.
          //
          // Guard: skip if already on the auth pages to prevent infinite reload loops
          // (AuthProvider calls /api/auth/me on /login and /setup, which returns 401
          // for unauthenticated users).
          if (
            err instanceof FetchError &&
            err.status === 401 &&
            typeof window !== "undefined" &&
            !["/login", "/setup", "/docs"].includes(window.location.pathname)
          ) {
            // The session expired. A hard reload drops the stale cache rather than
            // carrying it into the re-authenticated session.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = "/";
          }
          // Organization mode: signed in but not in any group yet.
          if (
            err instanceof FetchError &&
            err.status === 403 &&
            err.code === "no_groups" &&
            typeof window !== "undefined" &&
            window.location.pathname !== "/pending"
          ) {
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = "/pending";
          }
          // A feature was revoked: re-read /api/auth/me so the UI stops offering it.
          if (err instanceof FetchError && err.status === 403 && err.code === "forbidden") {
            void globalMutate("/api/auth/me");
          }
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
