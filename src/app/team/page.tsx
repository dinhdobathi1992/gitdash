"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/swr";
import { Breadcrumb } from "@/components/Sidebar";
import { TeamLeaderboard } from "@/components/TeamLeaderboard";
import { RepoPicker } from "@/components/RepoPicker";
import type { RepoContributorsResponse } from "@/app/api/github/repo-contributors/route";
import {
  Users, AlertCircle, GitPullRequest, Eye, GitMerge,
  ShieldAlert, Info, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Reviewer load matrix ──────────────────────────────────────────────────────
function ReviewerMatrix({
  matrix,
  owner,
}: {
  matrix: RepoContributorsResponse["reviewer_matrix"];
  owner: string;
}) {
  const authors = [...new Set(matrix.map((c) => c.author))].sort();
  const reviewers = [...new Set(matrix.map((c) => c.reviewer))].sort();

  if (authors.length === 0) {
    return (
      <p className="text-sm text-slate-600 italic text-center py-8">
        No cross-review data found in the analysed PRs
      </p>
    );
  }

  const lookup: Record<string, number> = {};
  for (const cell of matrix) lookup[`${cell.author}|${cell.reviewer}`] = cell.count;
  const maxCount = Math.max(...matrix.map((c) => c.count), 1);

  return (
    <div className="overflow-x-auto">
      <table className="text-[10px] border-collapse">
        <thead>
          <tr>
            {/* top-left corner */}
            <th className="w-24 pb-2 pr-2 text-right text-slate-600 font-normal align-bottom">
              author ↓ · reviewer →
            </th>
            {reviewers.map((r) => (
              <th
                key={r}
                className="pb-2 px-1 text-center font-medium text-slate-400 whitespace-nowrap"
                style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 60 }}
              >
                <Link
                  href={`/contributor/${r}?owner=${owner}`}
                  className="hover:text-violet-300 transition-colors"
                >
                  {r}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {authors.map((a) => (
            <tr key={a}>
              <td className="pr-3 py-1 text-right text-slate-400 font-medium whitespace-nowrap">
                <Link
                  href={`/contributor/${a}?owner=${owner}`}
                  className="hover:text-violet-300 transition-colors"
                >
                  {a}
                </Link>
              </td>
              {reviewers.map((r) => {
                const count = lookup[`${a}|${r}`] ?? 0;
                const intensity = count / maxCount;
                return (
                  <td key={r} className="p-1 text-center">
                    <div
                      className="w-7 h-7 rounded flex items-center justify-center text-[10px] font-mono mx-auto transition-colors"
                      style={{
                        backgroundColor:
                          count > 0
                            ? `rgba(124, 58, 237, ${0.15 + intensity * 0.7})`
                            : "transparent",
                        color: count > 0 ? "#e2e8f0" : "#334155",
                        border: count > 0 ? "1px solid rgba(124,58,237,0.3)" : "1px solid #1e293b",
                      }}
                      title={count > 0 ? `${a} authored, ${r} reviewed: ${count} PR${count !== 1 ? "s" : ""}` : ""}
                    >
                      {count > 0 ? count : ""}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Summary stat chips ────────────────────────────────────────────────────────
function StatChip({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs",
        highlight
          ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
          : "bg-slate-800/60 border-slate-700/50 text-slate-400",
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{label}:</span>
      <span className={cn("font-semibold", highlight ? "text-amber-200" : "text-white")}>
        {value}
      </span>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function PageSkeleton() {
  return (
    <div className="space-y-4 mt-4">
      <div className="flex gap-3 flex-wrap">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 w-36 rounded-lg skeleton" />
        ))}
      </div>
      <div className="rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="h-10 w-full skeleton rounded-none" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4 p-4 border-t border-slate-800">
            <div className="w-6 h-6 rounded-full skeleton" />
            <div className="h-4 w-32 rounded skeleton" />
            {Array.from({ length: 6 }).map((_, j) => (
              <div key={j} className="h-4 w-16 rounded skeleton ml-auto" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function TeamInsightsPage() {
  // RepoPicker stores "owner/repo" as a single string
  const [repoFullName, setRepoFullName] = useState("");
  const [showMatrix, setShowMatrix] = useState(false);

  const [repoOwner, repoName] = repoFullName.split("/");
  const selectedRepo = repoOwner && repoName ? { owner: repoOwner, repo: repoName } : null;

  const apiUrl = selectedRepo
    ? `/api/github/repo-contributors?owner=${selectedRepo.owner}&repo=${selectedRepo.repo}`
    : null;

  const { data, error, isLoading } = useSWR<RepoContributorsResponse>(
    apiUrl,
    fetcher<RepoContributorsResponse>,
  );

  const totalMerged = data?.contributors.reduce((s, c) => s + c.prs_merged, 0) ?? 0;
  const totalReviews = data?.contributors.reduce((s, c) => s + c.reviews_given, 0) ?? 0;
  const selfMerges = data?.contributors.reduce((s, c) => s + c.self_merge_count, 0) ?? 0;

  return (
    <div className="p-8">
      <Breadcrumb items={[{ label: "Team Insights" }]} />

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-violet-400" />
            Team Insights
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Per-contributor delivery metrics, reviewer load, and team health — select a
            repository to begin.
          </p>
        </div>
      </div>

      {/* Repo selector */}
      <div className="mb-6">
        <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">
          Select repository
        </p>
        <RepoPicker
          value={repoFullName}
          onChange={setRepoFullName}
          className="max-w-sm"
        />
      </div>

      {/* No repo selected */}
      {!selectedRepo && (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <Users className="w-10 h-10 text-slate-700" />
          <p className="text-slate-500 text-sm">
            Choose a repository above to see contributor metrics and team performance.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm mb-4">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error.message ?? "Failed to load contributor data"}
        </div>
      )}

      {/* Loading */}
      {isLoading && <PageSkeleton />}

      {/* Data */}
      {data && selectedRepo && !isLoading && (
        <div className="space-y-6">
          {/* Summary chips */}
          <div className="flex items-center gap-3 flex-wrap">
            <StatChip
              icon={GitMerge}
              label="PRs analysed"
              value={data.total_prs_analysed}
            />
            <StatChip
              icon={GitPullRequest}
              label="PRs merged"
              value={totalMerged}
            />
            <StatChip
              icon={Eye}
              label="Reviews given"
              value={totalReviews}
            />
            <StatChip
              icon={ShieldAlert}
              label="Bus factor"
              value={data.bus_factor}
              highlight={data.bus_factor <= 2}
            />
            {selfMerges > 0 && (
              <StatChip
                icon={AlertCircle}
                label="Self-merges"
                value={selfMerges}
                highlight={selfMerges > 0}
              />
            )}
            <div className="flex items-center gap-1.5 text-[10px] text-slate-600 ml-auto">
              <Info className="w-3 h-3" />
              Last {data.period_days}d · {data.contributors.length} contributors
            </div>
          </div>

          {data.contributors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center rounded-xl border border-slate-800">
              <GitPullRequest className="w-8 h-8 text-slate-700" />
              <p className="text-slate-500 text-sm">
                No merged PRs found for{" "}
                <span className="font-mono text-slate-400">
                  {selectedRepo.owner}/{selectedRepo.repo}
                </span>
              </p>
            </div>
          ) : (
            <>
              {/* Leaderboard */}
              <div>
                <h2 className="text-sm font-semibold text-white mb-1">
                  Contributor Leaderboard
                </h2>
                <p className="text-xs text-slate-500 mb-3">
                  Click any column header to sort · Click a contributor name to see their
                  full profile
                </p>
                <TeamLeaderboard
                  contributors={data.contributors}
                  owner={selectedRepo.owner}
                  repo={selectedRepo.repo}
                />
              </div>

              {/* Reviewer load matrix (collapsible) */}
              <div>
                <button
                  onClick={() => setShowMatrix((v) => !v)}
                  className="flex items-center gap-2 text-sm font-semibold text-white mb-1 hover:text-violet-300 transition-colors"
                >
                  {showMatrix ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                  Reviewer Load Matrix
                </button>
                <p className="text-xs text-slate-500 mb-3">
                  How many PRs each reviewer has reviewed per author — identifies review
                  bottlenecks
                </p>
                {showMatrix && (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                    <ReviewerMatrix
                      matrix={data.reviewer_matrix}
                      owner={selectedRepo.owner}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
