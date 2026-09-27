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
} from "@/components/charts";

interface FunnelData {
  opened: number;
  reviewed: number;
  approved: number;
  merged: number;
}

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#1E242D",
    border: "1px solid #2A313C",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "#A3A9B4", marginBottom: 4 },
};

/**
 * PR lifecycle funnel: opened → reviewed → approved → merged
 * Renders as a horizontal bar chart with decreasing widths.
 */
export function ContributorPrFunnel({ funnel }: { funnel: FunnelData }) {
  const data = useMemo(
    () => [
      { stage: "Opened", count: funnel.opened, color: "#A48BFF" },
      { stage: "Reviewed", count: funnel.reviewed, color: "#74B6F4" },
      { stage: "Approved", count: funnel.approved, color: "#4FD1E8" },
      { stage: "Merged", count: funnel.merged, color: "#3DD68C" },
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
            stroke="#1E242D"
            horizontal={false}
          />
          <XAxis
            type="number"
            tick={{ fill: "#7A818D", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="stage"
            tick={{ fill: "#A3A9B4", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={70}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(val) => [val ?? 0, "PRs"]}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#A48BFF">
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
            <p className="text-xs text-slate-500 mb-0.5">
              Review Rate
            </p>
            <p className="text-sm font-bold text-blue-400">
              {Math.round((funnel.reviewed / funnel.opened) * 100)}%
            </p>
          </div>
        )}
        {funnel.reviewed > 0 && (
          <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
            <p className="text-xs text-slate-500 mb-0.5">
              Approval Rate
            </p>
            <p className="text-sm font-bold text-cyan-400">
              {Math.round((funnel.approved / funnel.reviewed) * 100)}%
            </p>
          </div>
        )}
        {funnel.opened > 0 && (
          <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
            <p className="text-xs text-slate-500 mb-0.5">
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
