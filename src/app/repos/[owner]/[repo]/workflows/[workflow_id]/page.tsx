"use client";

import { useMemo, useState, useRef, useEffect, Suspense } from "react";
import React from "react";
import useSWR from "swr";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { fetcher } from "@/lib/swr";
import { WorkflowRun, WorkflowJob, JobStatsResponse } from "@/lib/github";
import { RepoWorkflowBreadcrumb } from "@/components/Sidebar";
import StatCard from "@/components/StatCard";
import { ConclusionBadge } from "@/components/Badge";
import { formatDuration, cn } from "@/lib/utils";
import { format, getHours, getDay } from "date-fns";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
  ReferenceLine,
} from "recharts";
import {
  CheckCircle, Clock, Activity, Calendar, GitCommit, User,
  ExternalLink, AlertCircle, RefreshCw, Timer, Zap, TrendingUp,
  TrendingDown, GitPullRequest, RotateCcw, Shield, Cpu, FlameKindling,
  ChevronDown, Download, ArrowUpDown,
} from "lucide-react";

// ── colour palette ────────────────────────────────────────────────────────────
const OUTCOME_COLORS: Record<string, string> = {
  success: "#4ade80", failure: "#f87171", cancelled: "#facc15",
  skipped: "#94a3b8", timed_out: "#fb923c",
};
const JOB_PALETTE = [
  "#7c3aed","#2563eb","#0891b2","#059669","#d97706","#dc2626","#db2777","#7c3aed",
];

// ── math helpers ─────────────────────────────────────────────────────────────
function pct(arr: number[], p: number) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  // Linear interpolation avoids conflating p95 with p100 on small samples.
  const idx = p * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}
function avg(arr: number[]) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// ── shared tooltip ────────────────────────────────────────────────────────────
function ChartTip({
  active, payload, label, unit = "",
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      {label && <p className="text-slate-400 mb-1.5">{label}</p>}
        {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }} className="leading-5">
          {p.name}: <strong>
            {unit === "m"
              ? `${p.value} min`
              : unit === "s"
              ? formatDuration(p.value * 1000)
              : `${p.value}${unit}`}
          </strong>
        </p>
      ))}
    </div>
  );
}

// ── tab types ────────────────────────────────────────────────────────────────
type Tab = "overview" | "performance" | "reliability" | "triggers" | "runs";

// Statuses that mean a run is still active — module-level so it is allocated once.
const ACTIVE_RUN_STATUSES = new Set(["in_progress", "queued", "waiting", "requested", "pending"]);

// Day-of-week labels (Sun=0…Sat=6) — module-level so useMemo deps are stable.
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview",     label: "Overview",     icon: Activity },
  { id: "performance",  label: "Performance",  icon: Cpu },
  { id: "reliability",  label: "Reliability",  icon: Shield },
  { id: "triggers",     label: "Triggers",     icon: Zap },
  { id: "runs",         label: "Runs",         icon: GitCommit },
];

// ── sortable table header ─────────────────────────────────────────────────────
type SortDir = "asc" | "desc";

