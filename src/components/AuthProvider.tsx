"use client";

import React, { createContext, useContext } from "react";
import useSWR from "swr";
import { usePathname } from "next/navigation";
import { under } from "@/lib/paths";
import { fetcher } from "@/lib/swr";
import type { AppMode } from "@/lib/mode";
import type { FeatureFlags } from "@/lib/feature-flags";

export interface AuthUser {
  id?: number;
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
}

interface MeResponse {
  user: AuthUser | null;
  mode: AppMode;
  groups?: string[];
  grantedFlags?: (keyof FeatureFlags)[];
  isAdmin?: boolean;
  enforce?: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  mode: AppMode;
  /** The mode as reported by the server; null until /api/auth/me has answered. */
  resolvedMode: AppMode | null;
  groups: string[];
  /** Flags the server allows for this user; null until /api/auth/me has loaded. */
  grantedFlags: (keyof FeatureFlags)[] | null;
  isAdmin: boolean;
  enforce: boolean;
  /** Re-read /api/auth/me (e.g. after a 403, or while waiting on /pending). Resolves when the read finishes. */
  refresh: () => Promise<unknown>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  mode: "standalone",
  resolvedMode: null,
  groups: [],
  grantedFlags: null,
  isAdmin: false,
  enforce: false,
  refresh: async () => {},
});

// Permissions change on the server with a 60s cache; keep the client within
// the same window and re-check when the tab regains focus.
const ME_REFRESH_MS = 60_000;

/** Public content pages that never use the signed-in user: skip the /api/auth/me call there. */
const NO_AUTH_PAGES = ["/docs", "/welcome"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const skip = under(pathname, NO_AUTH_PAGES);
  const { data, isLoading, mutate } = useSWR<MeResponse>(skip ? null : "/api/auth/me", fetcher<MeResponse>, {
    dedupingInterval: ME_REFRESH_MS,
    refreshInterval: ME_REFRESH_MS,
    revalidateOnFocus: true,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });

  return (
    <AuthContext.Provider value={{
      user: data?.user ?? null,
      loading: isLoading,
      mode: data?.mode ?? "standalone",
      resolvedMode: data?.mode ?? null,
      groups: data?.groups ?? [],
      grantedFlags: data ? (data.grantedFlags ?? null) : null,
      isAdmin: data?.isAdmin ?? false,
      enforce: data?.enforce ?? false,
      refresh: () => mutate(),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
