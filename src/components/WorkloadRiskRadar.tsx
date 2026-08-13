"use client";

import { Moon, Calendar, GitPullRequest, EyeOff, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkloadRiskEntry, TeamWorkloadRiskResponse } from "@/app/api/github/team-workload-risk/route";

const FLAG_META: Record<keyof WorkloadRiskEntry["flags"], { label: string; icon: React.ElementType }> = {
  after_hours: { label: "After-hours pattern", icon: Moon },
  weekend: { label: "Weekend work", icon: Calendar },
  concurrent_pr_overload: { label: "Juggling many PRs", icon: GitPullRequest },
  activity_cliff: { label: "Went quiet", icon: EyeOff },
};

function RiskRow({ entry }: { entry: WorkloadRiskEntry }) {
  const activeFlags = (Object.keys(entry.flags) as (keyof WorkloadRiskEntry["flags"])[])
    .filter((k) => entry.flags[k]);

  return (
    <div className={cn(
      "rounded-lg border p-3",
      entry.risk_score >= 2 ? "border-amber-500/25 bg-amber-500/5" : "border-slate-800 bg-slate-900/40"
    )}>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {entry.avatar_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={entry.avatar_url} alt={entry.login} width={20} height={20} className="w-5 h-5 rounded-full shrink-0" />
          )}
          <span className="text-sm text-white font-medium truncate">{entry.login}</span>
        </div>
        <span className="text-xs text-slate-500 shrink-0">{entry.total_commits} commits</span>
      </div>

      {activeFlags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {activeFlags.map((key) => {
            const meta = FLAG_META[key];
            const Icon = meta.icon;
            return (
              <span
                key={key}
                className="flex items-center gap-1 text-[10px] font-medium text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20"
              >
                <Icon className="w-2.5 h-2.5" /> {meta.label}
              </span>
            );
          })}
        </div>
      ) : (
        <span className="flex items-center gap-1 text-[10px] text-slate-600">
          <ShieldCheck className="w-2.5 h-2.5" /> No risk signals
        </span>
      )}

      <div className="flex items-center gap-3 text-[10px] text-slate-600 mt-1.5">
        {entry.flags.after_hours && <span>{entry.after_hours_pct}% after-hours</span>}
        {entry.flags.weekend && <span>{entry.weekend_pct}% weekend</span>}
        {entry.flags.concurrent_pr_overload && <span>{entry.open_pr_count} open PRs</span>}
        {entry.flags.activity_cliff && (
          <span>{entry.prior_period_commits} commits, then 0 in the last 2 weeks</span>
        )}
      </div>
    </div>
  );
}

export default function WorkloadRiskRadar({ data }: { data: TeamWorkloadRiskResponse }) {
  if (data.people.length === 0) {
    return (
      <p className="text-xs text-slate-600 italic py-4 text-center">
        No commit activity in the last {data.window_days} days.
      </p>
    );
  }

  const atRisk = data.people.filter((p) => p.risk_score > 0);
  const clear = data.people.filter((p) => p.risk_score === 0);

  return (
    <div className="space-y-3">
      {atRisk.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-2 text-center">
          No workload risk signals detected across {data.people.length} contributors.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {atRisk.map((entry) => (
            <RiskRow key={entry.login} entry={entry} />
          ))}
        </div>
      )}

      {clear.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer hover:text-slate-300 transition-colors">
            {clear.length} contributor{clear.length === 1 ? "" : "s"} with no risk signals
          </summary>
          <div className="flex flex-col gap-2 mt-2">
            {clear.map((entry) => (
              <RiskRow key={entry.login} entry={entry} />
            ))}
          </div>
        </details>
      )}

      <p className="text-[11px] text-slate-600">
        Based on {data.total_commits_analysed} commits over the last {data.window_days} days.
        Heuristic thresholds — a good signal to check in, not a verdict.
      </p>
    </div>
  );
}
