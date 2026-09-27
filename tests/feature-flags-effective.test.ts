import { describe, it, expect, afterEach, vi } from "vitest";
import { DEFAULT_FLAGS, effectiveFlags, type FeatureFlags } from "@/lib/feature-flags";
import { visibleNav, NAV_BOTTOM, NAV_GROUPS } from "@/components/shell/nav-config";
import { fetcher, FetchError } from "@/lib/swr";

const all = (v: boolean) => Object.fromEntries(Object.keys(DEFAULT_FLAGS).map((k) => [k, v])) as FeatureFlags;

describe("effectiveFlags", () => {
  it("standalone: preferences apply unchanged", () => {
    const prefs = { ...all(true), busFactor: false };
    expect(effectiveFlags(prefs, "all")).toEqual(prefs);
  });

  it("a granted flag the user switched off stays off", () => {
    const prefs = { ...all(true), dora: false };
    expect(effectiveFlags(prefs, new Set(["dora", "busFactor"])).dora).toBe(false);
  });

  it("a flag the user left on but is not granted is off", () => {
    const eff = effectiveFlags(all(true), new Set(["dora"]));
    expect(eff.dora).toBe(true);
    expect(eff.costAnalytics).toBe(false);
    expect(Object.values(eff).filter(Boolean)).toHaveLength(1);
  });

  it("nothing granted (e.g. before /api/auth/me loads) means nothing on", () => {
    expect(Object.values(effectiveFlags(all(true), new Set())).some(Boolean)).toBe(false);
  });
});

describe("visibleNav", () => {
  const cost = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.href === "/cost-analytics");
  it("Admin appears only for admins", () => {
    const labels = (isAdmin: boolean) => visibleNav(NAV_BOTTOM, { isAdmin, granted: new Set() }).map((i) => i.label);
    expect(labels(true)).toContain("Admin");
    expect(labels(false)).not.toContain("Admin");
    expect(labels(false)).toContain("Settings");
  });
  it("Cost appears only when costAnalytics is granted", () => {
    expect(visibleNav(cost, { isAdmin: false, granted: new Set() })).toHaveLength(0);
    expect(visibleNav(cost, { isAdmin: false, granted: new Set(["costAnalytics"]) })).toHaveLength(1);
  });
});

describe("fetcher error codes", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("carries the API's code on FetchError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Forbidden", code: "no_groups" }), { status: 403 })));
    const err = await fetcher("/api/github/repos").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect(err).toMatchObject({ status: 403, code: "no_groups" });
  });
});
