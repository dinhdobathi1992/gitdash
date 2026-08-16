"use client";

/**
 * Issue & Triage Health (v4.2.2).
 *
 * GitDash measured delivery — PRs, CI, deployments — but nothing about the
 * work arriving. This page answers the questions a lead actually asks about a
 * backlog: is it growing, how long do things take, and what has been sitting
 * untouched.
 *
 * The framing throughout is triage debt rather than individual output. An
 * unlabelled issue is unrouted work; an issue nobody replied to is a person
 * waiting, not a person failing.
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { RepoWorkflowBreadcrumb } from "@/components/Sidebar";
import type { IssuesSummary } from "@/app/api/github/issues/route";
import {
  CircleDot, ArrowLeft, TrendingUp, TrendingDown, Minus, Clock,
  Tag, MessageSquareOff, Users, ExternalLink, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PERIODS = [7, 30, 90];

export default function IssuesPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const [days, setDays] = useState(30);

  const { data, error, isLoading } = useSWR<IssuesSummary>(
    `/api/github/issues?owner=${owner}&repo=${repo}&days=${days}`,
    fetcher<IssuesSummary>,
  );

  return (
    <div className="p-8 space-y-6">
      <RepoWorkflowBreadcrumb owner={owner} repo={repo} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center shrink-0">
            <CircleDot className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Issue &amp; Triage Health</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Is the backlog growing, how long does work take, and what has been left untouched in{" "}
              <span className="font-mono text-slate-300">{owner}/{repo}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-800 bg-slate-900/60">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setDays(p)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs transition-colors",
                  days === p
                    ? "bg-slate-700/80 text-white border border-slate-600"
                    : "text-slate-500 hover:text-slate-300 border border-transparent",
                )}
              >
                {p}d
              </button>
            ))}
          </div>
          <Link
            href={`/repos/${owner}/${repo}`}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to repo
          </Link>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-2xl skeleton" />)}
          </div>
          <div className="h-64 rounded-2xl skeleton" />
        </div>
      )}

      {error && !isLoading && (
        <div className="px-4 py-3 rounded-xl border border-red-500/25 bg-red-500/10 text-sm text-red-300">
          {error.message ?? "Failed to load issue metrics"}
        </div>
      )}

      {data && !isLoading && data.total_analysed === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <CircleDot className="w-10 h-10 text-slate-600" />
          <p className="text-sm text-slate-400">
            No issues found in this repository — only pull requests, which are counted elsewhere.
          </p>
        </div>
      )}

      {data && !isLoading && data.total_analysed > 0 && (
        <>
          {/* Headline */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat
              label="Open"
              value={data.open_count}
              note={`${data.total_analysed} analysed`}
              tone="slate"
            />
            <BacklogStat delta={data.backlog_delta} opened={data.opened_in_period} closed={data.closed_in_period} days={days} />
            <Stat
              label="Median time to close"
              value={data.median_days_to_close !== null ? `${data.median_days_to_close}d` : "—"}
              note={data.p90_days_to_close !== null ? `p90 ${data.p90_days_to_close}d` : "nothing closed"}
              tone="slate"
            />
            <Stat
              label="Stale"
              value={data.stale_count}
              note="no activity 30d+"
              tone={data.stale_count > 0 ? "amber" : "emerald"}
            />
          </div>

          {/* Triage debt */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DebtCard
              icon={Tag}
              label="Unlabelled"
              value={data.unlabelled_count}
              total={data.open_count}
              explanation="Open issues with no labels — work that has arrived but has not been routed to anyone or anything."
            />
            <DebtCard
              icon={MessageSquareOff}
              label="No reply"
              value={data.unanswered_count}
              total={data.open_count}
              explanation="Open more than 14 days with not a single comment. Someone reported these and heard nothing back."
            />
          </div>

          {/* Age distribution */}
          <Panel title="Open backlog by age" icon={Clock}>
            <div className="space-y-2">
              {data.age_buckets.map((b) => {
                const pct = data.open_count > 0 ? (b.count / data.open_count) * 100 : 0;
                const old = b.label === "> 3 months" || b.label === "1–3 months";
                return (
                  <div key={b.label} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs text-slate-400">{b.label}</span>
                    <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", old ? "bg-amber-500/80" : "bg-sky-500/80")}
                        style={{ width: `${Math.max(pct, b.count > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs text-slate-300 tabular-nums">{b.count}</span>
                  </div>
                );
              })}
            </div>
            {data.oldest_open && (
              <a
                href={data.oldest_open.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate flex-1">
                  Oldest open: #{data.oldest_open.number} {data.oldest_open.title}
                </span>
                <span className="shrink-0 tabular-nums">{data.oldest_open.age_days}d</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            )}
          </Panel>

          {/* Neglected */}
          {data.neglected.length > 0 && (
            <Panel title="Waiting for a first reply" icon={MessageSquareOff}>
              <p className="text-xs text-slate-500 mb-3">
                Nobody has commented on these. Each one is a person waiting.
              </p>
              <div className="rounded-xl border border-slate-800 overflow-hidden">
                {data.neglected.map((i) => (
                  <a
                    key={i.number}
                    href={i.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 px-4 py-2.5 border-b border-slate-800/60 last:border-b-0 hover:bg-slate-800/40 transition-colors"
                  >
                    <span className="font-mono text-xs text-slate-600 shrink-0">#{i.number}</span>
                    <span className="text-xs text-slate-300 truncate flex-1 group-hover:text-white transition-colors">
                      {i.title}
                    </span>
                    <span className="text-xs text-amber-400/90 shrink-0 tabular-nums">{i.age_days}d</span>
                    <ExternalLink className="w-3 h-3 shrink-0 text-slate-700 group-hover:text-slate-400" />
                  </a>
                ))}
              </div>
            </Panel>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.top_labels.length > 0 && (
              <Panel title="Open issues by label" icon={Tag}>
                <div className="flex flex-wrap gap-2">
                  {data.top_labels.map((l) => (
                    <span
                      key={l.label}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border"
                      style={{
                        borderColor: `#${l.color}55`,
                        backgroundColor: `#${l.color}18`,
                        color: `#${l.color}`,
                      }}
                    >
                      {l.label}
                      <span className="font-mono opacity-80">{l.count}</span>
                    </span>
                  ))}
                </div>
              </Panel>
            )}

            {data.assignee_load.length > 0 && (
              <Panel title="Open issues by assignee" icon={Users}>
                <div className="space-y-2">
                  {data.assignee_load.map((a) => (
                    <div key={a.login} className="flex items-center gap-3">
                      <span className="font-mono text-xs text-slate-300 truncate flex-1">@{a.login}</span>
                      <div className="w-32 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-violet-500/80"
                          style={{ width: `${(a.open / data.assignee_load[0].open) * 100}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-xs text-slate-400 tabular-nums">{a.open}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </div>

          {data.partial && (
            <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              Based on the {data.total_analysed} most recently active issues. Quieter older issues
              are not included, so counts are a floor rather than a total.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Panel({
  title, icon: Icon, children,
}: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Stat({
  label, value, note, tone,
}: { label: string; value: number | string; note: string; tone: "slate" | "amber" | "emerald" | "red" }) {
  const color = {
    slate: "text-slate-100", amber: "text-amber-400",
    emerald: "text-emerald-400", red: "text-red-400",
  }[tone];
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500 mb-2">{label}</div>
      <div className={cn("font-mono text-3xl font-bold tabular-nums leading-none", color)}>{value}</div>
      <div className="text-[11px] text-slate-600 mt-2">{note}</div>
    </div>
  );
}

/** Backlog direction is the one number a lead reads first. */
function BacklogStat({
  delta, opened, closed, days,
}: { delta: number; opened: number; closed: number; days: number }) {
  const growing = delta > 0;
  const flat = delta === 0;
  const Icon = flat ? Minus : growing ? TrendingUp : TrendingDown;
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        flat ? "border-slate-800 bg-slate-900/50"
          : growing ? "border-amber-500/25 bg-amber-500/[0.06]"
          : "border-emerald-500/25 bg-emerald-500/[0.06]",
      )}
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500 mb-2">
        Backlog {days}d
      </div>
      <div className="flex items-center gap-2">
        <Icon className={cn("w-5 h-5 shrink-0", flat ? "text-slate-500" : growing ? "text-amber-400" : "text-emerald-400")} />
        <span className={cn("font-mono text-3xl font-bold tabular-nums leading-none",
          flat ? "text-slate-100" : growing ? "text-amber-400" : "text-emerald-400")}>
          {delta > 0 ? `+${delta}` : delta}
        </span>
      </div>
      <div className="text-[11px] text-slate-600 mt-2">
        {opened} opened · {closed} closed
      </div>
    </div>
  );
}

function DebtCard({
  icon: Icon, label, value, total, explanation,
}: {
  icon: React.ElementType; label: string; value: number; total: number; explanation: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const bad = pct >= 25 && value > 0;
  return (
    <div
      className={cn(
        "rounded-2xl border p-5",
        bad ? "border-amber-500/25 bg-amber-500/[0.05]" : "border-slate-800 bg-slate-900/40",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("w-4 h-4", bad ? "text-amber-400" : "text-slate-500")} />
        <span className="text-sm font-semibold text-white">{label}</span>
        <span className={cn("ml-auto font-mono text-2xl font-bold tabular-nums", bad ? "text-amber-400" : "text-slate-100")}>
          {value}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden mb-2.5">
        <div
          className={cn("h-full rounded-full", bad ? "bg-amber-500/80" : "bg-slate-600")}
          style={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%` }}
        />
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        {pct}% of open issues. {explanation}
      </p>
    </div>
  );
}
