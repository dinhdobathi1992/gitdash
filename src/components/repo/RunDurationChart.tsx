"use client";

/**
 * Run duration — daily p50 and p95 across all workflows (`Repo` artboard).
 * Area lines per contract §6: 2 px, 12% fill, one highlighted point (the
 * worst p95 day) with a label chip, mono 11 px axes, takeaway aria-label.
 */

import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot,
  AXIS_PROPS, GRID_PROPS, TOOLTIP_PROPS, SERIES_COLORS, AREA_OPACITY,
} from "@/components/charts";
import type { WorkflowOverview } from "@/lib/github";
import { formatDurationShort, percentile } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/Card";

const P50 = SERIES_COLORS[1];
const P95 = SERIES_COLORS[0];

function day(iso: string) {
  return new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function RunDurationChart({ workflows }: { workflows: WorkflowOverview[] }) {
  const data = useMemo(() => {
    const byDay = new Map<string, number[]>();
    for (const wf of workflows) {
      for (const p of wf.dur_points) {
        const k = p.created_at.slice(0, 10);
        byDay.set(k, [...(byDay.get(k) ?? []), p.duration_ms]);
      }
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([k, v]) => ({ date: k, label: day(k), p50: (percentile(v, 50) ?? 0) / 60_000, p95: (percentile(v, 95) ?? 0) / 60_000 }));
  }, [workflows]);

  const peak = data.reduce<(typeof data)[number] | null>((m, d) => (!m || d.p95 > m.p95 ? d : m), null);
  const takeaway = peak
    ? `Daily p95 run duration peaked at ${formatDurationShort(peak.p95 * 60_000)} on ${peak.label}; latest p50 ${formatDurationShort((data.at(-1)?.p50 ?? 0) * 60_000)}.`
    : "No completed runs to chart.";

  return (
    <Card className="p-5 flex flex-col min-w-0">
      <CardHeader
        title="Run duration"
        description="Daily p50 and p95 across all workflows"
        actions={
          <>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: P50 }} aria-hidden="true" />p50</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: P95 }} aria-hidden="true" />p95</span>
          </>
        }
      />
      {data.length < 2 ? (
        <p className="mt-6 text-sm text-muted">Not enough completed runs to chart yet.</p>
      ) : (
        <div role="img" aria-label={takeaway} className="mt-4 h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 28, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="label" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={40} />
              <YAxis {...AXIS_PROPS} width={44} tickFormatter={(v: number) => `${Math.round(v)}m`} />
              <Tooltip {...TOOLTIP_PROPS} formatter={(v) => formatDurationShort(Number(v) * 60_000)} />
              <Area type="monotone" dataKey="p95" stroke={P95} strokeWidth={2} fill={P95} fillOpacity={AREA_OPACITY} dot={false} />
              <Area type="monotone" dataKey="p50" stroke={P50} strokeWidth={2} fill={P50} fillOpacity={AREA_OPACITY} dot={false} />
              {peak && (
                <ReferenceDot
                  x={peak.label}
                  y={peak.p95}
                  r={4}
                  fill={P95}
                  stroke="#13171D"
                  strokeWidth={2}
                  label={{
                    value: `${peak.label} · ${formatDurationShort(peak.p95 * 60_000)}`,
                    position: "top",
                    fill: "#EDEAE3",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    offset: 10,
                  }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
