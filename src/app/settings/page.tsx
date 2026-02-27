"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, FetchError } from "@/lib/swr";
import { useAuth } from "@/components/AuthProvider";
import { Breadcrumb } from "@/components/Sidebar";
import type { BillingData } from "@/app/api/github/billing/route";
import {
  CheckCircle, AlertCircle, ExternalLink, Clock, CreditCard,
  Monitor, Apple, Server, LogOut, User, Building2, Key, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Mini progress bar ─────────────────────────────────────────────────────────
function MinutesBar({ used, included }: { used: number; included: number }) {
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-violet-500";
  return (
    <div className="mt-1">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>{used.toLocaleString()} min used</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-slate-500 mt-1">{included.toLocaleString()} min included</p>
    </div>
  );
}

// ── Billing widget ────────────────────────────────────────────────────────────
function BillingWidget() {
  const [orgInput, setOrgInput] = useState("");
  const [org, setOrg] = useState("");

  const key = `/api/github/billing${org ? `?org=${org}` : ""}`;
  const { data, error, isLoading } = useSWR<BillingData>(key, fetcher<BillingData>, {
    revalidateOnFocus: false,
  });

  const breakdown = data?.minutes_used_breakdown ?? {};
  const runners: {
    label: string; key: keyof typeof breakdown; icon: React.ElementType; color: string;
  }[] = [
    { label: "Ubuntu",  key: "UBUNTU",  icon: Server,  color: "text-green-400" },
    { label: "macOS",   key: "MACOS",   icon: Apple,   color: "text-blue-400"  },
    { label: "Windows", key: "WINDOWS", icon: Monitor,  color: "text-amber-400" },
  ];

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
          <CreditCard className="w-4 h-4 text-blue-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Actions Billing</h2>
          <p className="text-xs text-slate-400">Monthly GitHub Actions minutes usage</p>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          value={orgInput}
          onChange={(e) => setOrgInput(e.target.value)}
          placeholder="Org login (leave blank for personal)"
          className="flex-1 px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
        <button
          onClick={() => setOrg(orgInput.trim())}
          className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg text-sm transition-colors"
        >
          Load
        </button>
      </div>

      {isLoading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-4 w-40 bg-slate-700 rounded" />
          <div className="h-2 w-full bg-slate-700 rounded" />
          <div className="h-3 w-24 bg-slate-700 rounded" />
        </div>
      )}

      {error && (
        <div className="flex flex-col gap-2 text-sm">
          {error instanceof FetchError && error.status === 410 ? (
            <div className="flex flex-col gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2 text-amber-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">Personal billing API deprecated</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                GitHub removed the personal Actions billing REST endpoint.
                View your usage directly on GitHub instead.
              </p>
              <a
                href="https://github.com/settings/billing/summary"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
              >
                Open GitHub billing <ExternalLink className="w-3 h-3" />
              </a>
              <p className="text-xs text-slate-500">
                Tip: enter an org login above to view org billing (still supported).
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="w-4 h-4" />
              {error.message ?? "Failed to load billing data"}
            </div>
          )}
        </div>
      )}

      {data && !isLoading && (
        <>
          <div>
            <p className="text-xs text-slate-400 mb-1">
              {data.kind === "org"
                ? <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {data.login}</span>
                : <span className="flex items-center gap-1"><User className="w-3 h-3" /> {data.login}</span>}
            </p>
            <MinutesBar used={data.total_minutes_used} included={data.included_minutes} />
            {data.total_paid_minutes_used > 0 && (
              <p className="text-xs text-amber-400 mt-1">
                +{data.total_paid_minutes_used.toLocaleString()} paid minutes this month
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {runners.map(({ label, key: k, icon: Icon, color }) => (
              <div key={k} className="bg-slate-900/40 border border-slate-700/40 rounded-lg px-3 py-2.5">
                <div className={cn("flex items-center gap-1.5 text-xs mb-1", color)}>
                  <Icon className="w-3.5 h-3.5" /> {label}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-base font-semibold text-white tabular-nums">
                    {(breakdown[k] ?? 0).toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-500">min</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

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

      {/* Billing */}
      <BillingWidget />

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
