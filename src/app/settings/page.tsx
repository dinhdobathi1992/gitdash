"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import { Breadcrumb } from "@/components/Sidebar";
import type { FeatureFlags } from "@/lib/feature-flags";
import {
  CheckCircle, AlertCircle, LogOut, Key, Eye, EyeOff,
  ToggleLeft, ToggleRight, Zap, Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── PAT inline form ──────────────────────────────────────────────────────────
function PatInlineForm({ login }: { login: string }) {
  const [editing, setEditing] = useState(false);
  const [newPat, setNewPat] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: newPat.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong."); return; }
      window.location.href = "/settings";
    } catch {
      setError("Network error — could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-slate-400">
          Token is active for <span className="text-white font-mono">@{login}</span>.
          It is stored in an encrypted, HTTP-only session cookie — never exposed to the browser.
        </p>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/30 transition-colors"
          >
            <Key className="w-4 h-4" /> Change PAT
          </button>
          <button
            onClick={() => {
              fetch("/api/auth/logout", { method: "POST" })
                .finally(() => { window.location.href = "/setup"; });
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-slate-600 hover:border-red-500/20 transition-colors"
          >
            <LogOut className="w-4 h-4" /> Clear &amp; reset
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleChange} className="flex items-center gap-2 flex-wrap">
      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1 w-full">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </p>
      )}
      <div className="relative">
        <input
          type={showToken ? "text" : "password"}
          value={newPat}
          onChange={(e) => setNewPat(e.target.value)}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          autoComplete="off"
          spellCheck={false}
          required
          className="w-64 px-3 py-1.5 pr-8 bg-slate-900/60 border border-slate-700 rounded-lg text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
        <button
          type="button"
          onClick={() => setShowToken((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
        >
          {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
      <button
        type="submit"
        disabled={loading || !newPat.trim()}
        className={cn(
          "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
          loading || !newPat.trim()
            ? "bg-violet-600/30 text-violet-300/50 cursor-not-allowed"
            : "bg-violet-600 hover:bg-violet-500 text-white"
        )}
      >
        {loading ? "Verifying..." : "Save"}
      </button>
      <button
        type="button"
        onClick={() => { setEditing(false); setNewPat(""); setError(null); }}
        className="px-2 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
      >
        Cancel
      </button>
    </form>
  );
}

// ── Feature flags ────────────────────────────────────────────────────────────
type FlagDef = {
  key: keyof FeatureFlags;
  label: string;
  description: string;
  affects: string;
};

const FLAG_DEFS: FlagDef[] = [
  { key: "dora", label: "DORA Metrics", description: "Deploy Frequency, Lead Time, Change Failure Rate, MTTR KPI cards and drill-down charts.", affects: "Repository Overview" },
  { key: "prLifecycle", label: "PR Lifecycle Health", description: "Open PRs, Review P50/P90, Abandon Rate, Age Distribution, and concurrent WIP by author.", affects: "Repository Overview" },
  { key: "performanceTab", label: "Performance Tab", description: "Job Duration avg vs p95, Job Composition per Run, Slowest Steps — requires fetching job-level data.", affects: "Workflow Detail" },
  { key: "reliabilityTab", label: "Reliability Tab", description: "MTTR, Failure Streak, Flaky Branches, Re-run Rate, Pass/Fail Timeline.", affects: "Workflow Detail" },
  { key: "anomalyDetection", label: "Anomaly Detection", description: "Statistical outlier detection (> 2 stddev from rolling baseline) on workflow runs.", affects: "Workflow Detail" },
  { key: "busFactor", label: "Bus Factor Analysis", description: "Per-module contributor count and Herfindahl-Hirschman Index — requires fetching full commit history.", affects: "Repository Team" },
  { key: "securityScan", label: "Security Scan", description: "Static analysis of workflow YAML files for security anti-patterns.", affects: "Repository Security" },
  { key: "costAnalytics", label: "Cost Analytics", description: "GitHub Actions billing breakdown by runner type and SKU.", affects: "Cost Analytics" },
  { key: "runnerUtilization", label: "Runner Utilization", description: "Per-runner job counts, durations, and failure rates across recent workflow runs.", affects: "Repository Team" },
  { key: "reviewBottleneck", label: "Review Bottleneck", description: "Flags overloaded reviewers and stale review requests from PR review data.", affects: "Repository Team" },
  { key: "healthScorecard", label: "Team Health Scorecard", description: "Org-wide ranked view combining DORA tier and bus-factor risk per repo, worst-first.", affects: "Organization Overview" },
  { key: "workloadRisk", label: "Workload Risk Radar", description: "Flags sustained after-hours/weekend work, activity cliffs, and concurrent-PR overload per person.", affects: "Repository Team" },
  { key: "aiInsights", label: "AI Insights", description: "LLM-generated analysis of the metrics already on screen. Requires AI provider keys configured on the server — the surfaces stay hidden without them.", affects: "Repository Overview, Organization Health" },
];

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        "shrink-0 transition-colors",
        on ? "text-violet-400 hover:text-violet-300" : "text-slate-600 hover:text-slate-400"
      )}
      aria-label={on ? "Disable" : "Enable"}
    >
      {on ? <ToggleRight className="w-7 h-7" /> : <ToggleLeft className="w-7 h-7" />}
    </button>
  );
}

