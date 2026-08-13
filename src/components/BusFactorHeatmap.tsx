"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { ModuleOwnership, BusFactorResponse } from "@/app/api/github/bus-factor/route";
import PartialDataBadge from "@/components/PartialDataBadge";
import {
  AlertTriangle,
  Shield,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Users,
  FolderTree,
  Info,
} from "lucide-react";

// ── Risk colours ──────────────────────────────────────────────────────────────

const RISK = {
  critical: {
    bg: "bg-red-500/10",
    border: "border-red-500/25",
    badge: "bg-red-500/20 text-red-400 border-red-500/30",
    bar: "bg-red-500/70",
    text: "text-red-400",
    icon: AlertTriangle,
    label: "Critical",
  },
  warning: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/25",
    badge: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    bar: "bg-amber-500/60",
    text: "text-amber-400",
    icon: Shield,
    label: "Warning",
  },
  healthy: {
    bg: "bg-green-500/8",
    border: "border-green-500/20",
    badge: "bg-green-500/20 text-green-400 border-green-500/30",
    bar: "bg-green-500/60",
    text: "text-green-400",
    icon: CheckCircle,
    label: "Healthy",
  },
} as const;

// ── Module card ───────────────────────────────────────────────────────────────

function ModuleCard({ mod }: { mod: ModuleOwnership }) {
  const [expanded, setExpanded] = useState(false);
  const r = RISK[mod.risk];
  const Icon = r.icon;
  const topContributor = mod.contributors[0];

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        r.bg,
        r.border
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-start gap-2 text-left min-w-0 flex-1 group"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 mt-0.5 text-slate-500 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-slate-500 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-xs font-mono font-medium text-slate-200 truncate group-hover:text-white transition-colors">
              {mod.module}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {mod.total_commits} commit{mod.total_commits !== 1 ? "s" : ""} &middot;{" "}
              {mod.unique_contributors} contributor{mod.unique_contributors !== 1 ? "s" : ""}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border",
              r.badge
            )}
          >
            <Icon className="w-2.5 h-2.5" />
            {r.label}
          </span>
          <span
            className={cn(
              "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
              mod.bus_factor <= 1
                ? "text-red-300 bg-red-500/15"
                : mod.bus_factor <= 2
                  ? "text-amber-300 bg-amber-500/15"
                  : "text-green-300 bg-green-500/15"
            )}
          >
            BF={mod.bus_factor}
          </span>
        </div>
      </div>

      {/* Ownership bar (always visible) */}
      <div className="mt-2.5 flex h-2 rounded-full overflow-hidden bg-slate-800/60">
        {mod.contributors.map((c, i) => (
          <div
            key={c.login}
            title={`${c.login}: ${c.pct}% (${c.commits} commits)`}
            className="h-full transition-all"
            style={{
              width: `${c.pct}%`,
              backgroundColor: i === 0
                ? "rgba(239, 68, 68, 0.7)"   // red-ish for dominant
                : i === 1
                  ? "rgba(245, 158, 11, 0.6)" // amber
                  : i === 2
                    ? "rgba(34, 197, 94, 0.5)"  // green
                    : i === 3
                      ? "rgba(59, 130, 246, 0.5)" // blue
                      : "rgba(139, 92, 246, 0.4)",// violet
            }}
          />
        ))}
      </div>

      {/* Top contributor label */}
      {topContributor && !expanded && (
        <p className="text-[10px] text-slate-500 mt-1.5">
          Top: <span className="text-slate-300 font-medium">{topContributor.login}</span>{" "}
          ({topContributor.pct}%)
        </p>
      )}

      {/* Expanded: full contributor list */}
      {expanded && (
        <div className="mt-3 space-y-1.5">
          {mod.contributors.map((c, i) => (
            <div key={c.login} className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 font-mono w-20 truncate shrink-0">
                {c.login}
              </span>
              <div className="flex-1 h-1.5 bg-slate-800/60 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${c.pct}%`,
                    backgroundColor: i === 0
                      ? "rgba(239, 68, 68, 0.7)"
                      : i === 1
                        ? "rgba(245, 158, 11, 0.6)"
                        : "rgba(34, 197, 94, 0.5)",
                  }}
                />
              </div>
              <span className="text-[10px] font-mono text-slate-400 w-14 text-right shrink-0">
                {c.pct}% ({c.commits})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

export function BusFactorSkeleton() {
  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-slate-800/40 border border-slate-700/40 rounded-lg p-3">
            <div className="h-2.5 w-16 rounded skeleton mb-2" />
            <div className="h-5 w-10 rounded skeleton" />
          </div>
        ))}
      </div>
      {/* Module grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-slate-800/40 border border-slate-700/40 rounded-lg p-3">
            <div className="h-3 w-32 rounded skeleton mb-2" />
            <div className="h-2 w-full rounded skeleton mb-1.5" />
            <div className="h-2 w-20 rounded skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BusFactorHeatmap({ data }: { data: BusFactorResponse }) {
  const [filterRisk, setFilterRisk] = useState<"all" | "critical" | "warning" | "healthy">("all");

  const counts = useMemo(() => {
    const critical = data.modules.filter((m) => m.risk === "critical").length;
    const warning = data.modules.filter((m) => m.risk === "warning").length;
    const healthy = data.modules.filter((m) => m.risk === "healthy").length;
    return { critical, warning, healthy };
  }, [data.modules]);

  const filtered = useMemo(() => {
    if (filterRisk === "all") return data.modules;
    return data.modules.filter((m) => m.risk === filterRisk);
  }, [data.modules, filterRisk]);

  if (data.modules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <FolderTree className="w-8 h-8 text-slate-600" />
        <p className="text-sm text-slate-500">No commit data available to compute bus factor.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.partial && (
        <PartialDataBadge fetched={data.fetched_commits} total={data.total_commits_listed} unit="commits" />
      )}
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Shield className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Overall BF</span>
          </div>
          <p
            className={cn(
              "text-xl font-bold",
              data.overall_bus_factor <= 1
                ? "text-red-400"
                : data.overall_bus_factor <= 2
                  ? "text-amber-400"
                  : "text-green-400"
            )}
          >
            {data.overall_bus_factor}
          </p>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Critical</span>
          </div>
          <p className="text-xl font-bold text-red-400">{counts.critical}</p>
          <p className="text-[10px] text-slate-500">module{counts.critical !== 1 ? "s" : ""} at risk</p>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Users className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Contributors</span>
          </div>
          <p className="text-xl font-bold text-white">{data.total_contributors}</p>
          <p className="text-[10px] text-slate-500">across {data.modules.length} modules</p>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <FolderTree className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Commits</span>
          </div>
          <p className="text-xl font-bold text-white">{data.total_commits}</p>
          <p className="text-[10px] text-slate-500">in last 90 days</p>
        </div>
      </div>

      {/* Info callout when critical modules exist */}
      {counts.critical > 0 && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-red-500/8 border border-red-500/15 rounded-lg">
          <Info className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300/80">
            <span className="font-medium text-red-300">{counts.critical} module{counts.critical !== 1 ? "s" : ""}</span> ha{counts.critical !== 1 ? "ve" : "s"} a bus factor of 1 — a single contributor owns {"\u2265"}80% of recent commits. Consider cross-training or pair programming to reduce risk.
          </p>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1.5">
        {(["all", "critical", "warning", "healthy"] as const).map((f) => {
          const count =
            f === "all"
              ? data.modules.length
              : counts[f];
          return (
            <button
              key={f}
              onClick={() => setFilterRisk(f)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border",
                filterRisk === f
                  ? f === "critical"
                    ? "bg-red-500/15 border-red-500/25 text-red-300"
                    : f === "warning"
                      ? "bg-amber-500/15 border-amber-500/25 text-amber-300"
                      : f === "healthy"
                        ? "bg-green-500/15 border-green-500/25 text-green-300"
                        : "bg-violet-500/15 border-violet-500/25 text-violet-300"
                  : "bg-transparent border-slate-700/50 text-slate-500 hover:text-slate-300 hover:border-slate-600"
              )}
            >
              {f === "all" ? "All" : RISK[f].label} ({count})
            </button>
          );
        })}
      </div>

      {/* Module grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filtered.map((mod) => (
          <ModuleCard key={mod.module} mod={mod} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-sm text-slate-600 italic">
          No modules match the selected filter.
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 pt-1">
        <span className="text-[9px] text-slate-600 uppercase tracking-wider">Risk levels:</span>
        {(["critical", "warning", "healthy"] as const).map((r) => {
          const cfg = RISK[r];
          const RIcon = cfg.icon;
          return (
            <span key={r} className="flex items-center gap-1 text-[10px] text-slate-500">
              <RIcon className={cn("w-2.5 h-2.5", cfg.text)} />
              <span className={cfg.text}>{cfg.label}</span>
              <span className="text-slate-600">
                (BF {r === "critical" ? "= 1" : r === "warning" ? "= 2" : "\u2265 3"})
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
