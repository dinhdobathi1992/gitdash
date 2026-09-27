"use client";

import { StatusPill, runOutcome } from "@/components/ui/StatusPill";

interface BadgeProps {
  conclusion: string | null;
  status?: string | null;
  className?: string;
}

/** Run outcome pill (Success, Failure, Cancelled, Running, Queued…). */
export function ConclusionBadge({ conclusion, status, className }: BadgeProps) {
  const o = runOutcome(conclusion, status);
  return <StatusPill tone={o.tone} pulse={o.live} className={className}>{o.label}</StatusPill>;
}
