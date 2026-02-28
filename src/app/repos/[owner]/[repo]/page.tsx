"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import useSWR from "swr";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { fetcher } from "@/lib/swr";
import { WorkflowOverview } from "@/lib/github";
import { RepoWorkflowBreadcrumb } from "@/components/Sidebar";
import { RunHistoryBars, TrendSparkline, StatusBadge, HealthBadge } from "@/components/WorkflowMetrics";
import {
  AlertCircle, ExternalLink, GitBranch, FileCode, RefreshCw,
  Search, X, ChevronRight, Zap,
} from "lucide-react";
import { cn, fuzzyMatch, highlightSegments } from "@/lib/utils";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

// ── Colour palette for up to 10 workflow lines ────────────────────────────────
const LINE_COLORS = [
  "#7c3aed", "#2563eb", "#0891b2", "#059669",
  "#d97706", "#dc2626", "#db2777", "#0d9488",
  "#4f46e5", "#6366f1",
];

// ── Highlighted text ──────────────────────────────────────────────────────────
function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  const segments = highlightSegments(text, indices);
  return (
    <>
      {segments.map((seg, i) =>
        seg.highlight
          ? <mark key={i} className="bg-transparent text-violet-300 font-semibold">{seg.text}</mark>
          : <span key={i}>{seg.text}</span>
      )}
    </>
  );
}