function FeatureCard({ def, on, onChange }: { def: FlagDef; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-all cursor-pointer",
        on
          ? "bg-slate-800/60 border-violet-500/30 shadow-sm shadow-violet-500/5"
          : "bg-slate-800/30 border-slate-700/40 hover:border-slate-600/60",
      )}
      onClick={() => onChange(!on)}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className={cn("text-sm font-medium", on ? "text-white" : "text-slate-400")}>
          {def.label}
        </h4>
        <Toggle on={on} onChange={onChange} />
      </div>
      <p className="text-xs text-slate-500 leading-relaxed mb-3">{def.description}</p>
      <span className={cn(
        "inline-flex text-[10px] px-1.5 py-0.5 rounded font-mono",
        on ? "bg-violet-500/10 text-violet-400" : "bg-slate-700/40 text-slate-500",
      )}>
        {def.affects}
      </span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function SettingsPage() {
  const { user, mode } = useAuth();
  const { flags, setFlag } = useFeatureFlags();
  const isStandalone = mode === "standalone";
  const enabledCount = Object.values(flags).filter(Boolean).length;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <Breadcrumb items={[{ label: "Repositories", href: "/" }, { label: "Settings" }]} />

      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
        <p className="text-sm text-slate-400">Account and dashboard configuration</p>
      </div>

      {/* ── Account section ──────────────────────────────────────────── */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-6 space-y-5">
        {/* Row 1: Identity */}
        <div className="flex items-center gap-5">
          {user ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={user.avatar_url} alt={user.login} width={56} height={56} className="w-14 h-14 rounded-full border-2 border-slate-700 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-white">{user.name ?? user.login}</p>
                <p className="text-sm text-slate-400 font-mono">@{user.login}</p>
                {user.email && <p className="text-xs text-slate-500 mt-0.5">{user.email}</p>}
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <span className={cn(
                  "text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider border",
                  isStandalone
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    : "bg-violet-500/10 text-violet-400 border-violet-500/20",
                )}>
                  {isStandalone ? "standalone" : "organization"}
                </span>

                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-[10px] text-green-400">
                  <CheckCircle className="w-3 h-3" /> Active
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <AlertCircle className="w-4 h-4" /> Not signed in
            </div>
          )}
        </div>

        {/* Row 2: Token / Session management */}
        {user && (
          <div className="border-t border-slate-700/50 pt-4">
            {isStandalone ? (
              <div className="flex items-center gap-4">
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <Key className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <PatInlineForm login={user.login} />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                  <Shield className="w-4 h-4 text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-400">OAuth session stored as an encrypted, HTTP-only cookie — never exposed to the browser.</p>
                </div>
                <button
                  onClick={() => {
                    fetch("/api/auth/logout", { method: "POST" })
                      .finally(() => { window.location.href = "/login"; });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-colors shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" /> Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Feature flags — card grid fills the page ──────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
              <Zap className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Feature Flags</h2>
              <p className="text-xs text-slate-400">
                {enabledCount} of {FLAG_DEFS.length} enabled — disabled features skip their API calls entirely
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => FLAG_DEFS.forEach((d) => setFlag(d.key, true))}
              className="text-xs px-2.5 py-1 rounded-lg text-violet-400 hover:bg-violet-500/10 border border-violet-500/20 transition-colors"
            >
              Enable all
            </button>
            <button
              onClick={() => FLAG_DEFS.forEach((d) => setFlag(d.key, false))}
              className="text-xs px-2.5 py-1 rounded-lg text-slate-400 hover:bg-slate-700/60 border border-slate-700 transition-colors"
            >
              Disable all
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {FLAG_DEFS.map((def) => (
            <FeatureCard
              key={def.key}
              def={def}
              on={flags[def.key]}
              onChange={(v) => setFlag(def.key, v)}
            />
          ))}
        </div>

        <p className="text-[11px] text-slate-600 flex items-center gap-1.5">
          <CheckCircle className="w-3 h-3 text-slate-600 shrink-0" />
          Settings are saved instantly to your browser. Navigate to the affected page to see the change.
        </p>
      </div>
    </div>
  );
}
