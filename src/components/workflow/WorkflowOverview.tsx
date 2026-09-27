"use client";

/**
 * Workflow detail → Overview (`Workflow` artboard): 6-cell KPI strip,
 * last-40-runs bar chart with a p95 line, job time breakdown (p50 bar +
 * p95 tick) and a recent-runs table. All figures come from the runs and
 * job stats the page already loads; comparisons are against the older half
 * of the loaded runs and say so.
 */

import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { JobStatsResponse, WorkflowRun } from "@/lib/github";
import { cn, formatDurationShort, formatRelative } from "@/lib/utils";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  AXIS_PROPS, GRID_PROPS, TOOLTIP_PROPS, OUTCOME_COLORS, REFERENCE_PROPS, REFERENCE_LABEL_STYLE,
} from "@/components/charts";
import { KpiStrip } from "@/components/ui/KpiStrip";
import { Delta } from "@/components/ui/Delta";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatusPill, runOutcome } from "@/components/ui/StatusPill";

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

function p(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = q * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

interface Stats {
  successRate: number | null;
  avgDuration: number | null;
  p95Queue: number | null;
}

function stats(runs: WorkflowRun[]): Stats {
  const decisive = runs.filter((r) => r.status === "completed" && (r.conclusion === "success" || FAILED.has(r.conclusion ?? "")));
  const ok = decisive.filter((r) => r.conclusion === "success").length;
  return {
    successRate: decisive.length ? (ok / decisive.length) * 100 : null,
    avgDuration: mean(runs.filter((r) => r.status === "completed" && r.duration_ms).map((r) => r.duration_ms!)),
    p95Queue: p(runs.map((r) => r.queue_wait_ms ?? 0).filter((v) => v > 0), 0.95),
  };
}

/** Mean time from the first failure of a streak to the success that ends it. */
export function meanTimeToRecover(runs: WorkflowRun[]): number | null {
  const ordered = runs.filter((r) => r.status === "completed").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const gaps: number[] = [];
  let start: number | null = null;
  for (const r of ordered) {
    if (FAILED.has(r.conclusion ?? "")) start ??= new Date(r.created_at).getTime();
    else if (r.conclusion === "success" && start !== null) {
      gaps.push(new Date(r.updated_at).getTime() - start);
      start = null;
    }
  }
  return mean(gaps);
}

/** Consecutive failures from the newest completed run. */
export function failureStreak(runs: WorkflowRun[]): number {
  let n = 0;
  for (const r of runs) {
    if (r.status !== "completed" || r.conclusion === "cancelled" || r.conclusion === "skipped") continue;
    if (FAILED.has(r.conclusion ?? "")) n++;
    else break;
  }
  return n;
}

export function WorkflowKpiStrip({ runs, loading }: { runs: WorkflowRun[]; loading: boolean }) {
  const k = useMemo(() => {
    const half = Math.floor(runs.length / 2);
    const cur = stats(runs.slice(0, Math.max(half, 1)));
    const prev = half >= 5 ? stats(runs.slice(half)) : null;
    const all = stats(runs);
    const reruns = runs.filter((r) => (r.run_attempt ?? 1) > 1).length;
    const lost = runs.filter((r) => FAILED.has(r.conclusion ?? "")).reduce((s, r) => s + (r.duration_ms ?? 0), 0);
    return { cur, prev, all, half, reruns, lost, mttr: meanTimeToRecover(runs) };
  }, [runs]);

  const vs = `vs previous ${runs.length - k.half} runs`;
  const rateDelta = k.cur.successRate != null && k.prev?.successRate != null ? k.cur.successRate - k.prev.successRate : null;
  const durDelta = k.cur.avgDuration != null && k.prev?.avgDuration != null ? k.cur.avgDuration - k.prev.avgDuration : null;
  const qDelta = k.cur.p95Queue != null && k.prev?.p95Queue != null ? k.cur.p95Queue - k.prev.p95Queue : null;
  const rate = k.all.successRate;

  return (
    <KpiStrip
      cells={[
        {
          key: "rate",
          label: "Success rate",
          loading,
          value: rate != null ? `${rate.toFixed(1)}%` : "—",
          tone: rate == null ? "default" : rate < 80 ? "fail" : rate < 90 ? "warn" : "default",
          foot: rateDelta === null ? `${runs.length} runs loaded` : Math.abs(rateDelta) < 0.5 ? `No change ${vs}` : (
            <Delta direction={rateDelta > 0 ? "up" : "down"} good={rateDelta > 0}>{Math.abs(rateDelta).toFixed(0)} pts {vs}</Delta>
          ),
        },
        {
          key: "dur",
          label: "Avg duration",
          loading,
          value: formatDurationShort(k.all.avgDuration),
          foot: durDelta === null ? "Execution time, queue excluded" : Math.abs(durDelta) < 1000 ? `No change ${vs}` : (
            <Delta direction={durDelta > 0 ? "up" : "down"} good={durDelta < 0}>
              {formatDurationShort(Math.abs(durDelta))} {durDelta > 0 ? "slower" : "faster"}
            </Delta>
          ),
        },
        {
          key: "queue",
          label: "p95 queue wait",
          loading,
          value: formatDurationShort(k.all.p95Queue ?? 0),
          foot: qDelta === null || Math.abs(qDelta) < 1000 ? "No change" : (
            <Delta direction={qDelta > 0 ? "up" : "down"} good={qDelta < 0}>
              {formatDurationShort(Math.abs(qDelta))} {qDelta > 0 ? "longer" : "shorter"}
            </Delta>
          ),
        },
        {
          key: "mttr",
          label: "Time to recover",
          loading,
          value: formatDurationShort(k.mttr),
          foot: k.mttr === null ? "No failures to recover from" : "Mean, failure to next success",
        },
        {
          key: "rerun",
          label: "Re-run rate",
          loading,
          value: runs.length ? `${Math.round((k.reruns / runs.length) * 100)}%` : "—",
          foot: `${k.reruns} of ${runs.length} runs`,
        },
        {
          key: "lost",
          label: "Dev time lost",
          loading,
          value: formatDurationShort(k.lost),
          foot: "in failed runs",
        },
      ]}
    />
  );
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function RunsBarChart({ runs }: { runs: WorkflowRun[] }) {
  const data = useMemo(
    () => runs
      .filter((r) => r.status === "completed" && r.duration_ms)
      .slice(0, 40)
      .reverse()
      .map((r) => ({
        id: r.id,
        label: shortDate(r.created_at),
        run: `#${r.run_number}`,
        minutes: (r.duration_ms ?? 0) / 60_000,
        outcome: r.conclusion === "success" ? "success" : FAILED.has(r.conclusion ?? "") ? "failure" : "cancelled",
      })),
    [runs],
  );
  const p95 = p(data.map((d) => d.minutes), 0.95);
  const failures = data.filter((d) => d.outcome === "failure").length;
  const takeaway = data.length
    ? `Last ${data.length} runs: ${failures} failed; p95 duration ${formatDurationShort((p95 ?? 0) * 60_000)}.`
    : "No completed runs.";
  const legend = [
    { k: "Success", c: OUTCOME_COLORS.success },
    { k: "Failure", c: OUTCOME_COLORS.failure },
    { k: "Cancelled", c: OUTCOME_COLORS.cancelled },
  ];

  return (
    <Card className="p-5">
      <CardHeader
        title={`Last ${data.length || 40} runs`}
        description="Bar height is duration; colour is outcome"
        actions={legend.map((l) => (
          <span key={l.k} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-[2px]" style={{ background: l.c }} aria-hidden="true" />{l.k}
          </span>
        ))}
      />
      {data.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No completed runs yet.</p>
      ) : (
        <div role="img" aria-label={takeaway} className="mt-4 h-[210px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 18, right: 4, bottom: 0, left: -12 }} barCategoryGap={4}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="label" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={60} />
              <YAxis {...AXIS_PROPS} width={40} tickFormatter={(v: number) => `${Math.round(v)}m`} />
              <Tooltip
                {...TOOLTIP_PROPS}
                labelFormatter={(_, pl) => (pl?.[0]?.payload ? `${pl[0].payload.run} · ${pl[0].payload.label}` : "")}
                formatter={(v) => [formatDurationShort(Number(v) * 60_000), "Duration"]}
              />
              {p95 !== null && (
                <ReferenceLine
                  y={p95}
                  {...REFERENCE_PROPS}
                  label={(props: { viewBox?: { x?: number; y?: number; width?: number } }) => {
                    const vb = props.viewBox ?? {};
                    return (
                      <text x={(vb.x ?? 0) + (vb.width ?? 0)} y={(vb.y ?? 0) - 6} textAnchor="end" {...REFERENCE_LABEL_STYLE}>
                        p95 · {formatDurationShort(p95 * 60_000)}
                      </text>
                    );
                  }}
                />
              )}
              <Bar dataKey="minutes" radius={[3, 3, 0, 0]} maxBarSize={28}>
                {data.map((d) => (
                  <Cell key={d.id} fill={OUTCOME_COLORS[d.outcome as keyof typeof OUTCOME_COLORS]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

export function JobTimeBreakdown({ jobStats, loading, disabled }: { jobStats?: JobStatsResponse; loading: boolean; disabled?: boolean }) {
  const jobs = useMemo(() => (jobStats?.jobs ?? []).filter((j) => j.p95_ms > 0).slice(0, 8), [jobStats]);
  const max = Math.max(1, ...jobs.map((j) => j.p95_ms));
  const slowest = jobs.reduce<(typeof jobs)[number] | null>((m, j) => (!m || j.p95_ms > m.p95_ms ? j : m), null);
  const total = jobs.reduce((s, j) => s + j.p95_ms, 0);

  return (
    <Card className="p-5 flex flex-col">
      <CardHeader
        title="Where the time goes"
        actions={
          <>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-[2px] bg-[#2A3444]" aria-hidden="true" />p50</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-0.5 h-3 bg-fg" aria-hidden="true" />p95</span>
          </>
        }
      />
      {disabled ? (
        <p className="mt-4 text-[13px] text-muted">Job timings are part of the Performance feature, which is turned off for you.</p>
      ) : loading ? (
        <div className="mt-4 space-y-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-5 rounded skeleton" />)}</div>
      ) : jobs.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted">No job timings for the loaded runs yet.</p>
      ) : (
        <>
          <ul className="mt-4 space-y-2.5" aria-label="Job durations, p50 and p95">
            {jobs.map((j) => {
              const hot = j === slowest && jobs.length > 1;
              return (
                <li key={j.name} className="grid grid-cols-[minmax(0,130px)_1fr_64px] items-center gap-4">
                  <span className={cn("font-mono text-[13px] truncate", hot ? "text-status-fail-text" : "text-fg")}>{j.name}</span>
                  <span className="relative h-3.5 rounded-[3px] bg-panel" aria-hidden="true">
                    <span
                      className={cn("absolute inset-y-0 left-0 rounded-[3px]", hot ? "bg-[#8A3A42]" : "bg-[#2A3444]")}
                      style={{ width: `${(j.p50_ms / max) * 100}%` }}
                    />
                    <span className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-fg rounded" style={{ left: `calc(${(j.p95_ms / max) * 100}% - 1px)` }} />
                  </span>
                  <span className="font-mono text-[13px] text-fg text-right tabular-nums">
                    {formatDurationShort(j.p95_ms)}
                    <span className="sr-only">p95, p50 {formatDurationShort(j.p50_ms)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {slowest && total > 0 && (
            <p className="mt-4 text-xs text-muted">
              <span className="font-mono">{slowest.name}</span> is {Math.round((slowest.p95_ms / total) * 100)}% of the combined p95 job time.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

type OutcomeFilter = "all" | "success" | "failure" | "cancelled";

export function RecentRunsTable({ runs, now, onViewAll }: { runs: WorkflowRun[]; now: number; onViewAll: () => void }) {
  const [filter, setFilter] = useState<OutcomeFilter>("all");
  const rows = runs
    .filter((r) => {
      if (filter === "all") return true;
      if (filter === "failure") return FAILED.has(r.conclusion ?? "");
      if (filter === "cancelled") return r.conclusion === "cancelled" || r.conclusion === "skipped";
      return r.conclusion === filter;
    })
    .slice(0, 8);
  const th = "h-10 px-3 text-left text-xs font-medium text-faint whitespace-nowrap";

  return (
    <section aria-labelledby="recent-runs" className="card overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 h-16 border-b border-line">
        <h2 id="recent-runs" className="text-[15px] font-semibold text-fg">Recent runs</h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2.5 text-[13px] text-muted">
            Outcome
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as OutcomeFilter)}
              className="w-[140px] h-[34px] pl-2.5 pr-8 rounded-control bg-panel border border-control-strong text-[13px] text-fg focus:outline-none focus:border-brand-fg"
            >
              <option value="all">All</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <button type="button" onClick={onViewAll} className="hidden sm:inline-flex items-center gap-1 text-[13px] font-medium text-link hover:text-violet-200">
            All runs <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <caption className="sr-only">Recent runs</caption>
          <thead className="bg-panel border-b border-line">
            <tr>
              <th className={cn(th, "pl-5")}>Run</th>
              <th className={th}>Outcome</th>
              <th className={th}>Commit</th>
              <th className={cn(th, "hidden md:table-cell")}>Branch</th>
              <th className={cn(th, "hidden lg:table-cell")}>Author</th>
              <th className={th}>Duration</th>
              <th className={cn(th, "pr-5")}>Started</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const o = runOutcome(r.conclusion, r.status);
              const message = (r.head_commit?.message ?? r.display_title ?? "").split("\n")[0];
              return (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-[#161B23]/60">
                  <td className="h-14 pl-5 pr-3 w-[88px]">
                    <a href={r.html_url} target="_blank" rel="noopener noreferrer" className="font-mono text-[13px] font-medium text-link hover:text-violet-200">
                      #{r.run_number}
                    </a>
                  </td>
                  <td className="px-3 w-[128px]"><StatusPill tone={o.tone} pulse={o.live}>{o.label}</StatusPill></td>
                  <td className="px-3 max-w-0 w-full">
                    <span className="flex items-baseline gap-2 min-w-0">
                      <span className="text-[13px] font-medium text-fg truncate">{message || "—"}</span>
                      <span className="font-mono text-xs text-faint shrink-0">{r.head_sha.slice(0, 7)}</span>
                    </span>
                  </td>
                  <td className="px-3 hidden md:table-cell font-mono text-[13px] text-muted whitespace-nowrap max-w-[160px] truncate">{r.head_branch ?? "—"}</td>
                  <td className="px-3 hidden lg:table-cell text-[13px] text-muted whitespace-nowrap">{r.actor?.login ?? "—"}</td>
                  <td className="px-3 font-mono text-[13px] text-fg whitespace-nowrap tabular-nums">{r.status === "completed" ? formatDurationShort(r.duration_ms) : "—"}</td>
                  <td className="px-3 pr-5 text-[13px] text-fg whitespace-nowrap">{formatRelative(r.created_at, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="px-5 py-5 text-sm text-muted">No runs with this outcome.</p>}
    </section>
  );
}
