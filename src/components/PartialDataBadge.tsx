"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Shown when a fan-out route (many parallel GitHub API calls per response)
 * had some calls rejected — usually a rate-limit hit mid-fetch. Surfaces
 * that the metric below is computed from a subset instead of silently
 * returning an undercounted number with no indication anything was skipped.
 */
export default function PartialDataBadge({
  fetched,
  total,
  unit = "items",
}: {
  fetched: number;
  total: number;
  unit?: string;
}) {
  if (fetched >= total) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 mb-3">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      Computed from {fetched}/{total} {unit} — some requests were rate-limited or failed. Values below may be undercounted.
    </div>
  );
}
