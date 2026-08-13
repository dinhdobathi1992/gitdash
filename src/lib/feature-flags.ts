export type FeatureFlags = {
  dora: boolean;
  prLifecycle: boolean;
  anomalyDetection: boolean;
  performanceTab: boolean;
  reliabilityTab: boolean;
  busFactor: boolean;
  securityScan: boolean;
  costAnalytics: boolean;
  runnerUtilization: boolean;
  reviewBottleneck: boolean;
  healthScorecard: boolean;
  workloadRisk: boolean;
};

export const DEFAULT_FLAGS: FeatureFlags = {
  dora: true,
  prLifecycle: true,
  anomalyDetection: true,
  performanceTab: true,
  reliabilityTab: true,
  busFactor: true,
  securityScan: true,
  costAnalytics: true,
  runnerUtilization: true,
  reviewBottleneck: true,
  healthScorecard: true,
  workloadRisk: true,
};

export const STORAGE_KEY = "gitdash:feature-flags";

// ── External store (useSyncExternalStore-compatible) ──────────────────────────
// Keeps one shared flags object so all subscribers see the same snapshot.

let _flags: FeatureFlags = DEFAULT_FLAGS;
let _clientInitialized = false;
const _listeners = new Set<() => void>();

/** Called by useSyncExternalStore on the client. Lazy-loads from localStorage once. */
export function getSnapshot(): FeatureFlags {
  if (!_clientInitialized && typeof window !== "undefined") {
    _clientInitialized = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) _flags = { ...DEFAULT_FLAGS, ...JSON.parse(raw) };
    } catch {
      // ignore
    }
  }
  return _flags;
}

/** Called by useSyncExternalStore during SSR — must be pure and stable. */
export function getServerSnapshot(): FeatureFlags {
  return DEFAULT_FLAGS;
}

/** Subscribe to store changes. */
export function subscribeFlags(callback: () => void): () => void {
  _listeners.add(callback);
  return () => _listeners.delete(callback);
}

/** Update one flag, persist to localStorage, and notify all subscribers. */
export function updateFlag(key: keyof FeatureFlags, value: boolean): void {
  _flags = { ..._flags, [key]: value };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_flags));
  } catch {
    // ignore
  }
  _listeners.forEach((l) => l());
}

/** @deprecated Use getSnapshot / updateFlag instead. */
export function loadFlags(): FeatureFlags {
  return getSnapshot();
}

/** @deprecated Use updateFlag instead. */
export function saveFlags(flags: FeatureFlags): void {
  _flags = flags;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // ignore
  }
}
