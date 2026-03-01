"use client";

import useSWR from "swr";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetcher } from "@/lib/swr";
import type { WorkflowFileCommit } from "@/lib/github";
import { RepoWorkflowBreadcrumb } from "@/components/Sidebar";
import { cn } from "@/lib/utils";
import {
  AlertCircle, ExternalLink, FileCode, GitCommit, User,
  RefreshCw, Shield, Calendar, ArrowLeft,
} from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────────────
function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function getRecentChanges(commits: WorkflowFileCommit[]): WorkflowFileCommit[] {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return commits.filter(c => new Date(c.date).getTime() > oneDayAgo);
}

// ══════════════════════════════════════════════════════════════════════════════
// AUDIT PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function AuditPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();

  // ── Data: workflow file commits ───────────────────────────────────────────
  const {
    data: commits, error: commitsError, isLoading: commitsLoading,
    isValidating: commitsValidating, mutate: mutateCommits,
  } = useSWR<WorkflowFileCommit[]>(
    `/api/github/audit-log?owner=${owner}&repo=${repo}&limit=50`,
    fetcher<WorkflowFileCommit[]>,
  );

  // ── Recent workflow file changes (last 24h) ─────────────────────────────
  const recentChanges = commits ? getRecentChanges(commits) : [];

  const isLoading = commitsLoading;
  const hasError = commitsError;

  return (
    <div className="p-8">
      <RepoWorkflowBreadcrumb owner={owner} repo={repo} workflowName="Audit Trail" />

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <Shield className="w-6 h-6 text-violet-400" />
            <h1 className="text-2xl font-bold text-white">Audit Trail</h1>
          </div>
          <p className="text-sm text-slate-400">
            Workflow file change history and deployment tracking for{" "}
            <span className="font-mono text-slate-300">{owner}/{repo}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/repos/${owner}/${repo}`}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to repo
          </Link>
          <button
            onClick={() => mutateCommits()}
            disabled={commitsValidating}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", commitsValidating && "animate-spin")} />
            Refresh
          </button>
          <a
            href={`https://github.com/${owner}/${repo}/tree/main/.github/workflows`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Workflows on GitHub
          </a>
        </div>
      </div>

      {/* Error */}
      {hasError && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {commitsError?.message ?? "Failed to load audit data"}
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-6">
          {/* Stat cards skeleton */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-4 h-4 rounded skeleton" />
                  <div className="h-3 w-24 rounded skeleton" />
                </div>
                <div className="h-8 w-12 rounded skeleton mb-1" />
                <div className="h-3 w-28 rounded skeleton" />
              </div>
            ))}
          </div>

          {/* Timeline card skeleton */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700/50 space-y-1.5">
              <div className="h-4 w-52 rounded skeleton" />
              <div className="h-3 w-72 rounded skeleton" />
            </div>
            <div className="divide-y divide-slate-700/30">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex items-start gap-4 px-5 py-4">
                  <div className="w-8 h-8 rounded-full skeleton shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="h-4 rounded skeleton" style={{ width: `${55 + (i % 4) * 10}%` }} />
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-20 rounded skeleton" />
                      <div className="h-3 w-1 rounded-full skeleton" />
                      <div className="h-3 w-12 rounded skeleton" />
                      <div className="h-3 w-1 rounded-full skeleton" />
                      <div className="h-5 w-36 rounded skeleton" />
                    </div>
                  </div>
                  <div className="h-6 w-16 rounded-lg skeleton shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Recent changes alert ──────────────────────────────────── */}
          {recentChanges.length > 0 && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-300 mb-0.5">
                  {recentChanges.length} workflow file{recentChanges.length !== 1 ? "s" : ""} modified in the last 24 hours
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {recentChanges.map(c => (
                    <span key={c.sha} className="text-[10px] text-amber-300/70 font-mono">
                      {c.file_path.replace(".github/workflows/", "")} by @{c.author_login ?? "unknown"}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Stat cards ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <FileCode className="w-4 h-4 text-violet-400" />
                <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Total Changes</span>
              </div>
              <p className="text-2xl font-bold text-white tabular-nums">{commits?.length ?? 0}</p>
              <p className="text-xs text-slate-500 mt-0.5">Workflow file commits</p>
            </div>
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <User className="w-4 h-4 text-blue-400" />
                <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Contributors</span>
              </div>
              <p className="text-2xl font-bold text-white tabular-nums">
                {new Set(commits?.map(c => c.author_login).filter(Boolean)).size}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Unique authors</p>
            </div>
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Last 24h</span>
              </div>
              <p className="text-2xl font-bold text-white tabular-nums">{recentChanges.length}</p>
              <p className="text-xs text-slate-500 mt-0.5">Recent changes</p>
            </div>
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <FileCode className="w-4 h-4 text-green-400" />
                <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Files Tracked</span>
              </div>
              <p className="text-2xl font-bold text-white tabular-nums">
                {new Set(commits?.map(c => c.file_path)).size}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Workflow files</p>
            </div>
          </div>

          {/* ── Workflow File Change Timeline ─────────────────────────── */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700/50">
              <h3 className="text-sm font-semibold text-white">Workflow File Change History</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Commits that modified files under <code className="text-slate-400">.github/workflows/</code>
              </p>
            </div>

            {!commits?.length ? (
              <div className="py-16 text-center text-slate-500 text-sm">
                No workflow file changes found.
              </div>
            ) : (
              <div className="divide-y divide-slate-700/30">
                {commits.map((commit) => (
                  <div
                    key={commit.sha}
                    className={cn(
                      "flex items-start gap-4 px-5 py-4 hover:bg-slate-700/20 transition-colors",
                      recentChanges.some(c => c.sha === commit.sha) && "bg-amber-500/5",
                    )}
                  >
                    {/* Avatar */}
                    <div className="shrink-0 mt-0.5">
                      {commit.author_avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={commit.author_avatar}
                          alt={commit.author_login ?? ""}
                          width={32}
                          height={32}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                          <User className="w-4 h-4 text-slate-400" />
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-200 font-medium leading-snug truncate">
                            {commit.message}
                          </p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs text-slate-400">
                              {commit.author_login ? (
                                <span className="font-medium text-slate-300">@{commit.author_login}</span>
                              ) : (
                                <span>{commit.author_name ?? "Unknown"}</span>
                              )}
                            </span>
                            <span className="text-slate-600">·</span>
                            <span className="text-xs text-slate-500 tabular-nums" title={new Date(commit.date).toISOString()}>
                              {timeAgo(commit.date)}
                            </span>
                            <span className="text-slate-600">·</span>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-700/50 text-[10px] text-slate-400 font-mono">
                              <FileCode className="w-3 h-3" />
                              {commit.file_path.replace(".github/workflows/", "")}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <a
                            href={commit.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-white bg-slate-700/40 hover:bg-slate-700 rounded-lg transition-colors font-mono"
                          >
                            <GitCommit className="w-3 h-3" />
                            {commit.sha.slice(0, 7)}
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
