"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { CodeBlock } from "@/components/docs/CodeBlock";
import { Callout } from "@/components/docs/Callout";
import { StatusPill } from "@/components/ui/StatusPill";
import { cn } from "@/lib/utils";
import { curlFor, queryString, type Exchange } from "@/lib/playground/source";
import { formatJson, itemCount } from "@/lib/playground/json-preview";
import type { CookStep, CookedGroup } from "@/lib/playground/recipes";

/** Column shell shared by the three panels. */
export function Column({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col">
      <header className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </header>
      <div className="p-4 space-y-3 min-w-0 lg:max-h-[75vh] lg:overflow-y-auto">{children}</div>
    </section>
  );
}

// ── Raw ───────────────────────────────────────────────────────────────────────

function statusTone(ex: Exchange) {
  return ex.error ? "fail" : "pass";
}

function ExchangeItem({ ex, defaultOpen }: { ex: Exchange; defaultOpen: boolean }) {
  const [full, setFull] = useState(false);
  const qs = queryString(ex.request.params);
  const count = itemCount(ex.body);
  return (
    <details open={defaultOpen} className="group rounded-lg border border-slate-800 bg-slate-950/60 min-w-0">
      <summary className="list-none cursor-pointer px-3 py-2 flex items-start gap-2 min-w-0 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500 transition-transform group-open:rotate-90" aria-hidden="true" />
        <span className="font-mono text-[11px] font-semibold text-emerald-400 shrink-0 mt-px">{ex.request.method}</span>
        <span className="font-mono text-xs text-slate-300 break-all min-w-0 flex-1">
          {ex.request.path}
          {qs && <span className="text-slate-500">?{decodeURIComponent(qs)}</span>}
        </span>
        <StatusPill tone={statusTone(ex)} className="h-5 px-2 text-[11px]">{ex.status === 0 ? "ERR" : ex.status}</StatusPill>
      </summary>
      <div className="px-3 pb-3 space-y-2 min-w-0">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          {count !== null && <span>{count} items</span>}
          {ex.rateLimit ? (
            <span>
              x-ratelimit-remaining: <span className="font-mono text-slate-300">{ex.rateLimit.remaining}</span>
              {ex.rateLimit.limit && <> / {ex.rateLimit.limit}</>}
            </span>
          ) : (
            <span>sample data — no API call made</span>
          )}
        </div>
        {ex.error && <p className="text-xs text-status-fail-text">{ex.error}</p>}
        <CodeBlock language="curl — reproduce it">{curlFor(ex.request)}</CodeBlock>
        <div className="rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-700/50">
            <span className="text-xs text-slate-500">Response body{full ? "" : " (truncated)"}</span>
            <button type="button" onClick={() => setFull((v) => !v)} className="text-xs text-violet-300 hover:text-violet-200">
              {full ? "Show preview" : "Show full"}
            </button>
          </div>
          <pre className="font-mono text-[11px] leading-relaxed bg-slate-950 p-3 overflow-auto max-h-96 text-slate-300">{formatJson(ex.body, full)}</pre>
        </div>
      </div>
    </details>
  );
}

export function RawPanel({ exchanges }: { exchanges: Exchange[] }) {
  if (!exchanges.length) return <p className="text-sm text-slate-500">No requests yet.</p>;
  const last = [...exchanges].reverse().find((e) => e.rateLimit);
  return (
    <>
      <p className="text-xs text-slate-500">
        {exchanges.length} request{exchanges.length === 1 ? "" : "s"}, in the order GitDash makes them
        {last?.rateLimit && <> · rate limit left: <span className="font-mono text-slate-300">{last.rateLimit.remaining}</span></>}
      </p>
      {exchanges.map((ex, i) => (
        <ExchangeItem key={`${i}-${ex.url}`} ex={ex} defaultOpen={i < 2 || Boolean(ex.error)} />
      ))}
    </>
  );
}

// ── Cooking ───────────────────────────────────────────────────────────────────

export function CookPanel({ steps, caveats }: { steps: CookStep[]; caveats: string[] }) {
  return (
    <>
      {caveats.length > 0 && (
        <Callout type="warning" title="Differs from production for this run">
          <ul className="list-disc pl-4 space-y-1">
            {caveats.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </Callout>
      )}
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 min-w-0">
            <p className="text-sm font-medium text-fg flex gap-2">
              <span className="text-violet-400 font-mono text-xs mt-0.5">{i + 1}</span>
              <span className="min-w-0">{s.title}</span>
            </p>
            {s.formula && <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">{s.formula}</p>}
            {s.rows && s.rows.length > 0 && (
              <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs">
                {s.rows.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-500 min-w-0">{k}</dt>
                    <dd className="font-mono text-slate-200 text-right">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {s.table && s.table.rows.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-slate-500 text-left">
                      {s.table.columns.map((c) => <th key={c} className="font-medium pr-3 pb-1 whitespace-nowrap">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-slate-300">
                    {s.table.rows.map((r, ri) => (
                      <tr key={ri} className="border-t border-slate-800/80">
                        {r.map((cell, ci) => <td key={ci} className="pr-3 py-1 whitespace-nowrap">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {s.note && <p className="mt-2 text-xs text-status-warn-text">{s.note}</p>}
          </li>
        ))}
      </ol>
    </>
  );
}

// ── Cooked ────────────────────────────────────────────────────────────────────

export function CookedPanel({ groups }: { groups: CookedGroup[] }) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.title} className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-fg">{g.title}</h3>
            <p className="text-[11px] text-slate-500">In GitDash: {g.where}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-2">
            {g.cards.map((c) => (
              <div key={c.label} className={cn("rounded-lg border border-slate-800 bg-slate-950/60 p-3 min-w-0")}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-slate-400 min-w-0 break-words">{c.label}</p>
                  {c.badge && <StatusPill tone={c.badge.tone} className="h-5 px-2 text-[11px] capitalize">{c.badge.text}</StatusPill>}
                </div>
                <p className="mt-1 text-lg font-semibold text-fg tabular-nums break-words">{c.value}</p>
                {c.sub && <p className="text-[11px] text-slate-500 mt-0.5 break-words">{c.sub}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
