"use client";

import { GitPullRequest, Clock, Eye, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ContributorKpiData {
  prs_merged: number;
  avg_hours_to_merge: number;
  reviews_given: number;
  pr_merge_rate: number;
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center border shrink-0",
            color === "violet" && "bg-violet-500/10 border-violet-500/20",
            color === "blue" && "bg-blue-500/10 border-blue-500/20",
            color === "cyan" && "bg-cyan-500/10 border-cyan-500/20",
            color === "green" && "bg-green-500/10 border-green-500/20",
          )}
        >
          <Icon
            className={cn(
              "w-3.5 h-3.5",
              color === "violet" && "text-violet-400",
              color === "blue" && "text-blue-400",
              color === "cyan" && "text-cyan-400",
              color === "green" && "text-green-400",
            )}
          />
        </div>
        <p className="text-xs font-semibold text-slate-300 leading-tight">{label}</p>
      </div>
      <div>
        <p className="text-2xl font-bold text-white font-mono leading-none">{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export function ContributorKpiCards({ data }: { data: ContributorKpiData }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        label="PRs Merged"
        value={data.prs_merged}
        sub="Last 90 days"
        icon={GitPullRequest}
        color="violet"
      />
      <KpiCard
        label="Avg Lead Time"
        value={fmtHours(data.avg_hours_to_merge)}
        sub="Created to merged"
        icon={Clock}
        color="blue"
      />
      <KpiCard
        label="Reviews Given"
        value={data.reviews_given}
        sub="Cross-team contribution"
        icon={Eye}
        color="cyan"
      />
      <KpiCard
        label="Merge Rate"
        value={`${data.pr_merge_rate}%`}
        sub="PRs merged vs total opened"
        icon={CheckCircle}
        color="green"
      />
    </div>
  );
}

export function ContributorKpiSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-4 flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg skeleton" />
            <div className="h-3 w-24 rounded skeleton" />
          </div>
          <div>
            <div className="h-7 w-16 rounded skeleton mb-1.5" />
            <div className="h-2.5 w-20 rounded skeleton" />
          </div>
        </div>
      ))}
    </div>
  );
}
