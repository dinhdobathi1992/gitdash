"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  FeatureFlags,
  DEFAULT_FLAGS,
  getSnapshot,
  getServerSnapshot,
  subscribeFlags,
  updateFlag,
  effectiveFlags,
} from "@/lib/feature-flags";

type FeatureFlagsCtx = {
  /** Effective flags: granted by the server AND left on by the user. */
  flags: FeatureFlags;
  /** The user's own on/off choices (localStorage), before server grants. */
  preferences: FeatureFlags;
  /** Flags this user may use at all (all flags in standalone mode). */
  granted: Set<keyof FeatureFlags>;
  setFlag: (key: keyof FeatureFlags, value: boolean) => void;
};

const ALL_FLAGS = new Set(Object.keys(DEFAULT_FLAGS) as (keyof FeatureFlags)[]);

const Ctx = createContext<FeatureFlagsCtx>({
  flags: DEFAULT_FLAGS,
  preferences: DEFAULT_FLAGS,
  granted: ALL_FLAGS,
  setFlag: () => {},
});

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  // useSyncExternalStore: server uses getServerSnapshot (DEFAULT_FLAGS),
  // client uses getSnapshot (lazy-loads from localStorage). React reconciles
  // the diff without a hydration error and without calling setState in an effect.
  const preferences = useSyncExternalStore(subscribeFlags, getSnapshot, getServerSnapshot);
  const { resolvedMode, grantedFlags } = useAuth();

  // Until /api/auth/me answers, nothing is enabled — no flash of UI the user
  // may not be granted, and no API calls it would trigger. (The mode cannot
  // come from the server layout: it is prerendered at build time.) Then:
  // standalone has no permission model (every flag available); organization
  // mode uses the server's grants.
  const granted = useMemo<Set<keyof FeatureFlags>>(
    () => (resolvedMode === "standalone" ? ALL_FLAGS : new Set(grantedFlags ?? [])),
    [resolvedMode, grantedFlags],
  );

  const flags = useMemo<FeatureFlags>(
    () => effectiveFlags(preferences, granted === ALL_FLAGS ? "all" : granted),
    [preferences, granted],
  );

  return (
    <Ctx.Provider value={{ flags, preferences, granted, setFlag: updateFlag }}>
      {children}
    </Ctx.Provider>
  );
}

export function useFeatureFlags() {
  return useContext(Ctx);
}
