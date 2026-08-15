"use client";

/**
 * Collapsible section header (extracted to shared in v4.2.5).
 *
 * Introduced in v4.0.11 for Team Analytics but left as a local function in
 * that one page, so every other collapsible on the app kept its original bare
 * "› Show …" text toggle. That inconsistency became obvious once polished
 * cards were added next to those toggles on the repository overview.
 *
 * Design reference: claude.ai/design "Scorecard board redesign" project,
 * adapted to the app's lucide icons and Tailwind tokens.
 */

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type SectionTone = "violet" | "cyan" | "amber" | "green" | "red";

export const SECTION_TONES: Record<
  SectionTone,
  { text: string; bg: string; border: string; stripe: string }
> = {
  violet: { text: "text-violet-300", bg: "bg-violet-500/[0.14]", border: "border-violet-500/30", stripe: "bg-gradient-to-b from-violet-400 to-violet-600" },
  cyan:   { text: "text-cyan-300",   bg: "bg-cyan-500/[0.14]",   border: "border-cyan-500/30",   stripe: "bg-gradient-to-b from-cyan-400 to-cyan-600" },
  amber:  { text: "text-amber-300",  bg: "bg-amber-500/[0.14]",  border: "border-amber-500/30",  stripe: "bg-gradient-to-b from-amber-400 to-amber-600" },
  green:  { text: "text-emerald-300", bg: "bg-emerald-500/[0.14]", border: "border-emerald-500/30", stripe: "bg-gradient-to-b from-emerald-400 to-emerald-600" },
  red:    { text: "text-red-300",    bg: "bg-red-500/[0.14]",    border: "border-red-500/30",    stripe: "bg-gradient-to-b from-red-400 to-red-600" },
};

export default function CollapsibleSection({
  icon: Icon,
  tone,
  title,
  badge,
  subtitle,
  open,
  onToggle,
  children,
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
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/50 to-slate-950/70 shadow-[0_40px_80px_-55px_rgba(0,0,0,1)] overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "w-full relative flex items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-800/40",
          open && "border-b border-slate-800",
        )}
      >
        <span className={cn("absolute inset-y-0 left-0 w-[2px]", t.stripe)} />
        <span className={cn("shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center", t.bg, t.border)}>
          <Icon className={cn("w-4 h-4", t.text)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[15px] font-semibold text-white">{title}</span>
            {badge && (
              <span className={cn("font-mono text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap", t.bg, t.border, t.text)}>
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <span className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-gradient-to-b from-slate-800 to-slate-900 text-xs text-slate-300">
          {open ? "Hide" : "Show"}
          <ChevronRight className={cn("w-3 h-3 transition-transform", open && "rotate-90")} />
        </span>
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}
