"use client";

/** Four-cell fleet KPI strip for the repositories page (`Main` artboard). */

import { KpiStrip } from "@/components/ui/KpiStrip";
import { Delta } from "@/components/ui/Delta";
import { Sparkline } from "@/components/ui/Sparkline";
import { formatDurationShort } from "@/lib/utils";
import type { FleetKpis, Range } from "@/lib/fleet";

const VS: Record<Range, string> = { "24h": "vs prior 24h", "7d": "vs prior 7d", "30d": "vs prior 30d", "90d": "vs prior 90d" };

function pct(n: number) {
  return `${Math.abs(n) < 10 ? Math.abs(n).toFixed(1) : Math.round(Math.abs(n))}%`;
}

export function FleetKpiStrip({ kpis, range, loading }: { kpis: FleetKpis | null; range: Range; loading: boolean }) {
  const cur = kpis?.current;
  const prev = kpis?.previous;
  const vs = VS[range];

  const runsDelta = cur && prev && prev.runs > 0 ? ((cur.runs - prev.runs) / prev.runs) * 100 : null;
  const rateDelta = cur?.successRate != null && prev?.successRate != null ? cur.successRate - prev.successRate : null;
  const durDelta = cur?.p95DurationMs != null && prev?.p95DurationMs != null ? cur.p95DurationMs - prev.p95DurationMs : null;
  const queueDelta = cur?.p95QueueMs != null && prev?.p95QueueMs != null ? cur.p95QueueMs - prev.p95QueueMs : null;

  const noPrior = (
    <span className="text-faint">
      {kpis?.previousGap === "truncated" ? "Not enough history to compare" : "No earlier runs to compare"}
    </span>
  );
  const flat = <span className="text-muted">No change {vs}</span>;

  return (
    <KpiStrip
      cells={[
        {
          key: "runs",
          label: "Workflow runs",
          loading,
          value: cur ? cur.runs.toLocaleString() : "—",
          foot: runsDelta === null ? noPrior : (
            <Delta direction={runsDelta > 0 ? "up" : runsDelta < 0 ? "down" : "flat"} good={null}>
              {pct(runsDelta)} {vs}
            </Delta>
          ),
          spark: kpis && <Sparkline values={kpis.daily.runs} color="var(--accent)" />,
        },
        {
          key: "success",
          label: "Success rate",
          loading,
          value: cur?.successRate != null ? `${cur.successRate.toFixed(1)}%` : "—",
          foot: rateDelta === null ? noPrior : (
            <Delta direction={rateDelta > 0.05 ? "up" : rateDelta < -0.05 ? "down" : "flat"} good={rateDelta >= 0}>
              {Math.abs(rateDelta).toFixed(1)} pts {vs}
            </Delta>
          ),
          spark: kpis && <Sparkline values={kpis.daily.successRate} color={rateDelta !== null && rateDelta < 0 ? "var(--status-failure)" : "var(--status-success)"} />,
        },
        {
          key: "duration",
          label: "p95 run duration",
          loading,
          value: formatDurationShort(cur?.p95DurationMs),
          foot: durDelta === null ? noPrior : Math.abs(durDelta) < 1000 ? flat : (
            <Delta direction={durDelta > 0 ? "up" : durDelta < 0 ? "down" : "flat"} good={durDelta <= 0}>
              {formatDurationShort(Math.abs(durDelta))} {durDelta > 0 ? "slower" : "faster"}
            </Delta>
          ),
          spark: kpis && <Sparkline values={kpis.daily.p95Duration} color="var(--status-warning)" />,
        },
        {
          key: "queue",
          label: "p95 queue wait",
          loading,
          value: formatDurationShort(cur?.p95QueueMs),
          foot: queueDelta === null ? noPrior : Math.abs(queueDelta) < 1000 ? flat : (
            <Delta direction={queueDelta > 0 ? "up" : queueDelta < 0 ? "down" : "flat"} good={queueDelta <= 0}>
              {formatDurationShort(Math.abs(queueDelta))} {queueDelta > 0 ? "slower" : "faster"}
            </Delta>
          ),
          spark: kpis && <Sparkline values={kpis.daily.p95Queue} color={queueDelta !== null && queueDelta > 0 ? "var(--status-warning)" : "var(--status-success)"} />,
        },
      ]}
    />
  );
}
