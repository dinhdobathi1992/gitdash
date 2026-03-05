"use client";

import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type { OpenPrHealthResponse } from "@/app/api/github/open-pr-health/route";
import { cn } from "@/lib/utils";
import { AlertTriangle, Clock, Database, GitPullRequest, XCircle } from "lucide-react";
import { MetricTooltip } from "@/components/MetricTooltip";

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
  children,
}: {
  title: string;
  subtitle: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-center gap-0.5 mb-0.5">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {tooltip && <MetricTooltip text={tooltip} align="left" />}
      </div>
      <p className="text-xs text-slate-500 mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

function fmtHours(h: number): string {
  if (h <= 0) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

// ── Time to First Review Bar ──────────────────────────────────────────────────
function TimeToFirstReviewChart({
  p50,
  p90,
  approvalP50,
  approvalP90,
}: {
  p50: number;
  p90: number;
  approvalP50: number;
  approvalP90: number;
}) {
  const data = [
    { metric: "First Review P50", hours: p50, color: "#2563eb" },
    { metric: "First Review P90", hours: p90, color: "#7c3aed" },
    { metric: "Approval→Merge P50", hours: approvalP50, color: "#0891b2" },
    { metric: "Approval→Merge P90", hours: approvalP90, color: "#059669" },
  ];

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={140}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            unit="h"
          />
          <YAxis
            type="category"
            dataKey="metric"
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={130}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(val: number | undefined) => [
              fmtHours(val ?? 0),
              "Duration",
            ]}
          />
          <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
            First Review P50
          </p>
          <p className="text-sm font-bold text-blue-400">{fmtHours(p50)}</p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
            First Review P90
          </p>
          <p className="text-sm font-bold text-violet-400">{fmtHours(p90)}</p>
        </div>
      </div>
    </div>
  );
}

