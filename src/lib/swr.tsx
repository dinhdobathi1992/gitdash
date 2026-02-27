"use client";

import { SWRConfig } from "swr";

/**
 * Fetcher that relies on the HTTP-only session cookie set by OAuth callback.
 * No token is passed in the URL or headers — the server reads it from the cookie.
 *
 * Attaches a numeric `status` property to the thrown Error so that the global
 * SWRConfig onError handler can redirect to /login on 401.
 */
export class FetchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new FetchError(
      (body as { error?: string }).error ?? `HTTP ${res.status}`,
      res.status
    );
  }
  return res.json() as Promise<T>;
}

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        dedupingInterval: 300_000,
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
            !["/login", "/setup"].includes(window.location.pathname)
          ) {
            window.location.href = "/";
          }
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
