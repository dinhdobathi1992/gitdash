"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import type { RepoDoraSummary } from "@/lib/dora";
import type { WorkflowOverview } from "@/lib/github";
import { MetricTooltip } from "@/components/MetricTooltip";
import { Database } from "lucide-react";

// ── Shared helpers ────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "#94a3b8", marginBottom: 4 },
};

function SectionCard({
  title,
  subtitle,
  tooltip,
  source,
  children,
}: {
  title: string;
  subtitle: string;
  tooltip?: string;
  source?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-start justify-between gap-2 mb-0.5">
        <div className="flex items-center gap-0.5">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {tooltip && <MetricTooltip text={tooltip} align="left" />}
        </div>
        {source && (
          <span className="flex items-center gap-1 text-[10px] text-slate-500 bg-slate-800/60 border border-slate-700/40 rounded-full px-2 py-0.5 shrink-0">
            <Database className="w-2.5 h-2.5" />
            {source}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

// ── 1. PR Cycle Time Breakdown ────────────────────────────────────────────────

const CYCLE_PHASES = [
  {
    key: "avg_time_to_open_ms" as const,
    label: "Time to Open",
    desc: "First commit → PR created",
    color: "#7c3aed",
  },
  {
    key: "avg_pickup_ms" as const,
    label: "Pickup Time",
    desc: "PR created → first review",
    color: "#2563eb",
  },
  {
    key: "avg_review_ms" as const,
    label: "Review Time",
    desc: "First review → approval",
    color: "#0891b2",
  },
  {
    key: "avg_merge_ms" as const,
    label: "Merge Time",
    desc: "Approval → merged",
    color: "#059669",
  },
] as const;

function PrCycleBreakdown({
  breakdown,
}: {
  breakdown: RepoDoraSummary["cycle_breakdown"];
}) {
  const values = CYCLE_PHASES.map(p => ({ ...p, ms: breakdown[p.key] }));
  const total = values.reduce((s, v) => s + v.ms, 0);

  if (total === 0 || breakdown.sample_size === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-slate-600 text-sm italic">
        Not enough PR detail data (requires merged PRs with reviews)
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Segmented proportional bar */}
      <div className="flex h-5 rounded-lg overflow-hidden gap-px">
        {values.map(phase => (
          <div
            key={phase.key}
            style={{ width: `${(phase.ms / total) * 100}%`, backgroundColor: phase.color }}
            title={`${phase.label}: ${fmtMs(phase.ms)}`}
          />
        ))}
      </div>

      {/* Phase legend — 2-column grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
        {values.map(phase => (
          <div key={phase.key} className="flex items-start gap-2.5">
            <div
              className="w-2.5 h-2.5 rounded-sm mt-0.5 shrink-0"
              style={{ backgroundColor: phase.color }}
            />
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs font-semibold text-white">{fmtMs(phase.ms)}</span>
                <span className="text-xs text-slate-400">{phase.label}</span>
              </div>
              <p className="text-[10px] text-slate-600 mt-0.5">{phase.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-slate-600 border-t border-slate-800 pt-3">
        Avg total lead time:{" "}
        <span className="text-slate-400 font-medium">{fmtMs(total)}</span>
        {" · "}
        {breakdown.sample_size} PR{breakdown.sample_size !== 1 ? "s" : ""} sampled
      </p>
    </div>
  );
}

// ── 2. PR Size vs Merge Velocity scatter ──────────────────────────────────────

function linearRegression(
  points: { x: number; y: number }[],
): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 3) return null;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  return {
    slope: (n * sumXY - sumX * sumY) / denom,
    intercept: (sumY - sumX * ((n * sumXY - sumX * sumY) / denom)) / n,
  };
}

// Custom dot with tooltip title stored in the point
type ScatterDot = { loc: number; hours_to_merge: number; number: number; title: string };

function PrSizeScatter({ points }: { points: RepoDoraSummary["pr_scatter"] }) {
  const data: ScatterDot[] = points.map(p => ({
    loc: p.loc,
    hours_to_merge: p.hours_to_merge,
    number: p.number,
    title: p.title,
  }));

  const reg = useMemo(
    () => linearRegression(data.map(d => ({ x: d.loc, y: d.hours_to_merge }))),
    [data],
  );

  // Two points for the trend reference line
  const maxLoc = Math.max(...data.map(d => d.loc), 1);
  const trendLine = reg
    ? [
        { loc: 0, trend: Math.max(0, reg.intercept) },
        { loc: maxLoc, trend: Math.max(0, reg.slope * maxLoc + reg.intercept) },
      ]
    : null;

  if (data.length < 3) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-600 text-sm italic">
        Need at least 3 merged PRs with size data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="loc"
          type="number"
          name="Lines changed"
          tick={{ fill: "#64748b", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          label={{
            value: "Lines changed",
            position: "insideBottom",
            offset: -2,
            fill: "#475569",
            fontSize: 10,
          }}
        />
        <YAxis
          dataKey="hours_to_merge"
          type="number"
          name="Hours to merge"
          tick={{ fill: "#64748b", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          unit="h"
          width={36}
        />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ payload }) => {
            const d = payload?.[0]?.payload as ScatterDot | undefined;
            if (!d) return null;
            return (
              <div
                style={TOOLTIP_STYLE.contentStyle}
                className="max-w-[200px]"
              >
                <p className="text-slate-400 text-[10px] mb-1">PR #{d.number}</p>
                <p className="text-white font-medium text-xs truncate">{d.title}</p>
                <p className="text-slate-300 text-xs mt-1">
                  {d.loc.toLocaleString()} lines · {d.hours_to_merge}h to merge
                </p>
              </div>
            );
          }}
        />
        <Scatter data={data} fill="#7c3aed" opacity={0.8} r={4} />

        {/* Trend line as a second scatter with lines */}
        {trendLine && (
          <Scatter
            data={trendLine}
            dataKey="trend"
            fill="none"
            line={{ stroke: "#94a3b8", strokeWidth: 1.5, strokeDasharray: "4 3" }}
            shape={() => null as unknown as React.ReactElement}
          />
        )}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ── 3. PR Throughput ──────────────────────────────────────────────────────────

function PrThroughput({ weeks }: { weeks: RepoDoraSummary["throughput_by_week"] }) {
  const data = weeks.map(w => ({
    label: new Date(w.week_start + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    PRs: w.count,
  }));

  const maxVal = Math.max(...data.map(d => d.PRs), 1);

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "#64748b", fontSize: 9 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "#64748b", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={24}
          allowDecimals={false}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(val: number | undefined) => [val ?? 0, "PRs merged"]}
        />
        <Bar
          dataKey="PRs"
          radius={[3, 3, 0, 0]}
          fill="#7c3aed"
          // Shade intensity by count
          label={false}
        >
          {data.map((entry, i) => (
            <rect
              key={i}
              fill={`hsl(263, 70%, ${30 + Math.round((entry.PRs / maxVal) * 30)}%)`}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── 4. Workflow Stability ─────────────────────────────────────────────────────

function WorkflowStability({ overview }: { overview: WorkflowOverview[] }) {
  // Aggregate trend_30d across all workflows
  const aggregate = useMemo(() => {
    const map: Record<string, { success: number; total: number }> = {};
    for (const wf of overview) {
      for (const pt of wf.summary.trend_30d) {
        if (!map[pt.date]) map[pt.date] = { success: 0, total: 0 };
        map[pt.date].success += pt.success;
        map[pt.date].total += pt.total;
      }
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { success, total }]) => ({
        label: new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        rate: total > 0 ? Math.round((success / total) * 100) : null,
      }))
      .filter(d => d.rate !== null);
  }, [overview]);

  if (aggregate.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-600 text-sm italic">
        No workflow run data for the last 30 days
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={aggregate} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "#64748b", fontSize: 9 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "#64748b", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          domain={[0, 100]}
          unit="%"
          width={32}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(val: number | undefined) => [`${val ?? 0}%`, "Pass rate"]}
        />
        {/* Elite threshold */}
        <ReferenceLine
          y={95}
          stroke="#10b981"
          strokeDasharray="4 3"
          strokeWidth={1}
          label={{ value: "Elite 95%", fill: "#10b981", fontSize: 9, position: "right" }}
        />
        {/* High threshold */}
        <ReferenceLine
          y={80}
          stroke="#3b82f6"
          strokeDasharray="4 3"
          strokeWidth={1}
          label={{ value: "High 80%", fill: "#3b82f6", fontSize: 9, position: "right" }}
        />
        <Line
          type="monotone"
          dataKey="rate"
          stroke="#7c3aed"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export function DoraDrillDown({
  dora,
  overview,
}: {
  dora: RepoDoraSummary;
  overview: WorkflowOverview[];
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* ① PR Cycle Time Breakdown */}
      <SectionCard
        title="PR Cycle Time Breakdown"
        subtitle="Average time in each phase of the PR lifecycle — explains lead time"
        tooltip="Splits Lead Time into 4 phases: Time to Open (code written but not yet a PR), Pickup Time (PR waiting for first review), Review Time (under review), and Merge Time (approved but not yet merged). Each bar segment is proportional to its share of total lead time."
        source={`top 20 of ${dora.prs_analysed} merged PRs`}
      >
        <PrCycleBreakdown breakdown={dora.cycle_breakdown} />
      </SectionCard>

      {/* ② PR Size vs. Merge Velocity */}
      <SectionCard
        title="PR Size vs. Merge Velocity"
        subtitle="Lines changed (X) vs hours to merge (Y) — smaller PRs ship faster"
        tooltip="Each dot is a merged PR. The X-axis shows lines changed (additions + deletions), the Y-axis shows hours from PR open to merge. The trend line confirms that smaller PRs merge faster — use this to encourage right-sized changes."
        source={`${dora.pr_scatter.length} merged PRs`}
      >
        <PrSizeScatter points={dora.pr_scatter} />
      </SectionCard>

      {/* ③ PR Throughput */}
      <SectionCard
        title="PR Throughput"
        subtitle="Merged PRs per week over the last 12 weeks — explains deployment frequency"
        tooltip="Number of PRs merged to the default branch each calendar week. A steady or rising trend indicates a healthy delivery cadence. Sudden drops may signal blocked work, vacations, or process bottlenecks."
        source={`${dora.prs_analysed} merged PRs · weekly buckets`}
      >
        <PrThroughput weeks={dora.throughput_by_week} />
      </SectionCard>

      {/* ④ Workflow Stability */}
      <SectionCard
        title="Workflow Stability"
        subtitle="Default branch pass rate over 30 days — correlates with change failure rate"
        tooltip="Percentage of CI workflow runs on the default branch that completed successfully, plotted daily over 30 days. Dashed reference lines mark Elite (95%) and High (80%) DORA thresholds. A persistently red main branch directly raises your Change Failure Rate."
        source={`${overview.length} workflows · last 20 runs each`}
      >
        <WorkflowStability overview={overview} />
      </SectionCard>
    </div>
  );
}
