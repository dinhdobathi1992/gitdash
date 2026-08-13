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
} from "recharts";

interface FunnelData {
  opened: number;
  reviewed: number;
  approved: number;
  merged: number;
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

/**
 * PR lifecycle funnel: opened → reviewed → approved → merged
 * Renders as a horizontal bar chart with decreasing widths.
 */
export function ContributorPrFunnel({ funnel }: { funnel: FunnelData }) {
  const data = useMemo(
    () => [
      { stage: "Opened", count: funnel.opened, color: "#7c3aed" },
      { stage: "Reviewed", count: funnel.reviewed, color: "#2563eb" },
      { stage: "Approved", count: funnel.approved, color: "#0891b2" },
      { stage: "Merged", count: funnel.merged, color: "#059669" },
    ],
    [funnel]
  );

  if (funnel.opened === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-600 text-sm italic">
        No PR data available for funnel analysis
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Funnel bars */}
      <ResponsiveContainer width="100%" height={160}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#1e293b"
            horizontal={false}
          />
          <XAxis
            type="number"
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="stage"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={70}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(val) => [val ?? 0, "PRs"]}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#7c3aed">
            {data.map((entry, i) => (
              <rect key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Conversion rates */}
      <div className="grid grid-cols-3 gap-2">
        {funnel.opened > 0 && (
          <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
              Review Rate
            </p>
            <p className="text-sm font-bold text-blue-400">
              {Math.round((funnel.reviewed / funnel.opened) * 100)}%
            </p>
          </div>
        )}
        {funnel.reviewed > 0 && (
          <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
              Approval Rate
            </p>
            <p className="text-sm font-bold text-cyan-400">
              {Math.round((funnel.approved / funnel.reviewed) * 100)}%
            </p>
          </div>
        )}
        {funnel.opened > 0 && (
          <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
              Merge Rate
            </p>
            <p className="text-sm font-bold text-green-400">
              {Math.round((funnel.merged / funnel.opened) * 100)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
