"use client";

import { use } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { Breadcrumb } from "@/components/Sidebar";
import StatCard from "@/components/StatCard";
import {
  RunHistoryBars,
  TrendSparkline,
  StatusBadge,
  HealthBadge,
} from "@/components/WorkflowMetrics";
import type { OrgOverviewResponse } from "@/app/api/github/org-overview/route";
import {
  Building2,
  GitBranch,
  Activity,
  CheckCircle2,
  ExternalLink,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Main Page ────────────────────────────────────────────────────────────────

export default function OrgDashboardPage({
  params,
}: {
  params: Promise<{ orgName: string }>;
}) {
  const { orgName } = use(params);

  const { data, error, isLoading } = useSWR<OrgOverviewResponse>(
    `/api/github/org-overview?org=${encodeURIComponent(orgName)}`,
    fetcher<OrgOverviewResponse>,
    { revalidateOnFocus: false }
  );

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <Breadcrumb
        items={[
          { label: "Repositories", href: "/" },
          { label: orgName },
        ]}
      />

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
          <Building2 className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{orgName}</h1>
          <p className="text-sm text-slate-400">
            Organization CI/CD overview
          </p>
        </div>
        <a
          href={`https://github.com/${encodeURIComponent(orgName)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-xs text-slate-400 hover:text-violet-400 transition-colors"
        >
          View on GitHub <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                <div className="h-3 w-20 rounded skeleton mb-3" />
                <div className="h-6 w-16 rounded skeleton" />
              </div>
            ))}
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-6">
            <div className="h-4 w-40 rounded skeleton mb-4" />
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 rounded skeleton" />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6">
          <div className="flex items-center gap-2 text-red-400">
            <span className="font-medium">
              {error.message ?? "Failed to load org overview"}
            </span>
          </div>
        </div>
      )}

      {/* Data loaded */}
      {data && !isLoading && (
        <>
          {/* Key metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard
              label="Total Repos"
              value={data.total_repos}
              sub={`in ${data.org}`}
              icon={GitBranch}
              iconColor="text-violet-400"
            />
            <StatCard
              label="Active Repos"
              value={data.active_repos}
              sub="with recent CI activity"
              icon={Activity}
              iconColor="text-blue-400"
            />
            <StatCard
              label="Recent Runs"
              value={data.aggregate.total_runs}
              sub={`across top ${data.repos.length} repos`}
              icon={Activity}
              iconColor="text-green-400"
            />
            <StatCard
              label="Avg Success Rate"
              value={`${data.aggregate.avg_success_rate}%`}
              sub="across active repos"
              icon={CheckCircle2}
              iconColor={
                data.aggregate.avg_success_rate >= 90
                  ? "text-green-400"
                  : data.aggregate.avg_success_rate >= 70
                    ? "text-amber-400"
                    : "text-red-400"
              }
            />
          </div>

          {/* Reliability heatmap (simplified: color-coded grid) */}
          {data.repos.length > 0 && (
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-6 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Reliability Overview
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Success rate heatmap across repos (green &gt; 90%, yellow
                  70-90%, red &lt; 70%)
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.repos.map((r) => {
                  const rate = r.summary.success_rate;
                  const hasRuns = r.summary.recent_runs.length > 0;
                  let bg = "bg-slate-700/50";
                  if (hasRuns) {
                    if (rate >= 90) bg = "bg-emerald-500/70";
                    else if (rate >= 70) bg = "bg-amber-500/70";
                    else bg = "bg-red-500/70";
                  }
                  return (
                    <Link
                      key={r.repo.id}
                      href={`/repos/${r.repo.owner}/${r.repo.name}`}
                      title={`${r.repo.name}: ${hasRuns ? `${rate}% success` : "no runs"}`}
                      className={cn(
                        "w-8 h-8 rounded-md transition-all hover:scale-110 hover:ring-2 hover:ring-white/20",
                        bg
                      )}
                    />
                  );
                })}
              </div>
              <div className="flex items-center gap-4 text-[10px] text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm bg-emerald-500/70" />
                  &gt;90%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm bg-amber-500/70" />
                  70-90%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm bg-red-500/70" />
                  &lt;70%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm bg-slate-700/50" />
                  No runs
                </span>
              </div>
            </div>
          )}

          {/* Repos table */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Top Repositories
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Sorted by most recently updated. Showing top {data.repos.length}{" "}
                of {data.total_repos} repos.
              </p>
            </div>

            {data.repos.length === 0 ? (
              <div className="text-sm text-slate-500 text-center py-8">
                No repositories found for this organization.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/50">
                      <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider py-3 px-4">
                        Repository
                      </th>
                      <th className="text-center text-xs font-medium text-slate-400 uppercase tracking-wider py-3 px-4">
                        Status
                      </th>
                      <th className="text-center text-xs font-medium text-slate-400 uppercase tracking-wider py-3 px-4">
                        Health
                      </th>
                      <th className="text-center text-xs font-medium text-slate-400 uppercase tracking-wider py-3 px-4">
                        History
                      </th>
                      <th className="text-center text-xs font-medium text-slate-400 uppercase tracking-wider py-3 px-4">
                        Trend (30d)
                      </th>
                      <th className="text-right text-xs font-medium text-slate-400 uppercase tracking-wider py-3 px-4">
                        Workflows
                      </th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.repos.map((r) => (
                      <tr
                        key={r.repo.id}
                        className="border-b border-slate-700/30 hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <Link
                            href={`/repos/${r.repo.owner}/${r.repo.name}`}
                            className="group"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm text-white group-hover:text-violet-400 transition-colors">
                                {r.repo.name}
                              </span>
                              {r.repo.private && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-500 border border-slate-600/30">
                                  private
                                </span>
                              )}
                            </div>
                            {r.repo.description && (
                              <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">
                                {r.repo.description}
                              </p>
                            )}
                          </Link>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <StatusBadge summary={r.summary} />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <HealthBadge summary={r.summary} />
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex justify-center">
                            <RunHistoryBars runs={r.summary.recent_runs} />
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex justify-center">
                            <TrendSparkline points={r.summary.trend_30d} />
                          </div>
                        </td>
                        <td className="text-right py-3 px-4 text-slate-400 tabular-nums">
                          {r.workflow_count}
                        </td>
                        <td className="py-3 px-4">
                          <Link
                            href={`/repos/${r.repo.owner}/${r.repo.name}`}
                            className="text-slate-500 hover:text-violet-400 transition-colors"
                          >
                            <ArrowUpRight className="w-4 h-4" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
