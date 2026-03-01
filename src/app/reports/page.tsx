"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import { fetcher } from "@/lib/swr";
import { useAuth } from "@/components/AuthProvider";
import { Breadcrumb } from "@/components/Sidebar";
import { RepoPicker } from "@/components/RepoPicker";
import {
  BarChart3, TrendingUp, Calendar, Database, RefreshCw,
  AlertCircle, Info, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { DbDailyTrend, DbQuarterSummary } from "@/lib/db";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrendsResponse {
  type: string;
  data: DbDailyTrend[] | DbQuarterSummary[];
}

interface SyncResponse {
  synced: number;
  total_in_db: number;
  latest_run_id: number | null;
}

// ── Sync fetcher ───────────────────────────────────────────────────────────────

async function doSync(
  _key: string,
  { arg }: { arg: { owner: string; repo: string } }
): Promise<SyncResponse> {
  const res = await fetch("/api/db/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner: arg.owner, repo: arg.repo, pages: 5 }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Daily trend chart ─────────────────────────────────────────────────────────

function DailyChart({ data }: { data: DbDailyTrend[] }) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-600 text-sm italic">
        No data — sync a repo first
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: d.date.slice(5),   // MM-DD
    success: d.success,
    failure: d.failure,
    total: d.total,
    successRate: d.total > 0 ? Math.round((d.success / d.total) * 100) : 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="gSuccess" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gFailure" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          tickLine={false}
          interval={Math.ceil(chartData.length / 10)}
        />
        <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
          labelStyle={{ color: "#94a3b8", fontSize: 11 }}
          itemStyle={{ fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        <Area type="monotone" dataKey="success" name="Success" stroke="#10b981" fill="url(#gSuccess)" strokeWidth={1.5} dot={false} />
        <Area type="monotone" dataKey="failure" name="Failure" stroke="#ef4444" fill="url(#gFailure)" strokeWidth={1.5} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Quarterly table ───────────────────────────────────────────────────────────

function QuarterlyTable({ data }: { data: DbQuarterSummary[] }) {
  if (!data.length) {
    return (
      <div className="text-center text-slate-600 text-sm italic py-8">
        No quarterly data yet — sync more runs
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-900/60">
            {["Quarter", "Runs", "Success", "Failure", "Success %", "Avg Duration"].map((h) => (
              <th key={h} className="py-2.5 px-4 text-left text-xs font-medium text-slate-400 tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((q, i) => {
            const prev = data[i - 1];
            const rateChange = prev ? q.success_rate - prev.success_rate : null;
            const durMs = q.avg_duration_ms;
            const durLabel = durMs
              ? durMs >= 60000
                ? `${Math.round(durMs / 60000)}m ${Math.round((durMs % 60000) / 1000)}s`
                : `${Math.round(durMs / 1000)}s`
              : "—";

            return (
              <tr key={q.quarter} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                <td className="py-3 px-4 font-semibold text-white font-mono">{q.quarter}</td>
                <td className="py-3 px-4 text-slate-300">{q.total.toLocaleString()}</td>
                <td className="py-3 px-4 text-emerald-400">{q.success.toLocaleString()}</td>
                <td className="py-3 px-4 text-red-400">{q.failure.toLocaleString()}</td>
                <td className="py-3 px-4">
                  <span className={cn(
                    "font-semibold",
                    q.success_rate >= 90 ? "text-emerald-400" : q.success_rate >= 70 ? "text-amber-400" : "text-red-400"
                  )}>
                    {q.success_rate}%
                  </span>
                  {rateChange !== null && (
                    <span className={cn("ml-1.5 text-xs", rateChange > 0 ? "text-emerald-500" : rateChange < 0 ? "text-red-500" : "text-slate-500")}>
                      {rateChange > 0 ? "↑" : rateChange < 0 ? "↓" : "→"} {Math.abs(rateChange).toFixed(1)}pp
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-slate-400 font-mono text-xs">{durLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Quarterly bar chart ───────────────────────────────────────────────────────

function QuarterlyBarChart({ data }: { data: DbQuarterSummary[] }) {
  if (data.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="quarter" tick={{ fill: "#94a3b8", fontSize: 10 }} tickLine={false} />
        <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
          labelStyle={{ color: "#94a3b8", fontSize: 11 }}
          itemStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="success" name="Success" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
        <Bar dataKey="failure" name="Failure" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { label: "7 days",  value: 7 },
  { label: "14 days", value: 14 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "180 days", value: 180 },
  { label: "1 year",  value: 365 },
];

export default function ReportsPage() {
  const { mode } = useAuth();
  const isStandalone = mode === "standalone";

  const [activeRepo, setActiveRepo] = useState("");
  const [days, setDays] = useState(7);
  const [syncResult, setSyncResult] = useState<SyncResponse | null>(null);

  const { mutate } = useSWRConfig();

  const ownerRepo = activeRepo.includes("/") ? activeRepo.trim().split("/") : null;
  const owner = ownerRepo?.[0] ?? null;
  const repo = ownerRepo?.slice(1).join("/") ?? null;

  const dailyKey = owner && repo
    ? `/api/db/trends?type=daily&owner=${owner}&repo=${encodeURIComponent(repo)}&days=${days}`
    : null;
  const quarterlyKey = owner && repo
    ? `/api/db/trends?type=quarterly&owner=${owner}&repo=${encodeURIComponent(repo)}&quarters=6`
    : null;

  const { data: dailyData, isLoading: dailyLoading, error: dailyError } = useSWR<TrendsResponse>(
    dailyKey, fetcher<TrendsResponse>, { revalidateOnFocus: false }
  );
  const { data: quarterlyData, isLoading: quarterlyLoading } = useSWR<TrendsResponse>(
    quarterlyKey, fetcher<TrendsResponse>, { revalidateOnFocus: false }
  );

  const { trigger: runSync, isMutating: syncing } = useSWRMutation(
    "/api/db/sync",
    doSync,
    {
      onSuccess: (data) => {
        setSyncResult(data);
        mutate(dailyKey);
        mutate(quarterlyKey);
      },
    }
  );

  function handleRepoChange(fullName: string) {
    setActiveRepo(fullName);
    setSyncResult(null);
  }

  function handleSync() {
    if (!owner || !repo) return;
    runSync({ owner, repo });
  }

  const daily = (dailyData?.data ?? []) as DbDailyTrend[];
  const quarterly = (quarterlyData?.data ?? []) as DbQuarterSummary[];

  const totalRuns = daily.reduce((s, d) => s + d.total, 0);
  const totalSuccess = daily.reduce((s, d) => s + d.success, 0);
  const totalFailure = daily.reduce((s, d) => s + d.failure, 0);
  const avgRate = totalRuns > 0 ? Math.round((totalSuccess / totalRuns) * 100) : 0;

  if (isStandalone) {
    return (
      <div className="p-8 space-y-6">
        <Breadcrumb items={[{ label: "Reports" }]} />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Historical Reports</h1>
            <p className="text-sm text-slate-400">Long-term trends and quarterly comparisons from Neon DB</p>
          </div>
        </div>
        <div className="flex items-start gap-4 px-5 py-4 bg-amber-500/8 border border-amber-500/20 rounded-xl">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-300">
              Not available in standalone mode
            </p>
            <p className="text-xs text-amber-500/80">
              Historical reports require a PostgreSQL database and GitHub OAuth. Switch to organization mode,
              configure a GitHub OAuth App, and set a <span className="font-mono">DATABASE_URL</span> to use this feature.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <Breadcrumb items={[{ label: "Reports" }]} />

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Historical Reports</h1>
          <p className="text-sm text-slate-400">Long-term trends and quarterly comparisons from Neon DB</p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
        <div className="flex flex-wrap items-end gap-3">

          {/* Repo picker */}
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Repository</label>
            <RepoPicker value={activeRepo} onChange={handleRepoChange} />
          </div>

          {/* Period */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Period</label>
            <div className="relative">
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="appearance-none pl-3 pr-8 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500/40 cursor-pointer"
              >
                {PERIOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            </div>
          </div>

          {/* Sync button — always visible once a repo is selected */}
          {activeRepo && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync from GitHub"}
            </button>
          )}
        </div>

        {/* Sync result */}
        {syncResult && (
          <div className="mt-3 flex items-center gap-2 text-xs text-emerald-400">
            <Database className="w-3.5 h-3.5" />
            Synced {syncResult.synced} runs · {syncResult.total_in_db.toLocaleString()} total in DB
          </div>
        )}

        {/* No DB data hint */}
        {dailyError && activeRepo && (
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-400">
            <Info className="w-3.5 h-3.5" />
            No data in DB yet — click &quot;Sync from GitHub&quot; to populate historical data.
          </div>
        )}
      </div>

      {/* Empty state */}
      {!activeRepo && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-600 space-y-3">
          <BarChart3 className="w-12 h-12 opacity-40" />
          <p className="text-sm">Pick a repository above to view historical reports.</p>
          <p className="text-xs text-slate-700">
            Data is stored in Neon PostgreSQL and persists across sessions.
          </p>
        </div>
      )}

      {activeRepo && (
        <>
          {/* Summary stat cards */}
          {!dailyLoading && daily.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Runs",    value: totalRuns.toLocaleString(),    color: "text-violet-400" },
                { label: "Success",       value: totalSuccess.toLocaleString(), color: "text-emerald-400" },
                { label: "Failure",       value: totalFailure.toLocaleString(), color: "text-red-400" },
                { label: "Success Rate",  value: `${avgRate}%`,                 color: avgRate >= 90 ? "text-emerald-400" : avgRate >= 70 ? "text-amber-400" : "text-red-400" },
              ].map((s) => (
                <div key={s.label} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                  <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                  <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">last {days} days</p>
                </div>
              ))}
            </div>
          )}

          {/* Daily trend chart */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-violet-400" />
              <h2 className="text-sm font-semibold text-white">Daily Runs — {days} days</h2>
            </div>
            {dailyLoading ? (
              <div className="h-48 rounded-lg skeleton" />
            ) : (
              <DailyChart data={daily} />
            )}
          </div>

          {/* Quarterly comparison */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-semibold text-white">Quarterly Comparison</h2>
            </div>
            {quarterlyLoading ? (
              <div className="h-48 rounded-lg skeleton" />
            ) : (
              <>
                <QuarterlyBarChart data={quarterly} />
                <QuarterlyTable data={quarterly} />
              </>
            )}
          </div>

          {/* No data callout */}
          {daily.length === 0 && !dailyLoading && (
            <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/8 border border-amber-500/20 rounded-xl">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="text-sm">
                <p className="text-amber-300 font-medium">No historical data in database</p>
                <p className="text-amber-500/70 text-xs mt-0.5">
                  Click &quot;Sync from GitHub&quot; to pull recent runs into Neon DB. Each sync pulls up to 500 runs.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
