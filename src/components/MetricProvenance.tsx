"use client";

/**
 * MetricProvenance — reusable "Why this number?" drawer and inline badge.
 *
 * Usage:
 *   <MetricProvenance
 *     source="GitHub live"
 *     formula="success runs / total runs × 100"
 *     sampleSize={142}
 *     lastUpdated={new Date().toISOString()}
 *   />
 */

import { useState } from "react";
import { Info, X, Database, Wifi, GitMerge } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export type MetricSource = "github-live" | "db" | "derived";

export interface MetricProvenanceProps {
  /** Where the data comes from */
  source: MetricSource;
  /** Human-readable formula or computation description */
  formula?: string;
  /** Number of data points included */
  sampleSize?: number;
  /** ISO timestamp of last data refresh */
  lastUpdated?: string | null;
  /** Optional short label shown next to the info icon */
  label?: string;
  className?: string;
}

const SOURCE_ICONS: Record<MetricSource, React.ComponentType<{ className?: string }>> = {
  "github-live": Wifi,
  "db": Database,
  "derived": GitMerge,
};

const SOURCE_LABELS: Record<MetricSource, { text: string; color: string; badge: string }> = {
  "github-live": { text: "GitHub Live", color: "text-green-400", badge: "bg-green-500/10 border-green-500/20" },
  "db":          { text: "Database",    color: "text-blue-400",  badge: "bg-blue-500/10  border-blue-500/20" },
  "derived":     { text: "Derived",     color: "text-amber-400", badge: "bg-amber-500/10 border-amber-500/20" },
};

export function MetricProvenance({
  source,
  formula,
  sampleSize,
  lastUpdated,
  label,
  className,
}: MetricProvenanceProps) {
  const [open, setOpen] = useState(false);
  const meta = SOURCE_LABELS[source];
  const Icon = SOURCE_ICONS[source];

  return (
    <>
      {/* Trigger badge */}
      <button
        onClick={() => setOpen(true)}
        title="Why this number?"
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border transition-colors hover:opacity-80",
          meta.badge,
          meta.color,
          className,
        )}
      >
        <Icon className="w-2.5 h-2.5" />
        {label ?? meta.text}
        <Info className="w-2.5 h-2.5 opacity-60" />
      </button>

      {/* Drawer backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/50"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      {open && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-700 rounded-t-xl p-5 max-w-lg mx-auto md:top-auto md:bottom-8 md:left-auto md:right-8 md:rounded-xl md:border md:border-slate-700 md:w-80"
          role="dialog"
          aria-label="Metric details"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Why this number?</h3>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500 mb-0.5">Data source</dt>
              <dd className={cn("font-medium flex items-center gap-1.5", meta.color)}>
                <Icon className="w-3.5 h-3.5" />
                {meta.text}
              </dd>
            </div>

            {formula && (
              <div>
                <dt className="text-xs text-slate-500 mb-0.5">Formula</dt>
                <dd className="text-slate-300 font-mono text-xs bg-slate-800 px-2 py-1.5 rounded leading-relaxed">
                  {formula}
                </dd>
              </div>
            )}

            {sampleSize !== undefined && (
              <div>
                <dt className="text-xs text-slate-500 mb-0.5">Sample size</dt>
                <dd className="text-slate-300">
                  {sampleSize.toLocaleString()} data point{sampleSize !== 1 ? "s" : ""}
                </dd>
              </div>
            )}

            {lastUpdated && (
              <div>
                <dt className="text-xs text-slate-500 mb-0.5">Last updated</dt>
                <dd className="text-slate-300">
                  {formatDistanceToNow(new Date(lastUpdated), { addSuffix: true })}
                  <span className="ml-1.5 text-slate-600 text-xs">
                    {new Date(lastUpdated).toLocaleString()}
                  </span>
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </>
  );
}

// ── Freshness banner ───────────────────────────────────────────────────────────

export interface FreshnessBannerProps {
  /** ISO timestamp of last sync */
  lastSyncedAt: string | null;
  /** How many hours before data is considered stale */
  staleAfterHours?: number;
  className?: string;
}

// Captured once at module load — stable across re-renders within the same page session.
const MODULE_NOW = Date.now();

export function FreshnessBanner({ lastSyncedAt, staleAfterHours = 4, className }: FreshnessBannerProps) {
  const now = MODULE_NOW;

  if (!lastSyncedAt) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2", className)}>
        <Database className="w-3.5 h-3.5 shrink-0" />
        <span>No sync data available. <span className="text-amber-300">Trigger a sync</span> to populate historical metrics.</span>
      </div>
    );
  }

  const staleCutoff = new Date(lastSyncedAt).getTime() + staleAfterHours * 3_600_000;
  const isStale = now > staleCutoff;

  if (!isStale) return null;

  const ageHours = Math.round((now - new Date(lastSyncedAt).getTime()) / 3_600_000);

  return (
    <div className={cn("flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2", className)}>
      <Database className="w-3.5 h-3.5 shrink-0" />
      <span>
        DB data is {ageHours}h old — metrics may not reflect recent activity.
        <span className="ml-1 text-amber-300">Sync to refresh.</span>
      </span>
    </div>
  );
}
