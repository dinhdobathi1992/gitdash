"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { RepoWorkflowBreadcrumb } from "@/components/Sidebar";
import { TeamLeaderboard } from "@/components/TeamLeaderboard";
import { ReviewerLoadMatrix } from "@/components/ReviewerLoadMatrix";
import { BusFactorHeatmap, BusFactorSkeleton } from "@/components/BusFactorHeatmap";
import RunnerUtilization from "@/components/RunnerUtilization";
import ReviewBottleneck from "@/components/ReviewBottleneck";
import WorkloadRiskRadar from "@/components/WorkloadRiskRadar";
import PartialDataBadge from "@/components/PartialDataBadge";
import type { TeamStatsResponse, ContributorStat } from "@/app/api/github/team-stats/route";
import type { RepoContributorsResponse } from "@/app/api/github/repo-contributors/route";
import type { BusFactorResponse } from "@/app/api/github/bus-factor/route";
import type { RunnerStatsResponse } from "@/app/api/github/runner-stats/route";
import type { TeamWorkloadRiskResponse } from "@/app/api/github/team-workload-risk/route";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import {
  AlertCircle,
  AlertTriangle,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  Timer,
  Trophy,
  Shield,
  ArrowLeft,
  ChevronRight,
  GitPullRequest,
  BarChart3,
  Grid3X3,
  FolderTree,
  Server,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "< 1h ago";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Activity heatmap (24 hours × 1 row) ──────────────────────────────────────

function HourHeatmap({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 1);
  return (
    <div className="flex gap-0.5 mt-1">
      {hours.map((count, h) => {
        const intensity = count / max;
        return (
          <div
            key={h}
            title={`${h}:00 UTC — ${count} run${count !== 1 ? "s" : ""}`}
            className="h-3 flex-1 rounded-sm"
            style={{
              backgroundColor: `rgba(124, 58, 237, ${0.1 + intensity * 0.9})`,
            }}
          />
        );
      })}
    </div>
  );
}

// ── Day-of-week bar chart ─────────────────────────────────────────────────────

function DowBars({ dow }: { dow: number[] }) {
  const max = Math.max(...dow, 1);
  return (
    <div className="flex items-end gap-0.5 h-8 mt-1">
      {dow.map((count, d) => {
        const pct = Math.max(4, Math.round((count / max) * 100));
        return (
          <div key={d} className="flex flex-col items-center flex-1 gap-0.5">
            <div
              title={`${DOW_LABELS[d]}: ${count} run${count !== 1 ? "s" : ""}`}
              className="w-full rounded-sm bg-violet-500/60"
              style={{ height: `${pct}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Contributor card ──────────────────────────────────────────────────────────

function ContributorCard({
  c,
  rank,
  isTopContributor,
  isMostReliable,
}: {
  c: ContributorStat;
  rank: number;
  isTopContributor: boolean;
  isMostReliable: boolean;
}) {
  const successRateColor =
    c.success_rate >= 95
      ? "text-green-400"
      : c.success_rate >= 80
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={c.avatar_url}
            alt={c.login}
            className="w-10 h-10 rounded-full border border-slate-600"
          />
          <span className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-[10px] font-bold text-slate-400">
            {rank}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <a
              href={`https://github.com/${c.login}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-white hover:text-violet-300 transition-colors"
            >
              @{c.login}
            </a>
            {isTopContributor && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <Trophy className="w-2.5 h-2.5" /> Top contributor
              </span>
            )}
            {isMostReliable && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-500/10 border border-green-500/20 text-green-400">
                <Shield className="w-2.5 h-2.5" /> Most reliable
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Last active {fmtRelative(c.last_run_at)}
          </p>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Runs</p>
          <p className="text-base font-bold text-white">{c.total_runs}</p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Success</p>
          <p className={cn("text-base font-bold", successRateColor)}>{c.success_rate}%</p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Avg dur</p>
          <p className="text-base font-bold text-white">{fmtDuration(c.avg_duration_ms)}</p>
        </div>
      </div>

      {/* Success / Failure bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <CheckCircle className="w-3 h-3 text-green-400" /> {c.success} success
          </span>
          <span className="flex items-center gap-1">
            <XCircle className="w-3 h-3 text-red-400" /> {c.failure} failure
          </span>
        </div>
        <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden flex">
          <div
            className="h-full bg-green-500 rounded-l-full"
            style={{ width: `${c.success_rate}%` }}
          />
          <div
            className="h-full bg-red-500 rounded-r-full"
            style={{ width: `${100 - c.success_rate}%` }}
          />
        </div>
      </div>

      {/* Avg queue wait */}
      {c.avg_queue_wait_ms > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <Clock className="w-3 h-3 shrink-0 text-slate-500" />
          <span>
            Avg queue wait:{" "}
            <span className="text-white font-medium">
              {fmtDuration(c.avg_queue_wait_ms)}
            </span>
          </span>
        </div>
      )}

      {/* Activity by hour */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
          Runs by hour (UTC)
        </p>
        <HourHeatmap hours={c.activity_by_hour} />
        <div className="flex justify-between text-[9px] text-slate-600 mt-0.5">
          <span>00:00</span>
          <span>12:00</span>
          <span>23:00</span>
        </div>
      </div>

      {/* Activity by day of week */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
          Runs by day
        </p>
        <DowBars dow={c.activity_by_dow} />
        <div className="flex mt-0.5">
          {DOW_LABELS.map((d) => (
            <span key={d} className="flex-1 text-center text-[9px] text-slate-600">
              {d}
            </span>
          ))}
        </div>
      </div>

      {/* Busiest hour */}
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        <Timer className="w-3 h-3 shrink-0 text-slate-500" />
        <span>
          Peak activity:{" "}
          <span className="text-white font-medium">
            {c.busiest_hour}:00–{c.busiest_hour + 1}:00 UTC
          </span>
        </span>
      </div>
    </div>
  );
}

// ── Summary row ───────────────────────────────────────────────────────────────

function SummaryBar({ data }: { data: TeamStatsResponse }) {
  const overallSuccess = data.contributors.reduce((s, c) => s + c.success, 0);
  const overallTotal = data.contributors.reduce((s, c) => s + c.total_runs, 0);
  const overallRate = overallTotal > 0 ? Math.round((overallSuccess / overallTotal) * 100) : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-4 h-4 text-violet-400" />
          <span className="text-xs text-slate-400">Contributors</span>
        </div>
        <p className="text-2xl font-bold text-white">{data.contributors.length}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          in last {data.period_days} day{data.period_days !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle className="w-4 h-4 text-green-400" />
          <span className="text-xs text-slate-400">Team Success Rate</span>
        </div>
        <p
          className={cn(
            "text-2xl font-bold",
            overallRate >= 95
              ? "text-green-400"
              : overallRate >= 80
                ? "text-amber-400"
                : "text-red-400"
          )}
        >
          {overallRate}%
        </p>
        <p className="text-xs text-slate-500 mt-0.5">{overallTotal} total runs</p>
      </div>
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <Trophy className="w-4 h-4 text-amber-400" />
          <span className="text-xs text-slate-400">Top Contributor</span>
        </div>
        <p className="text-sm font-bold text-white truncate">
          {data.top_contributor ? `@${data.top_contributor}` : "—"}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          {data.contributors[0]?.total_runs ?? 0} runs
        </p>
      </div>
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4 text-green-400" />
          <span className="text-xs text-slate-400">Most Reliable</span>
        </div>
        <p className="text-sm font-bold text-white truncate">
          {data.most_reliable ? `@${data.most_reliable}` : "—"}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          {data.contributors.find((c) => c.login === data.most_reliable)?.success_rate ?? "—"}%
          success
        </p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TeamAnalyticsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { flags } = useFeatureFlags();
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);
  const [showBusFactor, setShowBusFactor] = useState(false);
  const [showRunners, setShowRunners] = useState(false);
  const [showBottleneck, setShowBottleneck] = useState(false);
  const [showWorkloadRisk, setShowWorkloadRisk] = useState(false);

  const { data, error, isLoading } = useSWR<TeamStatsResponse>(
    `/api/github/team-stats?owner=${owner}&repo=${repo}&per_page=100`,
    fetcher<TeamStatsResponse>,
  );

  const { data: contribData, isLoading: contribLoading } = useSWR<RepoContributorsResponse>(
    `/api/github/repo-contributors?owner=${owner}&repo=${repo}`,
    fetcher<RepoContributorsResponse>,
  );

  // Bus factor — skipped when feature disabled
  const { data: busData, isLoading: busLoading } = useSWR<BusFactorResponse>(
    flags.busFactor ? `/api/github/bus-factor?owner=${owner}&repo=${repo}` : null,
    fetcher<BusFactorResponse>,
  );

  // Runner utilization — skipped when feature disabled
  const { data: runnerData, isLoading: runnerLoading } = useSWR<RunnerStatsResponse>(
    flags.runnerUtilization ? `/api/github/runner-stats?owner=${owner}&repo=${repo}` : null,
    fetcher<RunnerStatsResponse>,
  );

  // Workload risk radar — skipped when feature disabled
  const { data: workloadData, isLoading: workloadLoading } = useSWR<TeamWorkloadRiskResponse>(
    flags.workloadRisk ? `/api/github/team-workload-risk?owner=${owner}&repo=${repo}` : null,
    fetcher<TeamWorkloadRiskResponse>,
  );

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <RepoWorkflowBreadcrumb owner={owner} repo={repo} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Team Analytics</h1>
          <p className="text-sm text-slate-400">
            Contributor activity, success rates, and workflow patterns for{" "}
            <span className="font-mono text-slate-300">
              {owner}/{repo}
            </span>
          </p>
        </div>
        <Link
          href={`/repos/${owner}/${repo}`}
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to repo
        </Link>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                <div className="h-3 w-20 rounded skeleton mb-3" />
                <div className="h-6 w-12 rounded skeleton" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full skeleton" />
                  <div className="space-y-1.5">
                    <div className="h-3 w-24 rounded skeleton" />
                    <div className="h-2.5 w-16 rounded skeleton" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="bg-slate-900/50 rounded-lg p-2.5">
                      <div className="h-2 w-8 rounded skeleton mx-auto mb-1.5" />
                      <div className="h-5 w-10 rounded skeleton mx-auto" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">
              {error.message ?? "Failed to load team analytics"}
            </span>
          </div>
        </div>
      )}

      {/* Empty */}
      {data && !isLoading && data.contributors.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <Users className="w-10 h-10 text-slate-600" />
          <p className="text-slate-400 text-sm">
            No completed workflow runs found for this repository.
          </p>
        </div>
      )}

      {/* Data */}
      {data && !isLoading && data.contributors.length > 0 && (
        <>
          <SummaryBar data={data} />

          {/* ── Phase 2: PR Leaderboard ──────────────────────────────────────── */}
          {contribData && contribData.contributors.length > 0 && (
            <div className="space-y-4">
              {contribData.partial && (
                <PartialDataBadge fetched={contribData.fetched_prs} total={contribData.total_prs_attempted} unit="PRs" />
              )}
              {/* Bus factor badge */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50">
                  <GitPullRequest className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-xs text-slate-400">
                    <span className="text-white font-medium">{contribData.total_prs_analysed}</span> PRs analysed
                  </span>
                </div>
                <div className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border",
                  contribData.bus_factor <= 1
                    ? "bg-red-500/10 border-red-500/20"
                    : contribData.bus_factor <= 2
                      ? "bg-amber-500/10 border-amber-500/20"
                      : "bg-green-500/10 border-green-500/20"
                )}>
                  <Shield className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs text-slate-400">
                    Bus factor:{" "}
                    <span className={cn(
                      "font-medium",
                      contribData.bus_factor <= 1
                        ? "text-red-400"
                        : contribData.bus_factor <= 2
                          ? "text-amber-400"
                          : "text-green-400"
                    )}>
                      {contribData.bus_factor}
                    </span>
                  </span>
                </div>
              </div>

              {/* Leaderboard toggle */}
              <div>
                <button
                  onClick={() => setShowLeaderboard((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-violet-300 transition-colors"
                >
                  <ChevronRight
                    className={cn("w-3.5 h-3.5 transition-transform", showLeaderboard && "rotate-90")}
                  />
                  <BarChart3 className="w-3.5 h-3.5" />
                  {showLeaderboard ? "Hide" : "Show"} PR Leaderboard ({contribData.contributors.length} contributors)
                </button>
                {showLeaderboard && (
                  <div className="mt-3">
                    <TeamLeaderboard
                      contributors={contribData.contributors}
                      owner={owner}
                      repo={repo}
                    />
                  </div>
                )}
              </div>

              {/* Reviewer matrix toggle */}
              {contribData.reviewer_matrix.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowMatrix((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-violet-300 transition-colors"
                  >
                    <ChevronRight
                      className={cn("w-3.5 h-3.5 transition-transform", showMatrix && "rotate-90")}
                    />
                    <Grid3X3 className="w-3.5 h-3.5" />
                    {showMatrix ? "Hide" : "Show"} Reviewer Load Matrix
                  </button>
                  {showMatrix && (
                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                      <h3 className="text-sm font-semibold text-white mb-0.5">Reviewer Load Matrix</h3>
                      <p className="text-xs text-slate-500 mb-4">Who reviews whose PRs — rows are PR authors, columns are reviewers</p>
                      <ReviewerLoadMatrix matrix={contribData.reviewer_matrix} />
                    </div>
                  )}
                </div>
              )}

              {/* Review Bottleneck toggle */}
              {flags.reviewBottleneck ? (
                <div>
                  <button
                    onClick={() => setShowBottleneck((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-violet-300 transition-colors"
                  >
                    <ChevronRight
                      className={cn("w-3.5 h-3.5 transition-transform", showBottleneck && "rotate-90")}
                    />
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {showBottleneck ? "Hide" : "Show"} Review Bottleneck
                  </button>
                  {showBottleneck && (
                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                      <h3 className="text-sm font-semibold text-white mb-0.5">Review Bottleneck</h3>
                      <p className="text-xs text-slate-500 mb-4">Overloaded reviewers and single-point-of-failure review dependencies</p>
                      <ReviewBottleneck contributors={contribData.contributors} matrix={contribData.reviewer_matrix} />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-800 bg-slate-900/30 text-xs text-slate-500">
                  <span>Review Bottleneck is disabled —</span>
                  <a href="/settings" className="text-violet-400 hover:underline">Enable in Settings → Feature Flags</a>
                </div>
              )}

              {/* Workload Risk Radar toggle */}
              {flags.workloadRisk ? (
                <div>
                  <button
                    onClick={() => setShowWorkloadRisk((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-violet-300 transition-colors"
                  >
                    <ChevronRight
                      className={cn("w-3.5 h-3.5 transition-transform", showWorkloadRisk && "rotate-90")}
                    />
                    <Moon className="w-3.5 h-3.5" />
                    {showWorkloadRisk ? "Hide" : "Show"} Workload Risk Radar
                  </button>
                  {showWorkloadRisk && (
                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                      <h3 className="text-sm font-semibold text-white mb-0.5">Workload Risk Radar</h3>
                      <p className="text-xs text-slate-500 mb-4">
                        Sustained after-hours/weekend work, activity cliffs, and concurrent-PR overload —
                        a signal to check in, not a verdict.
                      </p>
                      {workloadLoading && <BusFactorSkeleton />}
                      {workloadData && <WorkloadRiskRadar data={workloadData} />}
                      {!workloadLoading && !workloadData && (
                        <p className="text-xs text-slate-600 italic py-4 text-center">
                          Failed to load workload risk data.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-800 bg-slate-900/30 text-xs text-slate-500">
                  <span>Workload Risk Radar is disabled —</span>
                  <a href="/settings" className="text-violet-400 hover:underline">Enable in Settings → Feature Flags</a>
                </div>
              )}
            </div>
          )}

          {contribLoading && (
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-5">
              <div className="h-4 w-40 rounded skeleton mb-2" />
              <div className="h-3 w-56 rounded skeleton mb-4" />
              <div className="h-48 rounded skeleton" />
            </div>
          )}

          {/* ── Phase 4: Bus Factor Heatmap ─────────────────────────────────── */}
          <div>
            {flags.busFactor ? (
              <>
                <button
                  onClick={() => setShowBusFactor((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-violet-300 transition-colors"
                >
                  <ChevronRight
                    className={cn("w-3.5 h-3.5 transition-transform", showBusFactor && "rotate-90")}
                  />
                  <FolderTree className="w-3.5 h-3.5" />
                  {showBusFactor ? "Hide" : "Show"} Knowledge & Bus Factor Map
                </button>
                {showBusFactor && (
                  <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                    <h3 className="text-sm font-semibold text-white mb-0.5">Knowledge & Bus Factor Map</h3>
                    <p className="text-xs text-slate-500 mb-4">
                      Per-module contributor concentration — modules with bus factor = 1 are knowledge silos
                    </p>
                    {busLoading && <BusFactorSkeleton />}
                    {busData && <BusFactorHeatmap data={busData} />}
                    {!busLoading && !busData && (
                      <p className="text-xs text-slate-600 italic py-4 text-center">
                        Failed to load bus factor data.
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-800 bg-slate-900/30 text-xs text-slate-500">
                <span>Bus Factor Analysis is disabled —</span>
                <a href="/settings" className="text-violet-400 hover:underline">Enable in Settings → Feature Flags</a>
              </div>
            )}
          </div>

          {/* ── Runner Utilization ──────────────────────────────────────────── */}
          <div>
            {flags.runnerUtilization ? (
              <>
                <button
                  onClick={() => setShowRunners((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-violet-300 transition-colors"
                >
                  <ChevronRight
                    className={cn("w-3.5 h-3.5 transition-transform", showRunners && "rotate-90")}
                  />
                  <Server className="w-3.5 h-3.5" />
                  {showRunners ? "Hide" : "Show"} Runner Utilization
                </button>
                {showRunners && (
                  <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                    <h3 className="text-sm font-semibold text-white mb-0.5">Runner Utilization</h3>
                    <p className="text-xs text-slate-500 mb-4">
                      Job counts, durations, and failure rates per runner across recent completed runs
                    </p>
                    {runnerLoading && <BusFactorSkeleton />}
                    {runnerData && <RunnerUtilization data={runnerData} />}
                    {!runnerLoading && !runnerData && (
                      <p className="text-xs text-slate-600 italic py-4 text-center">
                        Failed to load runner statistics.
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-800 bg-slate-900/30 text-xs text-slate-500">
                <span>Runner Utilization is disabled —</span>
                <a href="/settings" className="text-violet-400 hover:underline">Enable in Settings → Feature Flags</a>
              </div>
            )}
          </div>

          {/* ── CI Contributors (original) ──────────────────────────────────── */}
          <div>
            <h2 className="text-sm font-semibold text-white mb-1">
              CI Contributors ({data.contributors.length})
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Based on {data.total_runs} completed runs over the last{" "}
              {data.period_days} day{data.period_days !== 1 ? "s" : ""}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.contributors.map((c, i) => (
                <ContributorCard
                  key={c.login}
                  c={c}
                  rank={i + 1}
                  isTopContributor={c.login === data.top_contributor}
                  isMostReliable={c.login === data.most_reliable}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
