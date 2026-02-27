"use client";

import React, { createContext, useContext } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { AppMode } from "@/lib/mode";

export interface AuthUser {
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  mode: AppMode;
}

const AuthContext = createContext<AuthContextValue>({ user: null, loading: true, mode: "standalone" });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useSWR<{ user: AuthUser | null; mode: AppMode }>(
    "/api/auth/me",
    fetcher<{ user: AuthUser | null; mode: AppMode }>,
    { revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false }
  );

  return (
    <AuthContext.Provider value={{
      user: data?.user ?? null,
      loading: isLoading,
      mode: data?.mode ?? "standalone",
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
