"use client";

/**
 * Pinned repositories ("watchlist"), stored in localStorage under
 * `gitdash:watchlist` as an array of "owner/name".
 *
 * A tiny external store so the table's pin button and the sidebar's Pinned
 * section stay in sync without a reload. Snapshots are cached by the raw
 * string: useSyncExternalStore requires getSnapshot to return the SAME
 * reference until the data changes — returning a fresh array each call is
 * what caused the infinite loop reverted in 17191b3.
 */

import { useSyncExternalStore } from "react";

export const WATCHLIST_KEY = "gitdash:watchlist";
const EMPTY: readonly string[] = Object.freeze([]);

let cachedRaw: string | null | undefined;
let cachedValue: readonly string[] = EMPTY;
const listeners = new Set<() => void>();

export function readWatchlist(): readonly string[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(WATCHLIST_KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    cachedValue = Array.isArray(parsed) ? Object.freeze(parsed.filter((s): s is string => typeof s === "string")) : EMPTY;
  } catch {
    cachedValue = EMPTY;
  }
  return cachedValue;
}

function notify() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => { if (e.key === WATCHLIST_KEY) listener(); };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function toggleWatchlist(fullName: string): void {
  const current = readWatchlist();
  const next = current.includes(fullName) ? current.filter((r) => r !== fullName) : [...current, fullName];
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  notify();
}

const getServerSnapshot = () => EMPTY;

export function useWatchlist() {
  const pinned = useSyncExternalStore(subscribe, readWatchlist, getServerSnapshot);
  return {
    pinned,
    isPinned: (fullName: string) => pinned.includes(fullName),
    toggle: toggleWatchlist,
  };
}