// ── PR Age Distribution ───────────────────────────────────────────────────────
function PrAgeDistribution({
  distribution,
}: {
  distribution: { bucket: string; count: number }[];
}) {
  const COLORS = ["#059669", "#0891b2", "#d97706", "#dc2626", "#7c3aed"];

  if (distribution.every((d) => d.count === 0)) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-600 text-sm italic">
        No open PRs
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart
        data={distribution}
        margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="bucket"
          tick={{ fill: "#64748b", fontSize: 9 }}
          axisLine={false}
          tickLine={false}
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
          formatter={(val: number | undefined) => [val ?? 0, "PRs"]}
        />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {distribution.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Review Round Distribution ─────────────────────────────────────────────────
function ReviewRoundChart({
  distribution,
}: {
  distribution: { rounds: string; count: number }[];
}) {
  const COLORS = ["#64748b", "#059669", "#d97706", "#dc2626"];
  const total = distribution.reduce((s, d) => s + d.count, 0);

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-600 text-sm italic">
        No review data
      </div>
    );
  }

  const RADIAN = Math.PI / 180;

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width="50%" height={160}>
        <PieChart>
          <Pie
            data={distribution}
            dataKey="count"
            nameKey="rounds"
            cx="50%"
            cy="50%"
            innerRadius={35}
            outerRadius={65}
            paddingAngle={2}
            label={((props: Record<string, unknown>) => {
              const cx = (props.cx as number) ?? 0;
              const cy = (props.cy as number) ?? 0;
              const midAngle = (props.midAngle as number) ?? 0;
              const innerRadius = (props.innerRadius as number) ?? 0;
              const outerRadius = (props.outerRadius as number) ?? 0;
              const percent = (props.percent as number) ?? 0;
              const radius = innerRadius + (outerRadius - innerRadius) * 1.4;
              const x = cx + radius * Math.cos(-midAngle * RADIAN);
              const y = cy + radius * Math.sin(-midAngle * RADIAN);
              return percent > 0.05 ? (
                <text
                  x={x}
                  y={y}
                  fill="#94a3b8"
                  textAnchor={x > cx ? "start" : "end"}
                  dominantBaseline="central"
                  fontSize={10}
                >
                  {`${(percent * 100).toFixed(0)}%`}
                </text>
              ) : null;
            }) as unknown as undefined}
          >
            {distribution.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(val: number | undefined, name: string | undefined) => [
              val ?? 0,
              `${name ?? ""} round${name !== "1" ? "s" : ""}`,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-2">
        {distribution.map((d, i) => (
          <div key={d.rounds} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-sm shrink-0"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="text-xs text-slate-400">
              {d.rounds} round{d.rounds !== "1" ? "s" : ""}:{" "}
              <span className="text-white font-medium">{d.count}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stale PR Alerts ───────────────────────────────────────────────────────────
function StalePrAlerts({
  prs,
}: {
  prs: OpenPrHealthResponse["open_prs"];
}) {
  const stalePrs = prs.filter((pr) => pr.age_hours > 120 && !pr.has_review && !pr.draft);
  const draftPrs = prs.filter((pr) => pr.draft);

  if (stalePrs.length === 0 && draftPrs.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic text-center py-4">
        No stale or unreviewed PRs detected
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {stalePrs.map((pr) => (
        <div
          key={pr.number}
          className="flex items-start gap-2.5 p-2.5 rounded-lg bg-red-500/5 border border-red-500/15"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <a
              href={pr.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-white hover:text-violet-300 transition-colors"
            >
              #{pr.number} {pr.title}
            </a>
            <p className="text-[10px] text-slate-500 mt-0.5">
              by @{pr.author} &middot; {fmtHours(pr.age_hours)} old &middot; no reviews
            </p>
          </div>
        </div>
      ))}
      {draftPrs.length > 0 && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-800/50 border border-slate-700/50">
          <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="text-xs text-slate-400">
            {draftPrs.length} draft PR{draftPrs.length !== 1 ? "s" : ""} currently open
          </span>
        </div>
      )}
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────
export function PrLifecycleExtension({
  data,
}: {
  data: OpenPrHealthResponse;
}) {
  return (
    <div className="space-y-4">
      {/* Data source badge */}
      <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
        <Database className="w-2.5 h-2.5" />
        <span>
          {data.total_open} open PRs · {data.closed_prs_analysed} recently closed PRs for benchmarks
        </span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <GitPullRequest className="w-4 h-4 text-violet-400" />
            <span className="text-xs text-slate-400">Open PRs</span>
            <MetricTooltip text="Total number of pull requests currently open in this repository. A growing count over time signals a review bottleneck or accumulating WIP." align="left" />
          </div>
          <p className="text-2xl font-bold text-white">{data.total_open}</p>
          <p className="text-[11px] text-slate-500 mt-1">currently open</p>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-slate-400">Review P50</span>
            <MetricTooltip text="Median time from a PR being opened to receiving its first review. 50% of PRs are reviewed faster than this value. Target: under 4 hours for active repos." align="left" />
          </div>
          <p className="text-2xl font-bold text-white">
            {fmtHours(data.time_to_first_review_p50_hours)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">from {data.closed_prs_analysed} recently closed PRs</p>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-violet-400" />
            <span className="text-xs text-slate-400">Review P90</span>
            <MetricTooltip text="90th-percentile time to first review — 90% of PRs are reviewed within this time. A large gap between P50 and P90 means a long tail of ignored PRs. Target: under 1 day." align="left" />
          </div>
          <p className="text-2xl font-bold text-white">
            {fmtHours(data.time_to_first_review_p90_hours)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">from {data.closed_prs_analysed} recently closed PRs</p>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-slate-400">Abandon Rate</span>
            <MetricTooltip text="Percentage of recently closed PRs that were closed without being merged. High abandon rates may indicate unclear requirements, blocked work, or PRs that were superseded. Target: under 10%." align="right" />
          </div>
          <p className={cn(
            "text-2xl font-bold",
            data.abandon_rate > 20 ? "text-red-400" : data.abandon_rate > 10 ? "text-amber-400" : "text-green-400"
          )}>
            {data.abandon_rate}%
          </p>
          <p className="text-[11px] text-slate-500 mt-1">{data.closed_prs_analysed} closed PRs analysed</p>
        </div>
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Time to First Review (P50/P90)"
          subtitle="How quickly PRs get reviewed after opening"
          tooltip="P50 (median) and P90 (90th percentile) of the time between a PR being opened and receiving its first review comment or approval. Also shows Approval→Merge times. High P90 values indicate a long tail of ignored PRs."
        >
          <TimeToFirstReviewChart
            p50={data.time_to_first_review_p50_hours}
            p90={data.time_to_first_review_p90_hours}
            approvalP50={data.time_approval_to_merge_p50_hours}
            approvalP90={data.time_approval_to_merge_p90_hours}
          />
        </SectionCard>

        <SectionCard
          title="Open PR Age Distribution"
          subtitle="How long current open PRs have been waiting"
          tooltip="Buckets currently open PRs by how long they have been open: under 1 day, 1–3 days, 3–7 days, 1–2 weeks, and 2+ weeks. Large bars in the right buckets signal a review bottleneck or abandoned work."
        >
          <PrAgeDistribution distribution={data.age_distribution} />
        </SectionCard>

        <SectionCard
          title="Review Round Distribution"
          subtitle="How many review cycles PRs go through before merge"
          tooltip="How many back-and-forth review rounds merged PRs went through. A high '3+ rounds' slice may mean unclear requirements, insufficient PR descriptions, or overly strict review standards slowing delivery."
        >
          <ReviewRoundChart distribution={data.review_round_distribution} />
        </SectionCard>

        <SectionCard
          title="Stale & Unreviewed PRs"
          subtitle="Open PRs older than 5 business days without reviews"
          tooltip="Open PRs that have been waiting more than 5 business days without any review activity. These represent blocked work and directly inflate Review P90 and Pickup Time metrics."
        >
          <StalePrAlerts prs={data.open_prs} />
        </SectionCard>
      </div>

      {/* Concurrent PRs by author */}
      {data.concurrent_prs_by_author.length > 0 && (
        <SectionCard
          title="Concurrent Open PRs by Author"
          subtitle="Too many open PRs may indicate context switching or WIP debt"
          tooltip="Number of currently open PRs per author. Having more than 2–3 open PRs simultaneously suggests context switching, which research links to slower review times and more defects. Yellow ≥ 3, Red ≥ 5."
        >
          <div className="space-y-1.5">
            {data.concurrent_prs_by_author.map((a) => (
              <div key={a.login} className="flex items-center gap-3">
                <span className="text-xs text-slate-300 w-28 text-right truncate font-mono">
                  @{a.login}
                </span>
                <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      a.count >= 5
                        ? "bg-red-500/70"
                        : a.count >= 3
                          ? "bg-amber-500/70"
                          : "bg-violet-500/70"
                    )}
                    style={{
                      width: `${Math.min(
                        100,
                        (a.count / Math.max(...data.concurrent_prs_by_author.map((x) => x.count), 1)) * 100
                      )}%`,
                    }}
                  />
                </div>
                <span
                  className={cn(
                    "text-xs font-mono w-6 text-right",
                    a.count >= 5
                      ? "text-red-400"
                      : a.count >= 3
                        ? "text-amber-400"
                        : "text-slate-400"
                  )}
                >
                  {a.count}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

export function PrLifecycleSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
            <div className="h-3 w-20 rounded skeleton mb-3" />
            <div className="h-6 w-12 rounded skeleton" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-5">
            <div className="h-4 w-40 rounded skeleton mb-2" />
            <div className="h-3 w-56 rounded skeleton mb-4" />
            <div className="h-32 rounded skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}
