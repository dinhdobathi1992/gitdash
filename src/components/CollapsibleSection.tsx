"use client";

/**
 * Collapsible section — a card whose header row toggles its body.
 * Graphite style (contract §3.3): card surface, 32 px tinted icon box,
 * 15/600 title, 13 muted subtitle, secondary "Show / Hide" control.
 */

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type SectionTone = "violet" | "cyan" | "amber" | "green" | "red";

export const SECTION_TONES: Record<SectionTone, { text: string; bg: string; border: string; stripe: string }> = {
  violet: { text: "text-brand-fg", bg: "bg-brand-soft", border: "border-brand-fg/30", stripe: "bg-brand-fg" },
  cyan: { text: "text-status-run-text", bg: "bg-status-run-tint", border: "border-status-run/30", stripe: "bg-status-run" },
  amber: { text: "text-status-warn-text", bg: "bg-status-warn-tint", border: "border-status-warn/30", stripe: "bg-status-warn" },
  green: { text: "text-status-pass-text", bg: "bg-status-pass-tint", border: "border-status-pass/30", stripe: "bg-status-pass" },
  red: { text: "text-status-fail-text", bg: "bg-status-fail-tint", border: "border-status-fail/30", stripe: "bg-status-fail" },
};

export default function CollapsibleSection({
  icon: Icon, tone, title, badge, subtitle, open, onToggle, children,
}: {
  icon: React.ElementType;
  tone: SectionTone;
  title: string;
  /** Optional count or status chip beside the title. */
  badge?: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const t = SECTION_TONES[tone];
  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-4 px-5 py-4 text-left transition-colors duration-100 hover:bg-raised/40",
          open && "border-b border-line",
        )}
      >
        <span className={cn("shrink-0 w-8 h-8 rounded-control flex items-center justify-center", t.bg)}>
          <Icon className={cn("w-4 h-4", t.text)} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[15px] font-semibold text-fg">{title}</span>
            {badge && (
              <span className={cn("font-mono text-xs h-[22px] inline-flex items-center px-2 rounded-chip whitespace-nowrap", t.bg, t.text)}>
                {badge}
              </span>
            )}
          </span>
          <span className="block text-[13px] text-muted mt-0.5">{subtitle}</span>
        </span>
        <span className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-control border border-control bg-surface text-[13px] font-medium text-fg">
          {open ? "Hide" : "Show"}
          <ChevronRight className={cn("w-3.5 h-3.5 transition-transform duration-100", open && "rotate-90")} aria-hidden="true" />
        </span>
      </button>
      {open && <div className="p-5">{children}</div>}
    </section>
  );
}
