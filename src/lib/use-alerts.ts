"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { useAuth } from "@/components/AuthProvider";
import { firingAlerts, type AlertEventLike, type AlertRuleLike, type FiringAlert } from "@/lib/alert-copy";

export interface AlertsResponse {
  rules: AlertRuleLike[];
  events: AlertEventLike[];
}

export const ALERTS_KEY = "/api/alerts?events=1";

/** A clock that ticks every `intervalMs`, for relative times and windows. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Rules, recent events and the derived "firing now" list. Shares one SWR key app-wide. */
export function useAlerts() {
  // Alerts need the organization-mode database; standalone never calls the API.
  const { mode, user } = useAuth();
  const swr = useSWR<AlertsResponse>(mode === "organization" && user ? ALERTS_KEY : null, fetcher<AlertsResponse>, {
    refreshInterval: 120_000,
    shouldRetryOnError: false,
  });
  const now = useNow();
  const firing = useMemo<FiringAlert[]>(
    () => (swr.data ? firingAlerts(swr.data.events, swr.data.rules, now) : []),
    [swr.data, now],
  );
  return { ...swr, firing, now };
}
