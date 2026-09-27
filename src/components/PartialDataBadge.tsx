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
    <p role="status" className="flex items-center gap-2 px-3 py-2 rounded-control bg-status-warn-tint text-xs text-status-warn-text">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      Computed from {fetched} of {total} {unit} — some requests were rate-limited or failed, so values may be undercounted.
    </p>
  );
}
