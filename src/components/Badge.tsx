"use client";

import { conclusionBadgeCn } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface BadgeProps {
  conclusion: string | null;
  status?: string | null;
  className?: string;
}

// Statuses that mean "still running — show pulsing dot"
const ACTIVE_STATUSES = new Set(["in_progress", "queued", "waiting", "requested", "pending"]);

export function ConclusionBadge({ conclusion, status, className }: BadgeProps) {
  const isActive = status != null && ACTIVE_STATUSES.has(status);

  const label = isActive
    ? status === "in_progress"
      ? "running"
      : status!
    : conclusion ?? status ?? "unknown";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium capitalize",
        conclusionBadgeCn(conclusion ?? status ?? null),
        className
      )}
    >
      {isActive && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
      )}
      {label}
    </span>
  );
}
