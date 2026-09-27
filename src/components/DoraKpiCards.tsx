"use client";

/**
 * DORA KPI cards — design contract §5 "KPI card", `Repo` artboard.
 * Label + rating chip → figure (mono) → full-width sparkline → detail line.
 * The Low-rated metric gets the warm "regressing" treatment. Series come
 * from the summary itself (weekly merges, per-PR merge times); metrics with
 * no series show no sparkline rather than an invented one.
 */

import { Card } from "@/components/ui/Card";
import { RatingChip, type Rating } from "@/components/ui/StatusPill";
import { Sparkline } from "@/components/ui/Sparkline";
import { MetricTooltip } from "@/components/MetricTooltip";
import { LEVEL_LABELS } from "@/lib/dora";
import type { RepoDoraSummary, DoraLevel } from "@/lib/dora";

export function DoraKpiSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between"><div className="h-3.5 w-28 rounded skeleton" /><div className="h-[22px] w-12 rounded-chip skeleton" /></div>
          <div className="h-8 w-24 rounded skeleton" />
          <div className="h-9 w-full rounded skeleton" />
          <div className="h-3 w-32 rounded skeleton" />
        </div>
      ))}
    </div>
  );
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 && h < 10 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function weeklyMedian(points: { merged_at: string; hours_to_merge: number }[]): number[] {
  const byWeek = new Map<string, number[]>();
  for (const p of points) {
    const d = new Date(p.merged_at);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
    const k = monday.toISOString().slice(0, 10);
    byWeek.set(k, [...(byWeek.get(k) ?? []), p.hours_to_merge]);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; });
}

interface Metric {
  key: string;
  title: string;
  tooltip: string;
  level: DoraLevel;
  value: React.ReactNode;
  detail: string;
  series: number[];
  color: string;
}

function metrics(d: RepoDoraSummary): Metric[] {
  const perDay = d.deployment_frequency.per_day;
  const freq = perDay >= 1
    ? <>{perDay.toFixed(1)}<span className="text-muted text-lg font-normal"> / day</span></>
    : perDay * 7 >= 1
      ? <>{(perDay * 7).toFixed(1)}<span className="text-muted text-lg font-normal"> / week</span></>
      : <>{d.deployment_frequency.label}</>;
  return [
    {
      key: "df",
      title: "Deploy frequency",
      tooltip: "How often the team ships. Counted from GitHub Releases, or merged pull requests to the default branch when there are no releases.",
      level: d.deployment_frequency.level,
      value: freq,
      detail: `${d.deployment_frequency.total} ${d.releases_analysed > 0 ? "releases" : "merged pull requests"} in ${d.deployment_frequency.period_days} days`,
      series: d.throughput_by_week.map((w) => w.count),
      color: "var(--accent)",
    },
    {
      key: "lt",
      title: "Lead time for changes",
      tooltip: "Time from a pull request's first commit to its merge. Median shown; p95 in the detail line.",
      level: d.lead_time.level,
      value: formatMs(d.lead_time.median_ms),
      detail: `p95 ${formatMs(d.lead_time.p95_ms)} · from ${d.lead_time.sample_size} pull requests`,
      series: weeklyMedian(d.pr_scatter),
      color: "var(--accent)",
    },
    {
      key: "cfr",
      title: "Change failure rate",
      tooltip: "Share of merged pull requests that were hotfixes or reverts (by branch name).",
      level: d.change_failure_rate.level,
      value: d.change_failure_rate.label,
      detail: `${d.change_failure_rate.failures} of ${d.change_failure_rate.total} merged pull requests`,
      series: [],
      color: "var(--status-failure)",
    },
    {
      key: "ttr",
      title: "Time to restore",
      tooltip: "Average time from opening a hotfix or revert pull request to merging it.",
      level: d.mttr.level,
      value: d.mttr.label,
      detail: d.mttr.recoveries > 0
        ? `from ${d.mttr.recoveries} hotfix or revert pull request${d.mttr.recoveries === 1 ? "" : "s"}`
        : "No hotfix or revert pull requests found",
      series: [],
      color: "var(--accent)",
    },
  ];
}

export function DoraKpiCards({ data }: { data: RepoDoraSummary }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {metrics(data).map((m) => {
        const warm = m.level === "low";
        return (
          <Card key={m.key} as="article" warm={warm} className="p-4 sm:p-5 flex flex-col min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="flex items-center text-[13px] text-muted min-w-0">
                <span className="truncate">{m.title}</span>
                <MetricTooltip text={m.tooltip} align="left" />
              </h3>
              <RatingChip rating={LEVEL_LABELS[m.level] as Rating} className="hidden sm:inline-flex shrink-0" />
            </div>
            <p className="mt-2 font-mono text-2xl sm:text-[26px] leading-8 font-semibold text-fg tabular-nums">{m.value}</p>
            <div className="mt-3 h-9 hidden sm:block">
              {m.series.length >= 2 && (
                <Sparkline values={m.series} width={240} height={36} color={warm ? "var(--status-failure)" : m.color} className="w-full" />
              )}
            </div>
            <p className="mt-2 text-xs text-muted">
              <RatingChip rating={LEVEL_LABELS[m.level] as Rating} className="sm:hidden mr-1.5 align-middle" />
              {m.detail}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
