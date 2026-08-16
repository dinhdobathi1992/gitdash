"use client";

/**
 * GitHub security alerts panel (v4.2.0).
 *
 * Design rule that drives everything here: on a security page, "we could not
 * look" must never resemble "there is nothing to find". A 403 renders as a
 * loud, actionable warning; a genuinely clean repo renders as a calm green
 * state. Conflating them would let a token permission gap read as safety.
 */

import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type {
  SecurityAlertsResponse, AlertSeverity, AlertSource, SourceStatus,
} from "@/app/api/github/security-alerts/route";
import {
  ShieldAlert, ShieldCheck, KeyRound, Package, Code2,
  AlertTriangle, ExternalLink, Clock, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SEVERITY_STYLE: Record<AlertSeverity, { chip: string; dot: string; label: string }> = {
  critical: { chip: "bg-red-500/10 text-red-300 border-red-500/25", dot: "bg-red-400", label: "Critical" },
  high:     { chip: "bg-orange-500/10 text-orange-300 border-orange-500/25", dot: "bg-orange-400", label: "High" },
  medium:   { chip: "bg-amber-500/10 text-amber-300 border-amber-500/25", dot: "bg-amber-400", label: "Medium" },
  low:      { chip: "bg-slate-700/40 text-slate-400 border-slate-600/40", dot: "bg-slate-500", label: "Low" },
};

const SOURCE_META: Record<AlertSource, { label: string; icon: React.ElementType }> = {
  dependabot: { label: "Dependabot", icon: Package },
  code_scanning: { label: "Code scanning", icon: Code2 },
  secret_scanning: { label: "Secret scanning", icon: KeyRound },
};

const STATUS_NOTE: Record<Exclude<SourceStatus, "ok">, string> = {
  forbidden: "Token lacks permission",
  not_enabled: "Not enabled for this repo",
  error: "Could not be read",
};

export default function SecurityAlertsPanel({ owner, repo }: { owner: string; repo: string }) {
  const { data, error, isLoading } = useSWR<SecurityAlertsResponse>(
    `/api/github/security-alerts?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
    fetcher<SecurityAlertsResponse>,
  );

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="h-4 w-48 rounded skeleton mb-3" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-xl skeleton" />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 text-sm text-slate-500">
        Could not load GitHub security alerts.
      </div>
    );
  }

  const clean = data.total_open === 0 && !data.partial;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="flex items-start gap-4 p-5 border-b border-slate-800">
        <span
          className={cn(
            "shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center",
            clean
              ? "border-emerald-500/30 bg-emerald-500/[0.12]"
              : "border-red-500/30 bg-red-500/[0.12]",
          )}
        >
          {clean
            ? <ShieldCheck className="w-4 h-4 text-emerald-300" />
            : <ShieldAlert className="w-4 h-4 text-red-300" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-white">GitHub Security Alerts</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Vulnerable dependencies, code scanning results and exposed secrets reported by GitHub
            itself — distinct from the workflow analysis below.
          </p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* A permission gap is the loudest thing on this panel: without it, an
            unreadable source looks identical to a clean one. */}
        {data.needs_scope && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-100">
            <Lock className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" />
            <div className="space-y-1">
              <p className="font-semibold">Some sources could not be read — this is not an all-clear.</p>
              <p className="text-amber-200/80">
                A classic PAT with <code className="text-amber-100">repo</code> reads all three
                sources, so this usually means the token is fine-grained or more narrowly scoped.
                On a fine-grained PAT, grant read access to <em>Dependabot alerts</em>, <em>Code
                scanning alerts</em> and <em>Secret scanning alerts</em>. Sources that are simply
                switched off for the repository are labelled <em>Not enabled</em> below and need no
                token change.
              </p>
            </div>
          </div>
        )}

        {/* Severity summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["critical", "high", "medium", "low"] as AlertSeverity[]).map((sev) => (
            <div
              key={sev}
              className={cn(
                "rounded-xl border p-3.5",
                data.counts[sev] > 0 ? SEVERITY_STYLE[sev].chip : "border-slate-800 bg-slate-900/40",
              )}
            >
              <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] mb-1.5">
                <span className={cn("w-1.5 h-1.5 rounded-full", SEVERITY_STYLE[sev].dot)} />
                {SEVERITY_STYLE[sev].label}
              </div>
              <div className={cn("font-mono text-2xl font-bold tabular-nums", data.counts[sev] === 0 && "text-slate-600")}>
                {data.counts[sev]}
              </div>
            </div>
          ))}
        </div>

        {/* Per-source status — the row that makes "unreadable" visible */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {(Object.keys(SOURCE_META) as AlertSource[]).map((src) => {
            const s = data.sources[src];
            const Icon = SOURCE_META[src].icon;
            const ok = s.status === "ok";
            return (
              <div
                key={src}
                className={cn(
                  "rounded-xl border px-3.5 py-3",
                  ok ? "border-slate-800 bg-slate-900/40" : "border-amber-500/25 bg-amber-500/[0.06]",
                )}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon className={cn("w-3.5 h-3.5", ok ? "text-slate-400" : "text-amber-400")} />
                  <span className="text-xs font-medium text-slate-300">{SOURCE_META[src].label}</span>
                </div>
                {s.status === "ok" ? (
                  <div className="flex items-baseline gap-2">
                    <span className={cn("font-mono text-lg font-bold", s.open_count > 0 ? "text-white" : "text-emerald-400")}>
                      {s.open_count}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      open{s.mttr_days !== null && ` · ${s.mttr_days}d avg fix`}
                    </span>
                  </div>
                ) : (
                  <span className="text-[11px] text-amber-300/90">{STATUS_NOTE[s.status]}</span>
                )}
              </div>
            );
          })}
        </div>

        {data.oldest_open_days !== null && data.oldest_open_days > 30 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-200">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            The oldest open alert has been unresolved for{" "}
            <strong>{data.oldest_open_days} days</strong>.
          </div>
        )}

        {/* Alert list */}
        {data.alerts.length > 0 ? (
          <div className="rounded-xl border border-slate-800 overflow-hidden">
            {data.alerts.map((a) => {
              const style = SEVERITY_STYLE[a.severity];
              return (
                <a
                  key={`${a.source}-${a.number}`}
                  href={a.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 px-4 py-3 border-b border-slate-800/60 last:border-b-0 hover:bg-slate-800/40 transition-colors"
                >
                  <span className={cn("shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border", style.chip)}>
                    {style.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-200 truncate group-hover:text-white transition-colors">
                      {a.title}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono truncate">
                      {SOURCE_META[a.source].label} · {a.subject}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">{a.age_days}d</span>
                  <ExternalLink className="w-3 h-3 shrink-0 text-slate-700 group-hover:text-slate-400 transition-colors" />
                </a>
              );
            })}
          </div>
        ) : data.partial ? (
          <p className="text-xs text-slate-500 italic">
            No alerts returned by the sources that could be read.
          </p>
        ) : (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/25 text-sm text-emerald-200">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            No open security alerts. All three sources were checked.
          </div>
        )}

        {data.total_open > data.alerts.length && (
          <p className="text-[11px] text-slate-600">
            Showing the {data.alerts.length} most severe of {data.total_open} open alerts.
          </p>
        )}

        {data.partial && !data.needs_scope && (
          <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-slate-600" />
            Some sources are not enabled for this repository, so this is not a complete picture.
          </p>
        )}
      </div>
    </div>
  );
}
