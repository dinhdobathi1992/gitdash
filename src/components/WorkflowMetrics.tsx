"use client";

import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, XCircle, Clock, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RepoSummary } from "@/lib/github";

// ── Run history bars (last 10) ────────────────────────────────────────────────
export function RunHistoryBars({ runs }: { runs: RepoSummary["recent_runs"] }) {
  const slots = [...runs];
  while (slots.length < 10)
    slots.push({ id: -slots.length, conclusion: null, status: null, created_at: "" });

  return (
    <div className="flex items-end gap-0.5 h-6">
      {slots.map((r) => {
        let bg = "bg-slate-700/50";
        if (r.conclusion === "success") bg = "bg-emerald-500";
        else if (r.conclusion === "failure") bg = "bg-red-500";
        else if (r.conclusion === "cancelled") bg = "bg-yellow-500/70";
        else if (r.status === "in_progress") bg = "bg-blue-500 animate-pulse";
        return (
          <div
            key={r.id}
            title={r.conclusion ?? r.status ?? "no data"}
            className={cn("w-2.5 rounded-sm transition-all", bg)}
            style={{ height: r.conclusion || r.status === "in_progress" ? "100%" : "40%" }}
          />
        );
      })}
    </div>
  );
}

// ── Trend sparkline (30d) — inline SVG ───────────────────────────────────────
export function TrendSparkline({ points }: { points: RepoSummary["trend_30d"] }) {
  if (points.length < 2) {
    return <span className="text-xs text-slate-600 italic">no data</span>;
  }

  const W = 120;
  const H = 32;
  const rates = points.map((p) => (p.total > 0 ? p.success / p.total : 0));
  const maxR = Math.max(...rates, 0.01);

  const coords = rates.map((r, i) => ({
    x: (i / (rates.length - 1)) * W,
    y: H - (r / maxR) * (H - 4) - 2,
  }));

  const pathD = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");

  const lastRate = rates[rates.length - 1];
  const strokeColor =
    lastRate >= 0.8 ? "#10b981" : lastRate >= 0.5 ? "#f59e0b" : "#ef4444";

  const areaD = `${pathD} L${W},${H} L0,${H} Z`;
  const gradId = `tg-${points[0]?.date ?? "x"}`;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={coords[coords.length - 1].x}
        cy={coords[coords.length - 1].y}
        r="2.5"
        fill={strokeColor}
      />
    </svg>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
export function StatusBadge({ summary }: { summary: RepoSummary | undefined }) {
  if (!summary) return <span className="text-xs text-slate-600">—</span>;

  const { latest_conclusion, latest_status, latest_run_at } = summary;

  if (latest_status === "in_progress") {
    return (
      <div>
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-blue-500/10 border-blue-500/30 text-blue-300">
          <Clock className="w-3 h-3 animate-spin" /> Running
        </span>
      </div>
    );
  }
  if (latest_conclusion === "success") {
    return (
      <div>
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
          Passing
        </span>
        {latest_run_at && (
          <p className="text-[11px] text-slate-500 mt-1">
            {formatDistanceToNow(new Date(latest_run_at))} ago
          </p>
        )}
      </div>
    );
  }
  if (latest_conclusion === "failure") {
    return (
      <div>
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-red-500/10 border-red-500/30 text-red-300">
          Failing
        </span>
        {latest_run_at && (
          <p className="text-[11px] text-slate-500 mt-1">
            {formatDistanceToNow(new Date(latest_run_at))} ago
          </p>
        )}
      </div>
    );
  }
  if (latest_conclusion === "cancelled") {
    return (
      <div>
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-yellow-500/10 border-yellow-500/30 text-yellow-300">
          Cancelled
        </span>
        {latest_run_at && (
          <p className="text-[11px] text-slate-500 mt-1">
            {formatDistanceToNow(new Date(latest_run_at))} ago
          </p>
        )}
      </div>
    );
  }

  return <span className="text-xs text-slate-600">No runs</span>;
}

// ── Health badge ──────────────────────────────────────────────────────────────
export function HealthBadge({ summary }: { summary: RepoSummary | undefined }) {
  if (!summary || summary.recent_runs.every((r) => !r.conclusion)) {
    return <span className="text-xs text-slate-600">—</span>;
  }
  const rate = summary.success_rate;
  if (rate >= 80) {
    return (
      <div>
        <span className="flex items-center gap-1 text-sm font-medium text-emerald-400">
          <CheckCircle2 className="w-4 h-4" /> Good
        </span>
        <p className="text-[11px] text-slate-500 mt-0.5">{rate}% success</p>
      </div>
    );
  }
  if (rate >= 50) {
    return (
      <div>
        <span className="flex items-center gap-1 text-sm font-medium text-yellow-400">
          <Info className="w-4 h-4" /> Fair
        </span>
        <p className="text-[11px] text-slate-500 mt-0.5">{rate}% success</p>
      </div>
    );
  }
  return (
    <div>
      <span className="flex items-center gap-1 text-sm font-medium text-red-400">
        <XCircle className="w-4 h-4" /> Poor
      </span>
      <p className="text-[11px] text-slate-500 mt-0.5">{rate}% success</p>
    </div>
  );
}
