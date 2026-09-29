"use client";

/** "What stands out" — findings computed from the numbers below, worst first (TeamV2 design). */

import { AlertTriangle, Eye, Info } from "lucide-react";
import type { Finding, Suggestion } from "@/lib/team-insights";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { RichText } from "./RichText";
import { IdentityCard } from "./IdentityCard";

const TONE = {
  high: { wrap: "bg-status-fail-tint text-status-fail-text", Icon: AlertTriangle, label: "High" },
  watch: { wrap: "bg-status-warn-tint text-status-warn-text", Icon: Eye, label: "Watch" },
  info: { wrap: "bg-status-run-tint text-status-run-text", Icon: Info, label: "Info" },
} as const;

export function StandsOut({ findings, suggestions, coverage, loading, error, onLink, onDistinct, actionError }: {
  findings: Finding[];
  suggestions: Suggestion[];
  coverage: string | null;
  loading: boolean;
  error?: string | null;
  onLink: (alias: string, primary: string) => Promise<void>;
  onDistinct: (a: string, b: string) => Promise<void>;
  actionError?: string | null;
}) {
  const plain = findings.filter((f) => !f.id.startsWith("identity:"));
  return (
    <Card as="section" aria-labelledby="stand-title" className="p-5 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="stand-title" className="text-[15px] font-semibold text-fg">What stands out</h2>
        <span className="text-xs text-faint">Worst first · computed from the numbers below</span>
      </div>
      {coverage && <p className="mt-2 text-xs text-status-warn-text">{coverage}</p>}
      {error && <p className="mt-3 text-[13px] text-status-fail-text">{error}</p>}
      {actionError && <p role="alert" className="mt-3 text-[13px] text-status-fail-text">{actionError}</p>}
      {loading ? (
        <div className="mt-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-11 rounded skeleton" />)}</div>
      ) : plain.length === 0 && suggestions.length === 0 ? (
        !error && <p className="mt-4 px-4 py-3 rounded-control bg-status-pass-tint text-sm text-status-pass-text">Nothing stands out in this window.</p>
      ) : (
        <div className="mt-2">
          {plain.map((f) => {
            const t = TONE[f.severity];
            return (
              <div key={f.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3 border-t border-line first:border-t-0">
                <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", t.wrap)}>
                  <t.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">{t.label}:</span>
                </span>
                <span className="flex-1 min-w-[200px]">
                  <span className="block text-sm font-medium text-fg"><RichText parts={f.title} /></span>
                  <span className="block mt-0.5 text-[13px] text-muted"><RichText parts={f.detail} /></span>
                </span>
                <a href={f.href} className="ml-10 sm:ml-0 shrink-0 self-center text-[13px] font-medium text-link hover:text-violet-200">
                  {f.cta} →
                </a>
              </div>
            );
          })}
          {suggestions.map((s) => (
            <IdentityCard key={`${s.a}+${s.b}`} s={s} onLink={onLink} onDistinct={onDistinct} />
          ))}
        </div>
      )}
    </Card>
  );
}
