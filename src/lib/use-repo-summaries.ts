"use client";

/**
 * Loads repo summaries for the repositories page in one bounded batch, so
 * sorting ("Needs attention first"), filter counts and fleet KPIs see the
 * whole list instead of whichever rows happened to scroll into view.
 *
 * Capped at SUMMARY_CAP most recently updated repos (the list arrives sorted
 * by `updated desc`) — each summary is one GitHub API call. Every result is
 * also written to its own `/api/github/repo-summary?…` SWR key, which the
 * sidebar's pinned list and other pages share.
 */

import { useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetcher } from "@/lib/swr";
import type { Repo, RepoSummary } from "@/lib/github";

export const SUMMARY_CAP = 50;
const CONCURRENCY = 6;
const EMPTY = new Map<string, RepoSummary>();

export const summaryKey = (owner: string, name: string) => `/api/github/repo-summary?owner=${owner}&repo=${name}`;

export function useRepoSummaries(repos: Repo[] | undefined) {
  const { mutate } = useSWRConfig();
  const target = useMemo(() => (repos ?? []).slice(0, SUMMARY_CAP), [repos]);
  const batchKey = target.length ? ["repo-summaries", ...target.map((r) => r.full_name)].join("|") : null;

  const swr = useSWR<Map<string, RepoSummary>>(batchKey, async () => {
    const out = new Map<string, RepoSummary>();
    let next = 0;
    async function worker() {
      while (next < target.length) {
        const r = target[next++];
        const key = summaryKey(r.owner, r.name);
        try {
          // Always through the fetcher, never the SWR cache: a top-bar Refresh
          // marks these URLs fresh, and a cache read would skip that.
          const data = await fetcher<RepoSummary>(key);
          out.set(r.full_name, data);
          void mutate(key, data, { revalidate: false });
        } catch {
          // One repo failing (no Actions access, archived) must not sink the batch.
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, target.length) }, worker));
    return out;
  });

  return {
    summaries: swr.data ?? EMPTY,
    isLoading: swr.isLoading,
    capped: (repos?.length ?? 0) > SUMMARY_CAP,
    revalidate: swr.mutate,
  };
}
