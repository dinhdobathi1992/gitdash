"use client";

/**
 * Workflows table (`Repo` artboard). Used as a 6-row preview on Overview and
 * as the full list on the Workflows tab (contract §11.1).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight } from "lucide-react";
import type { WorkflowOverview } from "@/lib/github";
import { cn, formatDurationShort, formatRelative, fuzzyMatch } from "@/lib/utils";
import { repoHealth } from "@/lib/repo-health";
import { StatusPill } from "@/components/ui/StatusPill";
import { RunStrip } from "@/components/ui/RunStrip";

export function WorkflowsTable({
  owner, repo, workflows, now, limit, loading,
}: {
  owner: string;
  repo: string;
  workflows: WorkflowOverview[];
  now: number;
  /** Preview mode: show at most this many rows and an "All n →" link. */
  limit?: number;
  loading?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const query = q.trim();
    const matched = query ? workflows.filter((w) => fuzzyMatch(w.name, query).match || fuzzyMatch(w.path, query).match) : workflows;
    // Failing first, then by most recent run.
    const ranked = [...matched].sort((a, b) => {
      const ra = repoHealth(a.summary, now).rank, rb = repoHealth(b.summary, now).rank;
      return ra - rb || new Date(b.summary.latest_run_at ?? 0).getTime() - new Date(a.summary.latest_run_at ?? 0).getTime();
    });
    return limit && !query ? ranked.slice(0, limit) : ranked;
  }, [workflows, q, now, limit]);

  useEffect(() => {
    if (limit) return; // the full tab owns the "/" shortcut
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey) return;
      if (e.key === "/") { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [limit]);

  const href = (w: WorkflowOverview) => `/repos/${owner}/${repo}/workflows/${w.id}`;
  const th = "h-10 px-3 text-left text-xs font-medium text-faint whitespace-nowrap";

  return (
    <section aria-labelledby="workflows-title" className="card overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 h-16 border-b border-line">
        <h2 id="workflows-title" className="text-[15px] font-semibold text-fg">Workflows</h2>
        <div className="flex items-center gap-4">
          <label htmlFor="wf-filter" className="sr-only">Filter workflows</label>
          <input
            id="wf-filter"
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(-1); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, rows.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter" && rows[active]) router.push(href(rows[active]));
              else if (e.key === "Escape") setQ("");
            }}
            placeholder="Filter workflows"
            className="w-44 sm:w-56 h-[34px] px-3 rounded-control bg-panel border border-control-strong text-[13px] text-fg placeholder:text-faint focus:outline-none focus:border-brand-fg"
          />
          {limit && workflows.length > 0 && (
            <Link href={`/repos/${owner}/${repo}/workflows`} className="hidden sm:inline-flex items-center gap-1 text-[13px] font-medium text-link hover:text-violet-200 whitespace-nowrap">
              All {workflows.length} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      {/* Phone: compact list */}
      <ul className="sm:hidden">
        {rows.map((w) => {
          const h = repoHealth(w.summary, now);
          const rate = w.summary.success_rate_30d;
          return (
            <li key={w.id} className="border-b border-line last:border-0">
              <Link href={href(w)} className="flex items-center gap-3 h-14 px-4">
                <span className={cn("w-2 h-2 rounded-full shrink-0", h.dot)} aria-hidden="true" />
                <span className="flex-1 font-mono text-[15px] text-fg truncate">{w.name}<span className="sr-only">, {h.label}</span></span>
                <span className={cn("font-mono text-sm", rate != null && rate < 80 ? "text-status-fail-text" : "text-muted")}>{rate != null ? `${Math.round(rate)}%` : "—"}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full border-collapse">
          <caption className="sr-only">Workflows in {repo}</caption>
          <thead className="bg-panel border-b border-line">
            <tr>
              <th className={cn(th, "pl-5")}>Workflow</th>
              <th className={th}>Status</th>
              <th className={th}>Success</th>
              <th className={cn(th, "hidden md:table-cell")}>Last 10 runs</th>
              <th className={cn(th, "hidden lg:table-cell")}>Runs</th>
              <th className={th}>p95</th>
              <th className={cn(th, "hidden md:table-cell")}>Last run</th>
              <th className="w-10"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 4 }).map((_, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="h-14 pl-5" colSpan={8}><div className="h-4 w-1/2 rounded skeleton" /></td>
              </tr>
            ))}
            {!loading && rows.map((w, i) => {
              const h = repoHealth(w.summary, now);
              const rate = w.summary.success_rate_30d;
              return (
                <tr key={w.id} className={cn("border-b border-line last:border-0 transition-colors duration-100", i === active ? "bg-[#161B23]" : "hover:bg-[#161B23]/60")}>
                  <td className="h-14 pl-5 pr-3 min-w-0">
                    <Link href={href(w)} className="group block min-w-0">
                      <span className="block font-mono text-sm font-semibold text-fg group-hover:text-link truncate">{w.name}</span>
                      <span className="block font-mono text-xs text-muted truncate">{w.path.split("/").pop()}</span>
                    </Link>
                  </td>
                  <td className="px-3 w-[130px]"><StatusPill tone={h.tone} pulse={h.key === "running"}>{h.label}</StatusPill></td>
                  <td className={cn("px-3 w-[96px] font-mono text-[13px] tabular-nums", rate != null && rate < 80 ? "text-status-fail-text" : "text-fg")}>
                    {rate != null ? `${Math.round(rate)}%` : "—"}
                  </td>
                  <td className="px-3 w-[140px] hidden md:table-cell">{w.summary.recent_runs.length ? <RunStrip runs={w.summary.recent_runs} /> : <span className="text-xs text-muted">No runs</span>}</td>
                  <td className="px-3 w-[80px] hidden lg:table-cell font-mono text-[13px] text-fg tabular-nums">{w.summary.runs_30d ?? "—"}</td>
                  <td className="px-3 w-[100px] font-mono text-[13px] text-fg tabular-nums">{formatDurationShort(w.summary.p95_duration_ms)}</td>
                  <td className="px-3 w-[120px] hidden md:table-cell text-[13px] text-fg">
                    {h.key === "running" ? "Running now" : formatRelative(w.summary.latest_run_at, now)}
                  </td>
                  <td className="pr-4 w-10 text-right">
                    <Link href={href(w)} aria-label={`Open ${w.name}`} className="inline-flex p-1 text-faint hover:text-fg">
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && (
        <p className="px-5 py-5 text-sm text-muted">{q ? "No workflows match this filter." : "This repository has no GitHub Actions workflows."}</p>
      )}
    </section>
  );
}