function SortTh({
  col, label, current, dir, onClick,
}: {
  col: string; label: string; current: string; dir: SortDir; onClick: () => void;
}) {
  const active = current === col;
  return (
    <th
      className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-white transition-colors"
      onClick={onClick}
    >
      <span className="flex items-center gap-1">
        {label}
        {active
          ? dir === "asc"
            ? <ChevronDown className="w-3 h-3 rotate-180 text-violet-400" />
            : <ChevronDown className="w-3 h-3 text-violet-400" />
          : <ArrowUpDown className="w-3 h-3 opacity-30" />}
      </span>
    </th>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Main page — wrapped in Suspense because WorkflowContent uses useSearchParams
// ══════════════════════════════════════════════════════════════════════════════
export default function WorkflowDetailPage() {
  return (
    <Suspense fallback={<div className="p-8 animate-pulse text-slate-500 text-sm">Loading…</div>}>
      <WorkflowContent />
    </Suspense>
  );
}

function WorkflowContent() {
  const { owner, repo, workflow_id } = useParams<{
    owner: string; repo: string; workflow_id: string;
  }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Active tab is stored in the URL (?tab=overview) so it survives refresh / link sharing.
  const rawTab = searchParams.get("tab") as Tab | null;
  const VALID_TABS: Tab[] = ["overview", "performance", "reliability", "triggers", "runs"];
  const tab: Tab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : "overview";
  function setTab(t: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", t);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  // perPage is stored in the URL (?n=50) so it survives refresh / sharing
  const perPage = Math.max(10, Math.min(100, parseInt(searchParams.get("n") ?? "50")));
  function setPerPage(n: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("n", String(n));
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  // ── runs ─────────────────────────────────────────────────────────────────
  // Poll every 30 s when any run is still active so the UI stays live.
  const hasInProgress = (runs: WorkflowRun[] | undefined) =>
    runs?.some(r => r.status != null && ACTIVE_RUN_STATUSES.has(r.status)) ?? false;

  const {
    data: runs, error: runsError, isLoading: runsLoading,
    isValidating: runsValidating, mutate: mutateRuns,
  } = useSWR<WorkflowRun[]>(
    `/api/github/runs?owner=${owner}&repo=${repo}&workflow_id=${workflow_id}&per_page=${perPage}`,
    fetcher<WorkflowRun[]>,
    {
      refreshInterval: (data) => hasInProgress(data) ? 30_000 : 0,
    }
  );

  // ── job stats (only fetched when Performance tab is active) ──────────────
  const jobStatsKey = tab === "performance"
    ? `/api/github/job-stats?owner=${owner}&repo=${repo}&workflow_id=${workflow_id}&per_page=${Math.min(perPage, 30)}`
    : null;
  const {
    data: jobStats, isLoading: jobStatsLoading, error: jobStatsError,
  } = useSWR<JobStatsResponse>(jobStatsKey, fetcher<JobStatsResponse>);

  // ── browser notifications for new failures ────────────────────────────────
  const prevRunIds = useRef<Set<number>>(new Set());
  const notifPerm = useRef<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    // Read current permission without prompting — requestPermission() requires
    // a user gesture in modern browsers and is auto-denied on page load.
    notifPerm.current = Notification.permission;
  }, []);

  useEffect(() => {
    if (!runs || runs.length === 0) return;
    const prev = prevRunIds.current;
    if (prev.size > 0 && notifPerm.current === "granted") {
      const newFailures = runs.filter(r => !prev.has(r.id) && r.conclusion === "failure");
      newFailures.forEach(r => {
        new Notification(`Workflow failed: ${r.name ?? workflow_id}`, {
          body: `Run #${r.run_number} on ${r.head_branch ?? "unknown"} failed`,
          icon: "/favicon.ico",
          tag: `gitdash-fail-${r.id}`,
        });
      });
    }
    prevRunIds.current = new Set(runs.map(r => r.id));
  }, [runs, workflow_id]);

  const workflowName = runs?.[0]?.name ?? `Workflow #${workflow_id}`;

  // ── derived ───────────────────────────────────────────────────────────────
  const safeRuns = useMemo(() => runs ?? [], [runs]);
  const completed = useMemo(() => safeRuns.filter(r => r.status === "completed"), [safeRuns]);
  const successCount = completed.filter(r => r.conclusion === "success").length;
  const failureCount = completed.filter(r => r.conclusion === "failure").length;
  const successRate = completed.length ? Math.round(successCount / completed.length * 100) : 0;

  const durations = completed.map(r => r.duration_ms ?? 0).filter(Boolean);
  const avgDuration   = durations.length ? Math.round(avg(durations)) : undefined;
  const p95Duration   = durations.length ? pct(durations, 0.95) : undefined;
  const queues        = safeRuns.map(r => r.queue_wait_ms ?? 0).filter(Boolean);
  const avgQueue      = queues.length ? Math.round(avg(queues)) : undefined;

  return (
    <div className="p-8">
      <RepoWorkflowBreadcrumb owner={owner} repo={repo} workflowName={workflowName} />

      {/* ── header ── */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-2xl font-bold text-white">{workflowName}</h1>
            {hasInProgress(runs) && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                Live
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400">Last {perPage} runs · {completed.length} completed</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={perPage}
            onChange={e => setPerPage(Number(e.target.value))}
            className="text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          >
            {[20, 50, 100].map(n => <option key={n} value={n}>Last {n} runs</option>)}
          </select>
          <button
            onClick={() => mutateRuns()}
            disabled={runsValidating}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", runsValidating && "animate-spin")} />
            Refresh
          </button>
          <a
            href={`https://github.com/${owner}/${repo}/actions/workflows/${workflow_id}`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" /> GitHub
          </a>
        </div>
      </div>

      {runsError && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {runsError.message ?? "Failed to load runs"}
        </div>
      )}

      {/* ── top stat cards (always visible) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Success Rate" value={runsLoading ? "—" : `${successRate}%`}
          sub={`${successCount} of ${completed.length} completed`}
          icon={CheckCircle} iconColor="text-green-400" />
        <StatCard label="Avg Duration" value={runsLoading ? "—" : formatDuration(avgDuration)}
          sub={`p95: ${formatDuration(p95Duration)}`}
          icon={Clock} iconColor="text-violet-400" />
        <StatCard label="Avg Queue Wait" value={runsLoading ? "—" : formatDuration(avgQueue)}
          sub="Time before first step"
          icon={Timer} iconColor="text-amber-400" />
        <StatCard label="Total Runs" value={runsLoading ? "—" : safeRuns.length}
          sub={`${failureCount} failed`}
          icon={Activity} iconColor="text-blue-400" />
      </div>

      {/* ── tabs ── */}
      <div
        role="tablist"
        aria-label="Workflow metrics tabs"
        className="flex gap-1 mb-6 p-1 bg-slate-800/60 border border-slate-700/50 rounded-xl w-fit"
      >
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              tab === t.id
                ? "bg-slate-700 text-white shadow-sm"
                : "text-slate-400 hover:text-white hover:bg-slate-700/50"
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── tab bodies ── */}
      {runsLoading ? <LoadingSkeleton /> : (
        <>
          {/* All tabs are always mounted — display:none keeps charts alive so
              Recharts never re-measures on switch, making tabs instant. */}
          <div role="tabpanel" id="tabpanel-overview"     aria-labelledby="tab-overview"     hidden={tab !== "overview"}><OverviewTab    runs={safeRuns} completed={completed} /></div>
          <div role="tabpanel" id="tabpanel-performance"  aria-labelledby="tab-performance"  hidden={tab !== "performance"}><PerformanceTab jobStats={jobStats} loading={jobStatsLoading} error={jobStatsError} analysedCount={Math.min(perPage, 30)} requestedCount={perPage} /></div>
          <div role="tabpanel" id="tabpanel-reliability"  aria-labelledby="tab-reliability"  hidden={tab !== "reliability"}><ReliabilityTab runs={safeRuns} completed={completed} /></div>
          <div role="tabpanel" id="tabpanel-triggers"     aria-labelledby="tab-triggers"     hidden={tab !== "triggers"}><TriggersTab    runs={safeRuns} /></div>
          <div role="tabpanel" id="tabpanel-runs"         aria-labelledby="tab-runs"         hidden={tab !== "runs"}><RunsTab        runs={safeRuns} owner={owner} repo={repo} onRefresh={() => mutateRuns()} isRefreshing={runsValidating} /></div>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ══════════════════════════════════════════════════════════════════════════════
function OverviewTab({ runs, completed }: { runs: WorkflowRun[]; completed: WorkflowRun[] }) {
  // rolling 7-run success rate
  const rollingRate = useMemo(() => {
    const window = 7;
    return runs
      .slice()
      .reverse()
      .map((_, i, arr) => {
        const slice = arr.slice(Math.max(0, i - window + 1), i + 1).filter(r => r.status === "completed");
        const ok = slice.filter(r => r.conclusion === "success").length;
        return {
          run: `#${arr[i].run_number}`,
          rate: slice.length ? Math.round(ok / slice.length * 100) : null,
        };
      });
  }, [runs]);

  // duration over time — values in minutes (2 decimal places)
  const durTrend = useMemo(() => runs
    .filter(r => r.duration_ms !== undefined)
    .slice().reverse()
    .map(r => ({
      run: `#${r.run_number}`,
      duration: Math.round((r.duration_ms ?? 0) / 60000 * 100) / 100,
      queue:    Math.round((r.queue_wait_ms ?? 0) / 60000 * 100) / 100,
    })), [runs]);

  // outcome breakdown
  const breakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    completed.forEach(r => { const k = r.conclusion ?? "unknown"; counts[k] = (counts[k] ?? 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value, color: OUTCOME_COLORS[name] ?? "#94a3b8" }));
  }, [completed]);

  // frequency
  const freqData = useMemo(() => {
    const counts: Record<string, number> = {};
    runs.forEach(r => { const d = format(new Date(r.created_at), "MMM d"); counts[d] = (counts[d] ?? 0) + 1; });
    return Object.entries(counts).map(([date, count]) => ({ date, count })).slice(-14);
  }, [runs]);

  return (
    <div className="space-y-6">
      {/* rolling success + duration */}
      <div className="grid lg:grid-cols-2 gap-6">
        <ChartCard title="Rolling Success Rate" sub="7-run sliding window">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={rollingRate}>
              <defs>
                <linearGradient id="rateGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#4ade80" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="run" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip content={<ChartTip unit="%" />} />
              <ReferenceLine y={80} stroke="#f87171" strokeDasharray="4 4" strokeOpacity={0.5} />
              <Area type="monotone" dataKey="rate" name="Success rate" stroke="#4ade80" fill="url(#rateGrad)" strokeWidth={2} dot={false} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Duration Trend" sub="Run time vs queue wait (minutes)">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={durTrend}>
              <defs>
                <linearGradient id="durGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#7c3aed" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="queueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="run" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} unit="m" />
              <Tooltip content={<ChartTip unit="m" />} />
              <Area type="monotone" dataKey="duration" name="Run time"   stroke="#7c3aed" fill="url(#durGrad)"   strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="queue"    name="Queue wait" stroke="#f59e0b" fill="url(#queueGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* outcome + frequency */}
      <div className="grid lg:grid-cols-3 gap-6">
        <ChartCard title="Outcome Breakdown">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={breakdown} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={3} dataKey="value">
                {breakdown.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px", fontSize: "12px" }} />
              <Legend formatter={v => <span className="text-xs text-slate-300 capitalize">{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="lg:col-span-2">
          <ChartCard title="Run Frequency" sub="Runs per day (last 14 days)">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={freqData} barSize={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTip unit=" runs" />} />
                <Bar dataKey="count" name="Runs" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE TAB
// ══════════════════════════════════════════════════════════════════════════════
function PerformanceTab({ jobStats, loading, error, analysedCount, requestedCount }: { jobStats: JobStatsResponse | undefined; loading: boolean; error?: Error; analysedCount: number; requestedCount: number }) {
  if (loading) return <LoadingSkeleton />;
  if (error) return <EmptyState icon={Cpu} message={`Failed to load job stats: ${error.message}`} />;
  if (!jobStats) return <EmptyState icon={Cpu} message="No job-level data available yet." />;

  const { jobs, steps, waterfall } = jobStats;

  // sorted slowest jobs
  const sortedJobs = [...jobs].sort((a, b) => b.avg_ms - a.avg_ms);

  // top 10 slowest steps across all jobs
  const sortedSteps = [...steps].sort((a, b) => b.avg_ms - a.avg_ms).slice(0, 10);

  // stacked bar waterfall: each run = one bar, segments = jobs
  const allJobNames = [...new Set(waterfall.flatMap(r => r.jobs.map(j => j.name)))];

  const waterfallData = waterfall.map(r => {
    const row: Record<string, number | string> = { run: `#${r.run_number}` };
    allJobNames.forEach(name => {
      const j = r.jobs.find(j => j.name === name);
      row[name] = j ? Math.round(j.duration_ms / 60000 * 100) / 100 : 0;
    });
    return row;
  });

  return (
    <div className="space-y-6">
      {/* Cap notice — shown when fewer runs are analysed than the user has selected */}
      {analysedCount < requestedCount && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Performance data is based on the last <strong>{analysedCount}</strong> runs (capped from {requestedCount} to limit GitHub API usage).
        </div>
      )}
      {/* job avg/p95 */}
      <ChartCard title="Job Duration" sub="Average vs p95 (minutes)">
        <ResponsiveContainer width="100%" height={Math.max(180, sortedJobs.length * 44)}>
          <BarChart data={sortedJobs.map(j => ({
            name: j.name.length > 28 ? j.name.slice(0, 26) + "…" : j.name,
            avg: Math.round(j.avg_ms / 60000 * 100) / 100,
            p95: Math.round(j.p95_ms / 60000 * 100) / 100,
          }))} layout="vertical" barSize={12} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
            <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} unit="m" />
            <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={180} />
            <Tooltip content={<ChartTip unit="m" />} />
            <Legend formatter={v => <span className="text-xs text-slate-300">{v}</span>} />
            <Bar dataKey="avg" name="Avg"  fill="#7c3aed" radius={[0, 4, 4, 0]} />
            <Bar dataKey="p95" name="p95"  fill="#2563eb" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* stacked waterfall */}
      {waterfallData.length > 0 && (
        <ChartCard title="Job Composition per Run" sub="Stacked duration per run (minutes) — last 20 runs">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={waterfallData} barSize={14}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="run" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} unit="m" />
              <Tooltip content={<ChartTip unit="m" />} />
              <Legend formatter={v => <span className="text-xs text-slate-300">{v}</span>} />
              {allJobNames.map((name, i) => (
                <Bar key={name} dataKey={name} stackId="a" fill={JOB_PALETTE[i % JOB_PALETTE.length]} radius={i === allJobNames.length - 1 ? [4, 4, 0, 0] : undefined} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* slowest steps table */}
      <ChartCard title="Slowest Steps" sub="Top 10 by average runtime across all jobs">
        <div className="overflow-x-auto">
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="border-b border-slate-700/50">
                {["Step", "Job", "Runs", "Avg", "p95", "Max", "Success %"].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {sortedSteps.map((s) => (
                <tr key={`${s.job}::${s.step}`} className="hover:bg-slate-700/20 transition-colors">
                  <td className="px-3 py-2.5 text-slate-200 text-xs font-medium max-w-[200px] truncate">{s.step}</td>
                  <td className="px-3 py-2.5 text-slate-400 text-xs truncate max-w-[140px]">{s.job}</td>
                  <td className="px-3 py-2.5 text-slate-400 text-xs tabular-nums">{s.runs}</td>
                  <td className="px-3 py-2.5 text-violet-300 text-xs tabular-nums font-medium">{formatDuration(s.avg_ms)}</td>
                  <td className="px-3 py-2.5 text-blue-300  text-xs tabular-nums">{formatDuration(s.p95_ms)}</td>
                  <td className="px-3 py-2.5 text-slate-300 text-xs tabular-nums">{formatDuration(s.max_ms)}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums">
                    <SuccessPip value={s.runs ? Math.round(s.success / s.runs * 100) : 0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// RELIABILITY TAB
// ══════════════════════════════════════════════════════════════════════════════
function ReliabilityTab({ runs, completed }: { runs: WorkflowRun[]; completed: WorkflowRun[] }) {
  // MTTR: mean time from a failure to the next success on same branch
  const mttr = useMemo(() => {
    const byBranch: Record<string, WorkflowRun[]> = {};
    completed.forEach(r => {
      const b = r.head_branch ?? "unknown";
      (byBranch[b] ??= []).push(r);
    });
    const recoveries: number[] = [];
    Object.values(byBranch).forEach(branchRuns => {
      const sorted = [...branchRuns].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      let failAt: number | null = null;
      sorted.forEach(r => {
        if (r.conclusion === "failure" && failAt === null) failAt = new Date(r.created_at).getTime();
        if (r.conclusion === "success" && failAt !== null) {
          recoveries.push(new Date(r.created_at).getTime() - failAt);
          failAt = null;
        }
      });
    });
    return recoveries.length ? Math.round(avg(recoveries)) : null;
  }, [completed]);

  // Flakiness score: % of branches that oscillate success↔failure
  const flakyBranches = useMemo(() => {
    const byBranch: Record<string, string[]> = {};
    completed.forEach(r => {
      const b = r.head_branch ?? "unknown";
      (byBranch[b] ??= []).push(r.conclusion ?? "unknown");
    });
    return Object.entries(byBranch)
      .filter(([, concs]) => {
        let flips = 0;
        for (let i = 1; i < concs.length; i++) {
          if (concs[i] !== concs[i - 1]) flips++;
        }
        return flips >= 2;
      })
      .map(([branch]) => branch);
  }, [completed]);

  // Longest current failure streak
  const failureStreak = useMemo(() => {
    let streak = 0;
    for (const r of runs) {
      if (r.conclusion === "failure") streak++;
      else if (r.status === "completed") break;
    }
    return streak;
  }, [runs]);

  // Success/failure timeline for sparkline
  const timeline = useMemo(() =>
    [...completed].reverse().map((r, i) => ({
      i,
      v: r.conclusion === "success" ? 1 : r.conclusion === "failure" ? -1 : 0,
      run: `#${r.run_number}`,
      conclusion: r.conclusion,
    }))
  , [completed]);

  // Re-run rate (run_attempt > 1)
  const rerunRate = useMemo(() => {
    const reran = runs.filter(r => (r.run_attempt ?? 1) > 1).length;
    return runs.length ? Math.round(reran / runs.length * 100) : 0;
  }, [runs]);

  return (
    <div className="space-y-6">
      {/* reliability stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="MTTR" value={mttr !== null ? formatDuration(mttr) : "—"}
          sub="Mean time to recovery" icon={TrendingUp} iconColor="text-green-400" />
        <StatCard label="Failure Streak" value={failureStreak}
          sub={failureStreak > 0 ? "Consecutive failures" : "No active streak"}
          icon={FlameKindling} iconColor={failureStreak >= 3 ? "text-red-400" : "text-slate-400"} />
        <StatCard label="Flaky Branches" value={flakyBranches.length}
          sub="Branches with flip-flop results" icon={TrendingDown} iconColor="text-amber-400" />
        <StatCard label="Re-run Rate" value={`${rerunRate}%`}
          sub="Runs with attempt > 1" icon={RotateCcw} iconColor="text-blue-400" />
      </div>

      {/* success/failure timeline */}
      <ChartCard title="Pass / Fail Timeline" sub="1 = success · -1 = failure — ordered oldest → newest">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={timeline} barSize={6}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="run" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis domain={[-1, 1]} ticks={[-1, 0, 1]} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-slate-400">{d.run}</p>
                    <ConclusionBadge conclusion={d.conclusion} />
                  </div>
                );
              }}
            />
            <ReferenceLine y={0} stroke="#334155" />
            <Bar dataKey="v" name="Result" radius={[2, 2, 0, 0]}
              fill="#4ade80"
            >
              {timeline.map((entry, i) => (
                <Cell key={i} fill={entry.v === 1 ? "#4ade80" : entry.v === -1 ? "#f87171" : "#94a3b8"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* flaky branches */}
      {flakyBranches.length > 0 && (
        <ChartCard title="Flaky Branches" sub="Branches that oscillated between success and failure">
          <div className="flex flex-wrap gap-2 mt-2">
            {flakyBranches.map(b => (
              <span key={b} className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 font-mono">
                {b}
              </span>
            ))}
          </div>
        </ChartCard>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TRIGGERS TAB
// ══════════════════════════════════════════════════════════════════════════════
function TriggersTab({ runs }: { runs: WorkflowRun[] }) {
  // event breakdown
  const eventBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    runs.forEach(r => { counts[r.event] = (counts[r.event] ?? 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [runs]);

  // actor leaderboard
  const actorLeaderboard = useMemo(() => {
    const counts: Record<string, { count: number; avatar: string; success: number }> = {};
    runs.forEach(r => {
      const login = r.triggering_actor?.login ?? r.actor?.login ?? "unknown";
      const avatar = r.triggering_actor?.avatar_url ?? r.actor?.avatar_url ?? "";
      if (!counts[login]) counts[login] = { count: 0, avatar, success: 0 };
      counts[login].count++;
      if (r.conclusion === "success") counts[login].success++;
    });
    return Object.entries(counts)
      .map(([login, d]) => ({ login, ...d, rate: d.count ? Math.round(d.success / d.count * 100) : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [runs]);

  // hour-of-day distribution (0–23)
  const hourData = useMemo(() => {
    const h = Array.from({ length: 24 }, (_, i) => ({ hour: `${i}:00`, count: 0 }));
    runs.forEach(r => { h[getHours(new Date(r.created_at))].count++; });
    return h;
  }, [runs]);

  // day-of-week distribution (Sun=0…Sat=6)
  const dayData = useMemo(() => {
    const d = DAY_NAMES.map(name => ({ day: name, count: 0 }));
    runs.forEach(r => { d[getDay(new Date(r.created_at))].count++; });
    return d;
  }, [runs]);

  // branch leaderboard
  const branchLeaderboard = useMemo(() => {
    const counts: Record<string, number> = {};
    runs.forEach(r => { const b = r.head_branch ?? "unknown"; counts[b] = (counts[b] ?? 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([branch, count]) => ({ branch, count }));
  }, [runs]);

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-3 gap-6">
        {/* event breakdown */}
        <ChartCard title="Trigger Events">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={eventBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={76} paddingAngle={3} dataKey="value">
                {eventBreakdown.map((_, i) => <Cell key={i} fill={JOB_PALETTE[i % JOB_PALETTE.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px", fontSize: "12px" }} />
              <Legend formatter={v => <span className="text-xs text-slate-300 capitalize">{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* branch leaderboard */}
        <div className="lg:col-span-2">
          <ChartCard title="Top Branches" sub="Branches with most runs">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={branchLeaderboard} layout="vertical" barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="branch" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={120} />
                <Tooltip content={<ChartTip unit=" runs" />} />
                <Bar dataKey="count" name="Runs" fill="#7c3aed" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>

      {/* hour + day heatbars */}
      <div className="grid lg:grid-cols-2 gap-6">
        <ChartCard title="Hour of Day" sub="When runs are triggered (UTC)">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={hourData} barSize={10}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="hour" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} interval={3} />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTip unit=" runs" />} />
              <Bar dataKey="count" name="Runs" fill="#0891b2" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Day of Week" sub="When runs are triggered">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={dayData} barSize={24}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTip unit=" runs" />} />
              <Bar dataKey="count" name="Runs" fill="#059669" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* actor leaderboard */}
      <ChartCard title="Actor Leaderboard" sub="Who triggers the most runs">
        <div className="overflow-x-auto">
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="border-b border-slate-700/50">
                {["#", "Actor", "Runs", "Success %"].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {actorLeaderboard.map((a, i) => (
                <tr key={a.login} className="hover:bg-slate-700/20 transition-colors">
                  <td className="px-3 py-2.5 text-slate-500 text-xs tabular-nums w-8">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2 text-slate-200 text-xs">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.avatar} alt={a.login} width={20} height={20} className="w-5 h-5 rounded-full" />
                      {a.login}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-300 text-xs tabular-nums font-medium">{a.count}</td>
                  <td className="px-3 py-2.5 text-xs">
                    <SuccessPip value={a.rate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// RUNS TAB — sortable columns, CSV export, expandable job/step rows
// ══════════════════════════════════════════════════════════════════════════════
type SortCol = "run" | "status" | "branch" | "trigger" | "actor" | "duration" | "queue" | "started";

function RunsTab({ runs, owner, repo, onRefresh, isRefreshing }: { runs: WorkflowRun[]; owner: string; repo: string; onRefresh: () => void; isRefreshing: boolean }) {
  const [sortCol, setSortCol] = useState<SortCol>("run");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
  }

  function toggleExpanded(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      let va: string | number = 0;
      let vb: string | number = 0;
      switch (sortCol) {
        case "run":      va = a.run_number;                                 vb = b.run_number; break;
        case "status":   va = a.conclusion ?? a.status ?? "";               vb = b.conclusion ?? b.status ?? ""; break;
        case "branch":   va = a.head_branch ?? "";                          vb = b.head_branch ?? ""; break;
        case "trigger":  va = a.event;                                      vb = b.event; break;
        case "actor":    va = a.actor?.login ?? "";                         vb = b.actor?.login ?? ""; break;
        case "duration": va = a.duration_ms ?? 0;                           vb = b.duration_ms ?? 0; break;
        case "queue":    va = a.queue_wait_ms ?? 0;                         vb = b.queue_wait_ms ?? 0; break;
        case "started":  va = new Date(a.created_at).getTime();             vb = new Date(b.created_at).getTime(); break;
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [runs, sortCol, sortDir]);

  function downloadCSV() {
    // Wrap every field in double-quotes and escape internal double-quotes by doubling them.
    // This handles commas, newlines, and quotes in branch names, actor logins, etc.
    function csvField(v: string | number | undefined | null): string {
      return `"${String(v ?? "").replace(/"/g, '""')}"`;
    }
    const headers = ["Run#", "Status", "Conclusion", "Branch", "Trigger", "Actor", "Duration_ms", "Queue_ms", "Started", "SHA", "Commit Message"];
    const rows = sortedRuns.map(r => [
      csvField(r.run_number),
      csvField(r.status),
      csvField(r.conclusion),
      csvField(r.head_branch),
      csvField(r.event),
      csvField(r.actor?.login),
      csvField(r.duration_ms),
      csvField(r.queue_wait_ms),
      csvField(r.created_at),
      csvField(r.head_sha),
      csvField((r.head_commit?.message ?? "").split("\n")[0]),
    ]);
    const csv = [headers.map(csvField).join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "runs.csv";
    a.click();
    // Defer revocation so the browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">All Runs</h3>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh runs"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{runs.length} runs</span>
          <button
            onClick={downloadCSV}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-white bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50">
              {/* expand toggle col — no sort */}
              <th className="w-8" />
              <SortTh col="run"      label="Run"     current={sortCol} dir={sortDir} onClick={() => toggleSort("run")} />
              <SortTh col="status"   label="Status"  current={sortCol} dir={sortDir} onClick={() => toggleSort("status")} />
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">Commit / PR</th>
              <SortTh col="branch"   label="Branch"  current={sortCol} dir={sortDir} onClick={() => toggleSort("branch")} />
              <SortTh col="trigger"  label="Trigger" current={sortCol} dir={sortDir} onClick={() => toggleSort("trigger")} />
              <SortTh col="actor"    label="Actor"   current={sortCol} dir={sortDir} onClick={() => toggleSort("actor")} />
              <SortTh col="duration" label="Duration" current={sortCol} dir={sortDir} onClick={() => toggleSort("duration")} />
              <SortTh col="queue"    label="Queue"   current={sortCol} dir={sortDir} onClick={() => toggleSort("queue")} />
              <SortTh col="started"  label="Started" current={sortCol} dir={sortDir} onClick={() => toggleSort("started")} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {sortedRuns.map(run => (
              <React.Fragment key={run.id}>
                <tr className="hover:bg-slate-700/20 transition-colors group">
                  {/* expand chevron */}
                  <td className="pl-3 py-3 w-8">
                    <button
                      onClick={() => toggleExpanded(run.id)}
                      className="text-slate-600 hover:text-slate-300 transition-colors"
                      title={expanded.has(run.id) ? "Collapse jobs" : "Expand jobs"}
                      aria-label={expanded.has(run.id) ? `Collapse jobs for run #${run.run_number}` : `Expand jobs for run #${run.run_number}`}
                      aria-expanded={expanded.has(run.id)}
                    >
                      <ChevronDown className={cn(
                        "w-3.5 h-3.5 transition-transform",
                        expanded.has(run.id) ? "rotate-180 text-violet-400" : ""
                      )} />
                    </button>
                  </td>
                  {/* run number */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <a href={run.html_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-slate-300 hover:text-violet-300 transition-colors font-mono text-xs">
                      #{run.run_number}
                      <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  </td>
                  {/* status */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <ConclusionBadge conclusion={run.conclusion} status={run.status} />
                  </td>
                  {/* commit / PR */}
                  <td className="px-4 py-3 max-w-[220px]">
                    <div className="space-y-0.5">
                      {run.head_commit?.message && (
                        <p className="text-xs text-slate-300 truncate leading-snug" title={run.head_commit.message}>
                          {run.head_commit.message.split("\n")[0]}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 font-mono">{run.head_sha.slice(0, 7)}</span>
                        {run.pull_requests?.[0] && (
                          <a
                            href={`https://github.com/${owner}/${repo}/pull/${run.pull_requests[0].number}`}
                            target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-0.5 text-xs text-blue-400 hover:text-blue-300"
                          >
                            <GitPullRequest className="w-3 h-3" />#{run.pull_requests[0].number}
                          </a>
                        )}
                      </div>
                    </div>
                  </td>
                  {/* branch */}
                  <td className="px-4 py-3 whitespace-nowrap max-w-[140px]">
                    <span className="flex items-center gap-1 text-slate-300 text-xs font-mono truncate">
                      <GitCommit className="w-3 h-3 text-slate-500 shrink-0" />
                      {run.head_branch ?? "—"}
                    </span>
                  </td>
                  {/* trigger */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs text-slate-400 capitalize">{run.event}</span>
                  </td>
                  {/* actor */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    {run.actor ? (
                      <span className="flex items-center gap-1.5 text-slate-300 text-xs">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={run.actor.avatar_url} alt={run.actor.login} width={16} height={16} className="w-4 h-4 rounded-full" />
                        {run.actor.login}
                      </span>
                    ) : (
                      <span className="text-slate-500 text-xs flex items-center gap-1"><User className="w-3 h-3" />—</span>
                    )}
                  </td>
                  {/* duration */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs text-slate-300 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {formatDuration(run.duration_ms)}
                    </span>
                  </td>
                  {/* queue */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs text-slate-400">{formatDuration(run.queue_wait_ms)}</span>
                  </td>
                  {/* started */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-500 shrink-0" />
                      <span className="tabular-nums">
                        {new Date(run.created_at).toISOString().replace("T", " ").slice(0, 19)} UTC
                      </span>
                    </span>
                  </td>
                </tr>
                {/* expandable job/step drill-down */}
                {expanded.has(run.id) && (
                  <RunJobsRow runId={run.id} owner={owner} repo={repo} colSpan={10} />
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {runs.length === 0 && (
          <div className="py-16 text-center text-slate-500 text-sm">No runs found.</div>
        )}
      </div>
    </div>
  );
}

// ── expandable job+step row ───────────────────────────────────────────────────
function RunJobsRow({
  runId, owner, repo, colSpan,
}: {
  runId: number; owner: string; repo: string; colSpan: number;
}) {
  const { data: jobs, isLoading, error: jobsError } = useSWR<WorkflowJob[]>(
    `/api/github/run-details?owner=${owner}&repo=${repo}&run_id=${runId}`,
    fetcher<WorkflowJob[]>
  );

  // Compute overall run window for the Gantt (earliest started_at → latest completed_at)
  const ganttWindow = useMemo(() => {
    if (!jobs?.length) return null;
    const starts = jobs.map(j => j.started_at ? new Date(j.started_at).getTime() : null).filter(Boolean) as number[];
    const ends   = jobs.map(j => j.completed_at ? new Date(j.completed_at).getTime() : null).filter(Boolean) as number[];
    if (!starts.length || !ends.length) return null;
    const minT = Math.min(...starts);
    const maxT = Math.max(...ends);
    const span = maxT - minT;
    return span > 0 ? { minT, span } : null;
  }, [jobs]);

  // Total run duration = last completed_at − first started_at (same as ganttWindow.span)
  const totalDuration = ganttWindow?.span ?? null;

  const conclusionColor: Record<string, string> = {
    success:   "bg-green-500",
    failure:   "bg-red-500",
    cancelled: "bg-yellow-500",
    skipped:   "bg-slate-600",
    timed_out: "bg-orange-500",
  };

  const inner = isLoading ? (
    <p className="text-xs text-slate-500 animate-pulse">Loading jobs…</p>
  ) : jobsError ? (
    <p className="text-xs text-red-400">Failed to load job details: {jobsError.message}</p>
  ) : !jobs?.length ? (
    <p className="text-xs text-slate-500">No job data available.</p>
  ) : (
    <div className="space-y-4">
      {/* ── header: total run duration ── */}
      <div className="flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 text-violet-400 shrink-0" />
        <span className="text-xs font-semibold text-slate-200">
          Run duration:&nbsp;
          <span className="text-violet-300 tabular-nums">
            {totalDuration != null ? formatDuration(totalDuration) : "—"}
          </span>
        </span>
      </div>

      {/* ── Gantt timeline ── */}
      {ganttWindow && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Timeline</p>
          {jobs.map((job, ji) => {
            const jStart = job.started_at ? new Date(job.started_at).getTime() : null;
            const jEnd   = job.completed_at ? new Date(job.completed_at).getTime() : null;
            const left   = jStart != null ? ((jStart - ganttWindow.minT) / ganttWindow.span) * 100 : 0;
            const width  = (jStart != null && jEnd != null)
              ? Math.max(((jEnd - jStart) / ganttWindow.span) * 100, 0.5)
              : 0;
            const barColor = conclusionColor[job.conclusion ?? ""] ?? "bg-slate-500";
            const palette  = ["bg-violet-500","bg-blue-500","bg-cyan-500","bg-teal-500","bg-green-600","bg-orange-500","bg-pink-500"];
            const barFill  = job.conclusion === "success"
              ? palette[ji % palette.length]
              : barColor;
            return (
              <div key={job.id} className="flex items-center gap-2">
                {/* job name */}
                <span className="w-40 shrink-0 text-[11px] text-slate-400 truncate text-right" title={job.name}>
                  {job.name}
                </span>
                {/* bar track */}
                <div className="relative flex-1 h-4 bg-slate-800 rounded overflow-hidden">
                  {width > 0 && (
                    <div
                      className={cn("absolute top-0 h-full rounded", barFill, "opacity-80")}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${job.name}: ${formatDuration(job.duration_ms ?? 0)}`}
                    />
                  )}
                </div>
                {/* duration label */}
                <span className="w-16 shrink-0 text-[11px] text-slate-500 tabular-nums text-right">
                  {job.duration_ms != null ? formatDuration(job.duration_ms) : "—"}
                </span>
              </div>
            );
          })}
          {/* axis labels */}
          <div className="flex ml-[10.5rem] mr-16 text-[10px] text-slate-600 tabular-nums">
            <span>0s</span>
            <span className="ml-auto">{formatDuration(ganttWindow.span)}</span>
          </div>
        </div>
      )}

      {/* ── job + step list ── */}
      <div className="space-y-3 border-t border-slate-700/40 pt-3">
        {jobs.map(job => (
          <div key={job.id}>
            {/* job header */}
            <div className="flex items-center gap-2 mb-1">
              <ConclusionBadge conclusion={job.conclusion} status={job.status} />
              <span className="text-xs font-medium text-slate-200">{job.name}</span>
              {job.duration_ms !== null && (
                <span className="ml-auto text-xs text-slate-500 tabular-nums">{formatDuration(job.duration_ms)}</span>
              )}
            </div>
            {/* steps */}
            {job.steps.length > 0 && (
              <div className="ml-4 space-y-0.5 border-l border-slate-700/40 pl-3">
                {job.steps.map(step => (
                  <div key={step.number} className="flex items-center gap-2 text-xs text-slate-400">
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      step.conclusion === "success" ? "bg-green-400"
                      : step.conclusion === "failure" ? "bg-red-400"
                      : step.conclusion === "skipped" ? "bg-slate-600"
                      : "bg-slate-500"
                    )} />
                    <span className="truncate max-w-xs">{step.name}</span>
                    {step.duration_ms !== null && (
                      <span className="ml-auto text-slate-600 tabular-nums">{formatDuration(step.duration_ms)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <tr className="bg-slate-900/50">
      <td colSpan={colSpan} className="px-6 py-4 border-b border-slate-700/30">
        {inner}
      </td>
    </tr>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED SMALL COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════
function ChartCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pngError, setPngError] = useState<string | null>(null);

  async function exportPng() {
    if (!cardRef.current) return;
    setPngError(null);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: "#0f172a",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/\s+/g, "-").toLowerCase()}.png`;
      a.click();
    } catch {
      setPngError("Export failed");
      setTimeout(() => setPngError(null), 3000);
    }
  }

  return (
    <div ref={cardRef} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          {pngError && <span className="text-xs text-red-400">{pngError}</span>}
          <button
            onClick={exportPng}
            title="Export as PNG"
            aria-label="Export chart as PNG"
            className="text-slate-600 hover:text-slate-300 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function SuccessPip({ value }: { value: number }) {
  const color = value >= 90 ? "text-green-400" : value >= 70 ? "text-amber-400" : "text-red-400";
  return <span className={cn("font-medium tabular-nums", color)}>{value}%</span>;
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
      <Icon className="w-10 h-10 text-slate-600" />
      <p className="text-slate-400 text-sm">{message}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-slate-800/40 border border-slate-700/30 animate-pulse" />
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-64 rounded-xl bg-slate-800/40 border border-slate-700/30 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

// make TS happy for Cell inside BarChart
declare module "recharts" {
  interface CellProps { key?: React.Key; }
}
