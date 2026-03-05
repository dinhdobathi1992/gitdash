"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import { Breadcrumb } from "@/components/Sidebar";
import type { FeatureFlags } from "@/lib/feature-flags";
import {
  CheckCircle, AlertCircle, Clock, ExternalLink, LogOut, Key, Eye, EyeOff,
  ToggleLeft, ToggleRight, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── PAT management widget (standalone mode only) ──────────────────────────────
function PatWidget({ login }: { login: string }) {
  const [showChangePat, setShowChangePat] = useState(false);
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
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      // Reload so AuthProvider picks up the new user identity
      window.location.href = "/settings";
    } catch {
      setError("Network error — could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Personal Access Token</h2>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
          standalone mode
        </span>
      </div>

      <p className="text-xs text-slate-400">
        Token is active for <span className="text-white font-mono">@{login}</span>.
        It is stored in an encrypted, HTTP-only session cookie — never exposed to the browser.
      </p>

      {!showChangePat ? (
        <div className="flex gap-2">
          <button
            onClick={() => setShowChangePat(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/20 transition-colors"
          >
            <Key className="w-3.5 h-3.5" /> Change PAT
          </button>
          <button
            onClick={() => {
              fetch("/api/auth/logout", { method: "POST" }).then(() => {
                window.location.href = "/setup";
              }).catch(() => {
                window.location.href = "/setup";
              });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/20 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Clear &amp; reset
          </button>
        </div>
      ) : (
        <form onSubmit={handleChange} className="space-y-3">
          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1">
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
              className="w-full px-3 py-2 pr-10 bg-slate-900/60 border border-slate-700 rounded-lg text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || !newPat.trim()}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                loading || !newPat.trim()
                  ? "bg-violet-600/30 text-violet-300/50 cursor-not-allowed"
                  : "bg-violet-600 hover:bg-violet-500 text-white"
              )}
            >
              {loading ? "Verifying…" : "Save new PAT"}
            </button>
            <button
              type="button"
              onClick={() => { setShowChangePat(false); setNewPat(""); setError(null); }}
              className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Feature flags widget ──────────────────────────────────────────────────────
type FlagDef = {
  key: keyof FeatureFlags;
  label: string;
  description: string;
  affects: string;
};

const FLAG_DEFS: FlagDef[] = [
  {
    key: "dora",
    label: "DORA Metrics",
    description: "Deploy Frequency, Lead Time, Change Failure Rate, MTTR KPI cards and drill-down charts.",
    affects: "Repository Overview",
  },
  {
    key: "prLifecycle",
    label: "PR Lifecycle Health",
    description: "Open PRs, Review P50/P90, Abandon Rate, Age Distribution, and concurrent WIP by author.",
    affects: "Repository Overview",
  },
  {
    key: "performanceTab",
    label: "Performance Tab",
    description: "Job Duration avg vs p95, Job Composition per Run, Slowest Steps — requires fetching job-level data.",
    affects: "Workflow Detail → Performance",
  },
  {
    key: "reliabilityTab",
    label: "Reliability Tab",
    description: "MTTR, Failure Streak, Flaky Branches, Re-run Rate, Pass/Fail Timeline.",
    affects: "Workflow Detail → Reliability",
  },
  {
    key: "anomalyDetection",
    label: "Anomaly Detection",
    description: "Statistical outlier detection (> 2 stddev from rolling baseline) on workflow runs.",
    affects: "Workflow Detail → Reliability",
  },
  {
    key: "busFactor",
    label: "Bus Factor Analysis",
    description: "Per-module contributor count and Herfindahl–Hirschman Index — requires fetching full commit history.",
    affects: "Repository Team page",
  },
  {
    key: "securityScan",
    label: "Security Scan",
    description: "Static analysis of workflow YAML files for security anti-patterns.",
    affects: "Repository Security page",
  },
  {
    key: "costAnalytics",
    label: "Cost Analytics",
    description: "GitHub Actions billing breakdown by runner type and SKU.",
    affects: "Cost Analytics page",
  },
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
      {on
        ? <ToggleRight className="w-8 h-8" />
        : <ToggleLeft  className="w-8 h-8" />}
    </button>
  );
}

function FeaturesWidget() {
  const { flags, setFlag } = useFeatureFlags();

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
          <Zap className="w-4 h-4 text-violet-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Feature Flags</h2>
          <p className="text-xs text-slate-400">Toggle metrics on or off. Disabled features skip their API calls entirely.</p>
        </div>
      </div>

      <div className="divide-y divide-slate-700/40">
        {FLAG_DEFS.map((def) => (
          <div key={def.key} className="flex items-center gap-4 py-3.5">
            <Toggle on={flags[def.key]} onChange={(v) => setFlag(def.key, v)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className={cn(
                  "text-sm font-medium transition-colors",
                  flags[def.key] ? "text-white" : "text-slate-500"
                )}>
                  {def.label}
                </p>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 font-mono">
                  {def.affects}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{def.description}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-slate-600 flex items-center gap-1.5 pt-1 border-t border-slate-700/40">
        <CheckCircle className="w-3 h-3 text-slate-600 shrink-0" />
        Settings are saved instantly to your browser. Navigate to the affected page to see the change.
      </p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function SettingsPage() {
  const { user, mode } = useAuth();
  const isStandalone = mode === "standalone";

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <Breadcrumb items={[{ label: "Repositories", href: "/" }, { label: "Settings" }]} />

      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
        <p className="text-sm text-slate-400">Account and dashboard configuration</p>
      </div>

      {/* Identity card */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-white mb-4">
          {isStandalone ? "GitHub identity" : "Signed in as"}
        </h2>
        {user ? (
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={user.avatar_url} alt={user.login} width={48} height={48} className="w-12 h-12 rounded-full border border-slate-700" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">{user.name ?? user.login}</p>
              <p className="text-xs text-slate-400">@{user.login}</p>
              {user.email && <p className="text-xs text-slate-500 mt-0.5">{user.email}</p>}
            </div>
            {!isStandalone && (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-xs text-green-400">
                  <CheckCircle className="w-3 h-3" /> Connected
                </span>
                <button
                  onClick={() => {
                    fetch("/api/auth/logout", { method: "POST" }).then(() => {
                      window.location.href = "/login";
                    }).catch(() => {
                      window.location.href = "/login";
                    });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/20 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" /> Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <AlertCircle className="w-4 h-4" /> Not signed in
          </div>
        )}
      </div>

      {/* PAT management — standalone only */}
      {isStandalone && user && <PatWidget login={user.login} />}

      {/* Feature flags */}
      <FeaturesWidget />

      {/* Auth info */}
      <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">About authentication</h3>
        {isStandalone ? (
          <p className="text-sm text-slate-400 leading-relaxed">
            Running in <strong className="text-amber-400">standalone mode</strong>.
            Your personal access token is stored in an encrypted, HTTP-only session cookie —
            it is never exposed to the browser. Use &ldquo;Change PAT&rdquo; above to rotate it,
            or &ldquo;Clear &amp; reset&rdquo; to go back to the setup screen.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-400 leading-relaxed">
              Running in <strong className="text-violet-400">organization mode</strong>.
              Your OAuth access token is stored in an encrypted, HTTP-only session cookie —
              never exposed to the browser or sent via JavaScript. Sign out to remove the session.
            </p>
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <a
                href="https://github.com/settings/connections/applications"
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-violet-400 hover:text-violet-300 transition-colors"
              >
                Manage GitHub app permissions <ExternalLink className="w-3 h-3" />
              </a>
              <span className="text-slate-600">·</span>
              <span className="flex items-center gap-1 text-slate-500">
                <Clock className="w-3 h-3" /> Session expires in 7 days
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
