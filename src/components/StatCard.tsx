"use client";

/**
 * Single KPI card (contract §5 KPI strip cell, standalone form).
 * Label 13 muted → mono figure → caption. Prefer <KpiStrip> for a row of
 * figures; this stays for grids that mix KPIs with other content.
 */

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { MetricTooltip } from "@/components/MetricTooltip";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  /** Kept for call-site compatibility; icons render in the muted tone. */
  iconColor?: string;
  tooltip?: string;
  /** Tints the figure when the figure itself is the alarm. */
  valueColor?: "default" | "green" | "red" | "amber" | "blue" | "violet";
  /** Kept for call-site compatibility; a red/amber accent warms the card. */
  accent?: "green" | "red" | "amber" | "blue" | "violet" | "none";
}

const VALUE_COLORS = {
  default: "text-fg",
  green: "text-status-pass-text",
  red: "text-status-fail-text",
  amber: "text-status-warn-text",
  blue: "text-status-run-text",
  violet: "text-brand-fg",
};

export default function StatCard({ label, value, sub, icon: Icon, tooltip, valueColor = "default", accent = "none" }: StatCardProps) {
  const warm = accent === "red" || accent === "amber";
  return (
    <div className={cn("card px-5 py-[18px] flex flex-col min-w-0", warm && "!border-[#3A2A2E] ![background:#161419]")}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center text-[13px] text-muted min-w-0">
          <span className="truncate">{label}</span>
          {tooltip && <MetricTooltip text={tooltip} align="left" />}
        </span>
        {Icon && <Icon className="w-4 h-4 text-faint shrink-0" aria-hidden="true" />}
      </div>
      <p className={cn("mt-1.5 font-mono text-2xl leading-8 font-semibold tabular-nums tracking-tight", VALUE_COLORS[valueColor])}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}
