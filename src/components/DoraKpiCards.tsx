"use client";

import { Rocket, Clock, AlertTriangle, Wrench, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEVEL_COLORS, LEVEL_LABELS, BENCHMARKS } from "@/lib/dora";
import type { RepoDoraSummary, DoraLevel } from "@/lib/dora";
import { MetricTooltip } from "@/components/MetricTooltip";

// ── Skeleton ──────────────────────────────────────────────────────────────────
export function DoraKpiSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-4 flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg skeleton" />
            <div className="space-y-1.5">
              <div className="h-3 w-24 rounded skeleton" />
              <div className="h-2.5 w-16 rounded skeleton" />
            </div>
          </div>
          <div>
            <div className="h-7 w-20 rounded skeleton mb-1.5" />
            <div className="h-2.5 w-28 rounded skeleton" />
          </div>
          <div className="flex items-center justify-between">
            <div className="h-5 w-14 rounded-full skeleton" />
            <div className="h-2.5 w-24 rounded skeleton" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Overall level banner ──────────────────────────────────────────────────────
function OverallBadge({ level }: { level: DoraLevel }) {
  const c = LEVEL_COLORS[level];
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border",
        c.bg,
        c.text,
        c.border,
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      Overall: {LEVEL_LABELS[level]}
    </div>
  );
}

// ── Individual card ───────────────────────────────────────────────────────────
type MetricConfig = {
  key: keyof typeof BENCHMARKS;
  title: string;
  subtitle: string;
  tooltip: string;
  Icon: React.ElementType;
  getLevel: (d: RepoDoraSummary) => DoraLevel;
  getValue: (d: RepoDoraSummary) => string;
  getDetail: (d: RepoDoraSummary) => string;
};

const METRICS: MetricConfig[] = [
  {
    key: "deployment_frequency",
    title: "Deploy Frequency",
    subtitle: "How often code ships",
    tooltip: "How often the team ships to production. Counted from GitHub Releases (or merged PRs to main when no releases exist). Elite teams deploy multiple times per day.",
    Icon: Rocket,
    getLevel: d => d.deployment_frequency.level,
    getValue: d => d.deployment_frequency.label,
    getDetail: d =>
      `${d.deployment_frequency.total} deploys · ${d.deployment_frequency.period_days}d window`,
  },
  {
    key: "lead_time",
    title: "Lead Time",
    subtitle: "First commit → merged",
    tooltip: "Average time from the oldest commit on a PR to when that PR is merged. Measures how quickly code moves through your pipeline. Elite teams achieve under 1 hour.",
    Icon: Clock,
    getLevel: d => d.lead_time.level,
    getValue: d => d.lead_time.label,
    getDetail: d => `${d.lead_time.sample_size} PRs · p95 ${formatMs(d.lead_time.p95_ms)}`,
  },
  {
    key: "change_failure_rate",
    title: "Change Failure Rate",
    subtitle: "Hotfix / revert PRs",
    tooltip: "Percentage of changes that caused a production failure, measured as PRs with 'hotfix', 'revert', or 'fix' in the branch name vs. all merged PRs. Elite teams stay below 5%.",
    Icon: AlertTriangle,
    getLevel: d => d.change_failure_rate.level,
    getValue: d => d.change_failure_rate.label,
    getDetail: d =>
      `${d.change_failure_rate.failures} of ${d.change_failure_rate.total} merged PRs`,
  },
  {
    key: "mttr",
    title: "Time to Restore",
    subtitle: "Hotfix PR cycle time",
    tooltip: "How long it takes to recover from a failure — measured as the average time from opening a hotfix or revert PR to merging it. Elite teams restore service in under 1 hour.",
    Icon: Wrench,
    getLevel: d => d.mttr.level,
    getValue: d => d.mttr.label,
    getDetail: d =>
      d.mttr.recoveries > 0
        ? `${d.mttr.recoveries} recovery event${d.mttr.recoveries !== 1 ? "s" : ""}`
        : "No failures detected",
  },
];

function formatMs(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function MetricCard({ metric, data }: { metric: MetricConfig; data: RepoDoraSummary }) {
  const level = metric.getLevel(data);
  const c = LEVEL_COLORS[level];

  return (
    <div
      className={cn(
        "rounded-xl border p-4 flex flex-col gap-3 bg-slate-900/40 transition-colors",
        c.border,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center border shrink-0",
            c.bg,
            c.border,
          )}
        >
          <metric.Icon className={cn("w-3.5 h-3.5", c.text)} />
        </div>
        <div>
          <div className="flex items-center">
            <p className="text-xs font-semibold text-slate-300 leading-tight">{metric.title}</p>
            <MetricTooltip text={metric.tooltip} align="left" />
          </div>
          <p className="text-[10px] text-slate-500 leading-tight mt-0.5">{metric.subtitle}</p>
        </div>
      </div>

      {/* Value */}
      <div>
        <p className="text-2xl font-bold text-white font-mono leading-none">
          {metric.getValue(data)}
        </p>
        <p className="text-[11px] text-slate-500 mt-1">{metric.getDetail(data)}</p>
      </div>

      {/* Level + benchmark */}
      <div className="flex items-center justify-between gap-2 mt-auto">
        <span
          className={cn(
            "text-xs font-semibold px-2 py-0.5 rounded-full shrink-0",
            c.bg,
            c.text,
          )}
        >
          {LEVEL_LABELS[level]}
        </span>
        <span className="text-[10px] text-slate-600 text-right leading-tight">
          {BENCHMARKS[metric.key][level]}
        </span>
      </div>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────
export function DoraKpiCards({ data }: { data: RepoDoraSummary }) {
  const sourceLabel = data.releases_analysed > 0
    ? `${data.prs_analysed} merged PRs · ${data.releases_analysed} releases`
    : `${data.prs_analysed} merged PRs · no releases (using PR merges for deploy freq)`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">DORA Metrics</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Repo health scorecard — delivery performance
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-800/60 border border-slate-700/40 rounded-full px-2.5 py-1">
            <Database className="w-2.5 h-2.5" />
            {sourceLabel}
          </span>
          <OverallBadge level={data.overall_level} />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {METRICS.map(m => (
          <MetricCard key={m.key} metric={m} data={data} />
        ))}
      </div>
    </div>
  );
}
