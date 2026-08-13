"use client";

import { Server, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunnerStatsResponse } from "@/app/api/github/runner-stats/route";

function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${Math.round(ms / 1000)}s`;
}

export default function RunnerUtilization({ data }: { data: RunnerStatsResponse }) {
  if (data.runners.length === 0) {
    return (
      <p className="text-xs text-slate-600 italic py-4 text-center">
        No completed jobs with runner data in the analysed runs.
      </p>
    );
  }

  const maxJobs = Math.max(...data.runners.map((r) => r.job_count));

  return (
    <div className="space-y-3">
      {data.partial && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Computed from {data.fetched_runs}/{data.total_runs} runs — some job data could not be fetched.
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {data.runners.map((r) => {
          const failRate = r.success + r.failure > 0 ? r.failure / (r.success + r.failure) : 0;
          return (
            <div key={r.runner_name} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Server className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <span className="text-sm font-medium text-white truncate">{r.runner_name}</span>
                  {r.runner_group_name && (
                    <span className="text-[10px] font-mono text-slate-500 px-1.5 py-0.5 rounded bg-slate-800 shrink-0">
                      {r.runner_group_name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0">
                  <span>{r.job_count} jobs</span>
                  <span>avg {fmtMs(r.avg_duration_ms)}</span>
                  <span>p95 {fmtMs(r.p95_duration_ms)}</span>
                  {failRate > 0 && (
                    <span className={cn(failRate > 0.2 ? "text-red-400" : "text-amber-400")}>
                      {Math.round(failRate * 100)}% fail
                    </span>
                  )}
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-violet-500"
                  style={{ width: `${Math.max(2, (r.job_count / maxJobs) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-600">
        {data.unique_runners} runner{data.unique_runners === 1 ? "" : "s"} · {data.total_jobs} jobs across {data.fetched_runs} runs
      </p>
    </div>
  );
}