// ── Duration chart (multi-workflow lines) ─────────────────────────────────────
function DurationChart({ workflows }: { workflows: WorkflowOverview[] }) {
  // Build a unified dataset bucketed by calendar day (YYYY-MM-DD).
  // Multiple runs on the same day are averaged per workflow so lines connect
  // across days even when workflows don't fire at the exact same instant.
  const withData = workflows.filter((wf) => wf.dur_points.length > 0);

  if (withData.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-600 text-sm italic">
        No completed runs to display
      </div>
    );
  }

  // Collect all days across all workflows, sorted
  const allDays = Array.from(
    new Set(withData.flatMap((wf) => wf.dur_points.map((p) => p.created_at.slice(0, 10))))
  ).sort();

  // Build chart data: each row = one calendar day, value = avg duration in min
  const data = allDays.map((day) => {
    const row: Record<string, string | number> = {
      time: new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
    for (const wf of withData) {
      const pts = wf.dur_points.filter((p) => p.created_at.startsWith(day));
      if (pts.length > 0) {
        const avg = pts.reduce((sum, p) => sum + p.duration_ms, 0) / pts.length;
        row[wf.name] = Math.round(avg / 60000 * 100) / 100;
      }
    }
    return row;
  });

  // Only show last 30 days for legibility
  const sliced = data.slice(-30);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={sliced} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="time"
          tick={{ fill: "#64748b", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "#64748b", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          unit="m"
          width={32}
        />
        <Tooltip
          contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#94a3b8", marginBottom: 4 }}
          formatter={(val: number | undefined) => val !== undefined ? [`${val} min`, ""] : ["—", ""]}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, color: "#94a3b8", paddingTop: 8 }}
        />
        {withData.map((wf, i) => (
          <Line
            key={wf.id}
            type="monotone"
            dataKey={wf.name}
            stroke={LINE_COLORS[i % LINE_COLORS.length]}
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Workflow table row ────────────────────────────────────────────────────────
function WorkflowRow({
  owner, repo, wf, nameIndices, active,
}: {
  owner: string;
  repo: string;
  wf: WorkflowOverview;
  nameIndices: number[];
  active: boolean;
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <tr
      ref={ref}
      className={cn(
        "group border-b border-slate-800 hover:bg-slate-800/50 transition-colors",
        active && "bg-slate-800/60 ring-1 ring-inset ring-violet-500/30"
      )}
    >
      {/* Workflow name + path */}
      <td className="py-3.5 pl-5 pr-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
            <Zap className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <div className="min-w-0">
            <Link
              href={`/repos/${owner}/${repo}/workflows/${wf.id}`}
              className="text-sm font-semibold text-white hover:text-violet-300 transition-colors truncate block"
            >
              <Highlighted text={wf.name} indices={nameIndices} />
            </Link>
            <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5 truncate">
              <FileCode className="w-3 h-3 shrink-0" />
              {wf.path}
            </p>
          </div>
        </div>
      </td>

      {/* Status */}
      <td className="py-3.5 px-4 w-36">
        <StatusBadge summary={wf.summary} />
      </td>

      {/* Health */}
      <td className="py-3.5 px-4 w-36">
        <HealthBadge summary={wf.summary} />
      </td>

      {/* Run History (10) */}
      <td className="py-3.5 px-4 w-48">
        <RunHistoryBars runs={wf.summary.recent_runs} />
      </td>

      {/* Trend (30d) */}
      <td className="py-3.5 px-4 w-36">
        <TrendSparkline points={wf.summary.trend_30d} />
      </td>

      {/* Arrow */}
      <td className="py-3.5 pr-5 w-10 text-right">
        <Link
          href={`/repos/${owner}/${repo}/workflows/${wf.id}`}
          className="inline-flex text-slate-600 group-hover:text-slate-300 transition-colors"
          aria-label={`Open ${wf.name}`}
        >
          <ChevronRight className="w-4 h-4" />
        </Link>
      </td>
    </tr>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="space-y-6">
      {/* Chart skeleton */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="h-4 w-40 bg-slate-800 rounded animate-pulse mb-1.5" />
        <div className="h-3 w-56 bg-slate-800/60 rounded animate-pulse mb-5" />
        <div className="h-48 bg-slate-800/40 rounded animate-pulse" />
      </div>
      {/* Table skeleton */}
      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/60">
              {["Workflow", "Status", "Health", "Run History (10)", "Trend (30d)", ""].map((h, i) => (
                <th key={i} className="py-2.5 px-4 text-left text-xs font-medium text-slate-400 tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 3 }).map((_, i) => (
              <tr key={i} className="border-b border-slate-800">
                <td className="py-4 pl-5 pr-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-slate-800 animate-pulse" />
                    <div>
                      <div className="h-4 w-32 bg-slate-800 rounded animate-pulse mb-1.5" />
                      <div className="h-3 w-48 bg-slate-800/60 rounded animate-pulse" />
                    </div>
                  </div>
                </td>
                <td className="py-4 px-4"><div className="h-5 w-16 bg-slate-800 rounded-full animate-pulse" /></td>
                <td className="py-4 px-4"><div className="h-5 w-12 bg-slate-800 rounded animate-pulse" /></td>
                <td className="py-4 px-4">
                  <div className="flex items-end gap-0.5 h-6">
                    {Array.from({ length: 10 }).map((_, j) => (
                      <div key={j} className="w-2.5 h-full bg-slate-800 rounded-sm animate-pulse" />
                    ))}
                  </div>
                </td>
                <td className="py-4 px-4"><div className="h-8 w-28 bg-slate-800 rounded animate-pulse" /></td>
                <td className="py-4 pr-5" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function RepoDetailPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const router = useRouter();

  const {
    data: overview, error, isLoading, isValidating, mutate,
  } = useSWR<WorkflowOverview[]>(
    `/api/github/repo-overview?owner=${owner}&repo=${repo}`,
    fetcher<WorkflowOverview[]>
  );

  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);

  // Fuzzy filter
  type Match = { wf: WorkflowOverview; nameIndices: number[] };
  const filtered = useMemo<Match[]>(() => {
    if (!overview) return [];
    const q = search.trim();
    return overview.flatMap((wf) => {
      if (!q) return [{ wf, nameIndices: [] }];
      const nameResult = fuzzyMatch(wf.name, q);
      const pathResult = fuzzyMatch(wf.path, q);
      if (nameResult.match) return [{ wf, nameIndices: nameResult.indices }];
      if (pathResult.match) return [{ wf, nameIndices: [] }];
      return [];
    });
  }, [overview, search]);

  const clampedActiveIndex = Math.min(activeIndex, filtered.length - 1);

  // "/" shortcut
  const handleGlobalKey = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [handleGlobalKey]);

  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (search) { setSearch(""); setActiveIndex(-1); }
      else searchRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && clampedActiveIndex >= 0) {
      const hit = filtered[clampedActiveIndex];
      if (hit) router.push(`/repos/${owner}/${repo}/workflows/${hit.wf.id}`);
    }
  }

  const totalWorkflows = overview?.length ?? 0;

  return (
    <div className="p-8">
      <RepoWorkflowBreadcrumb owner={owner} repo={repo} />

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white font-mono">{owner}/{repo}</h1>
          <p className="text-sm text-slate-400 mt-1">
            {isLoading
              ? "Loading workflows..."
              : search
                ? `${filtered.length} of ${totalWorkflows} workflows`
                : `${totalWorkflows} workflow${totalWorkflows !== 1 ? "s" : ""} found`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isValidating && "animate-spin")} />
            Refresh
          </button>
          <a
            href={`https://github.com/${owner}/${repo}/actions`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" /> View on GitHub
          </a>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error.message ?? "Failed to load workflows"}
        </div>
      )}

      {isLoading ? (
        <Skeleton />
      ) : totalWorkflows === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <GitBranch className="w-10 h-10 text-slate-600" />
          <p className="text-slate-400 text-sm">No GitHub Actions workflows found in this repository.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Duration chart */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            <h2 className="text-sm font-semibold text-white mb-0.5">Duration Trend</h2>
            <p className="text-xs text-slate-500 mb-4">Run time per workflow (minutes) — last 30 runs each</p>
            <DurationChart workflows={overview ?? []} />
          </div>

          {/* Search — only when >1 workflow */}
          {totalWorkflows > 1 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search workflows… (press / to focus)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKey}
                className="w-full pl-9 pr-9 py-2.5 bg-slate-800/60 border border-slate-700/50 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/50"
              />
              {search && (
                <button
                  onClick={() => { setSearch(""); searchRef.current?.focus(); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Workflow table */}
          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/60">
                  <th className="py-2.5 pl-5 pr-4 text-left text-xs font-medium text-slate-400 tracking-wide">
                    Workflow
                  </th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400 tracking-wide w-36">
                    Status
                  </th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400 tracking-wide w-36">
                    Health
                  </th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400 tracking-wide w-48">
                    Run History (10)
                  </th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400 tracking-wide w-36">
                    Trend (30d)
                  </th>
                  <th className="py-2.5 pr-5 w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-slate-500 text-sm">
                      {search ? (
                        <span>
                          No workflows match &ldquo;{search}&rdquo;{" "}
                          <button onClick={() => setSearch("")} className="text-violet-400 hover:text-violet-300 ml-1">
                            Clear
                          </button>
                        </span>
                      ) : "No workflows found."}
                    </td>
                  </tr>
                ) : (
                  filtered.map(({ wf, nameIndices }, i) => (
                    <WorkflowRow
                      key={wf.id}
                      owner={owner}
                      repo={repo}
                      wf={wf}
                      nameIndices={nameIndices}
                      active={i === clampedActiveIndex}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
