import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });

const { readWatchlist, toggleWatchlist, WATCHLIST_KEY } = await import("@/lib/watchlist");

describe("watchlist store", () => {
  beforeEach(() => store.clear());

  it("returns the same reference until the stored value changes", () => {
    store.set(WATCHLIST_KEY, JSON.stringify(["a/b"]));
    const first = readWatchlist();
    expect(readWatchlist()).toBe(first);
    toggleWatchlist("c/d");
    const second = readWatchlist();
    expect(second).not.toBe(first);
    expect(second).toEqual(["a/b", "c/d"]);
  });

  it("toggles off and tolerates corrupt storage", () => {
    store.set(WATCHLIST_KEY, JSON.stringify(["a/b"]));
    toggleWatchlist("a/b");
    expect(readWatchlist()).toEqual([]);
    store.set(WATCHLIST_KEY, "{not json");
    expect(readWatchlist()).toEqual([]);
  });
});
