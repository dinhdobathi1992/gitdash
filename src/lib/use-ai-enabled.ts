"use client";

/**
 * useAiEnabled — is the server's AI layer configured? (v4.1.0)
 *
 * Every AI surface is gated on this. It is deliberately a server probe rather
 * than a client flag: the feature flag in feature-flags.ts is localStorage-
 * backed and can be flipped by anyone, so it controls visibility only. This
 * hook reports what the server can actually do.
 *
 * SWRProvider sets dedupingInterval to 10 minutes, so every call site shares a
 * single request — no extra caching needed here.
 */

import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { AiStatusResponse } from "@/app/api/ai/status/route";

export function useAiEnabled(): {
  enabled: boolean;
  providers: string[];
  isLoading: boolean;
} {
  const { data, isLoading } = useSWR<AiStatusResponse>(
    "/api/ai/status",
    fetcher<AiStatusResponse>,
  );

  return {
    // Default to false while loading so a surface never flashes in and out.
    enabled: data?.enabled ?? false,
    providers: data?.providers ?? [],
    isLoading,
  };
}
