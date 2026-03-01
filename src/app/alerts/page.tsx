"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { useAuth } from "@/components/AuthProvider";
import { Breadcrumb } from "@/components/Sidebar";
import { RepoPicker } from "@/components/RepoPicker";
import {
  Bell, Plus, Trash2, ToggleLeft, ToggleRight, AlertCircle,
  CheckCircle2, Clock, TrendingUp, Zap, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { DbAlertRule, DbAlertEvent } from "@/lib/db";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AlertsResponse {
  rules: DbAlertRule[];
  events: DbAlertEvent[];
}

// ── Metric helpers ────────────────────────────────────────────────────────────

const METRIC_META: Record<string, { label: string; unit: string; description: string; icon: React.ElementType }> = {
  failure_rate:    { label: "Failure Rate",      unit: "%",  description: "Alert when failure rate exceeds threshold in window", icon: AlertCircle },
  duration_p95:   { label: "Duration P95",       unit: "min", description: "Alert when p95 run duration exceeds threshold",       icon: Clock },
  queue_wait_p95: { label: "Queue Wait P95",     unit: "min", description: "Alert when p95 queue wait exceeds threshold",         icon: TrendingUp },
  success_streak: { label: "Success Streak",     unit: "runs", description: "Alert when consecutive failures exceed threshold",   icon: Zap },
};

const CHANNEL_META: Record<string, { label: string; color: string }> = {
  browser: { label: "Browser",  color: "text-violet-400" },
  slack:   { label: "Slack",    color: "text-green-400" },
  email:   { label: "Email",    color: "text-blue-400" },
};

// ── Rule card ─────────────────────────────────────────────────────────────────

function RuleCard({
  rule,
  onToggle,
  onDelete,
}: {
  rule: DbAlertRule;
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (id: number) => void;
}) {
  const meta = METRIC_META[rule.metric] ?? { label: rule.metric, unit: "", description: "", icon: Bell };
  const channelMeta = CHANNEL_META[rule.channel] ?? { label: rule.channel, color: "text-slate-400" };
  const Icon = meta.icon;

  return (
    <div className={cn(
      "flex items-start gap-4 p-4 rounded-xl border transition-colors",
      rule.enabled
        ? "bg-slate-800/60 border-slate-700/50"
        : "bg-slate-900/40 border-slate-800/50 opacity-60"
    )}>
      <div className={cn(
        "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
        rule.enabled ? "bg-violet-500/20 border border-violet-500/30" : "bg-slate-800 border border-slate-700"
      )}>
        <Icon className={cn("w-4 h-4", rule.enabled ? "text-violet-400" : "text-slate-500")} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white">{meta.label}</span>
          <span className="text-xs text-slate-500 font-mono">{rule.scope}</span>
          <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded-full bg-slate-700/50", channelMeta.color)}>
            {channelMeta.label}
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">{meta.description}</p>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
          <span>Threshold: <span className="text-slate-300 font-mono">{rule.threshold}{meta.unit}</span></span>
          <span>Window: <span className="text-slate-300">{rule.window_hours}h</span></span>
          {rule.destination && (
            <span className="truncate max-w-[200px]" title={rule.destination}>→ {rule.destination}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onToggle(rule.id, !rule.enabled)}
          className="text-slate-500 hover:text-violet-400 transition-colors"
          title={rule.enabled ? "Disable" : "Enable"}
        >
          {rule.enabled
            ? <ToggleRight className="w-5 h-5 text-violet-400" />
            : <ToggleLeft className="w-5 h-5" />}
        </button>
        <button
          onClick={() => onDelete(rule.id)}
          className="text-slate-600 hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: DbAlertEvent }) {
  const meta = METRIC_META[event.metric];
  const label = meta?.label ?? event.metric;
  const unit = meta?.unit ?? "";

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-800/60 last:border-0">
      <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-300">
          <span className="text-white font-medium">{label}</span>{" "}
          alert fired for <span className="font-mono text-slate-400">{event.scope}</span>
          {event.value !== null && (
            <span> — value: <span className="text-amber-300">{event.value}{unit}</span></span>
          )}
        </p>
      </div>
      <span className="text-[11px] text-slate-500 shrink-0">
        {formatDistanceToNow(new Date(event.fired_at))} ago
      </span>
    </div>
  );
}

// ── Create rule form ──────────────────────────────────────────────────────────

function CreateRuleForm({ onCreated }: { onCreated: () => void }) {
  const [scope, setScope] = useState("");
  const [metric, setMetric] = useState("failure_rate");
  const [threshold, setThreshold] = useState("20");
  const [windowHours, setWindowHours] = useState("24");
  const [channel, setChannel] = useState("browser");
  const [destination, setDestination] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scope.trim() || !threshold) return;
    setSaving(true);
    setError(null);
    try {
      const scopeValue = scope.trim().includes("/")
        ? `repo:${scope.trim()}`
        : `org:${scope.trim()}`;
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: scopeValue,
          metric,
          threshold: Number(threshold),
          window_hours: Number(windowHours),
          channel,
          destination: destination.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to create rule");
      }
      setScope("");
      setThreshold("20");
      setDestination("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  const needsDestination = channel === "slack" || channel === "email";

  return (
    <form onSubmit={handleSubmit} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
        <Plus className="w-4 h-4 text-violet-400" /> New Alert Rule
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Repository (scope)</label>
          <RepoPicker
            value={scope}
            onChange={setScope}
            placeholder="Pick a repository…"
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Metric</label>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500/40 cursor-pointer"
          >
            {Object.entries(METRIC_META).map(([key, m]) => (
              <option key={key} value={key}>{m.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Threshold ({METRIC_META[metric]?.unit ?? ""})
          </label>
          <input
            required
            type="number"
            min="0"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Window (hours)</label>
          <input
            required
            type="number"
            min="1"
            max="168"
            value={windowHours}
            onChange={(e) => setWindowHours(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Channel</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500/40 cursor-pointer"
          >
            <option value="browser">Browser</option>
            <option value="slack">Slack</option>
            <option value="email">Email</option>
          </select>
        </div>

        {needsDestination && (
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {channel === "slack" ? "Slack Webhook URL" : "Email Address"}
            </label>
            <input
              placeholder={channel === "slack" ? "https://hooks.slack.com/…" : "you@example.com"}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            />
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving || !scope.trim()}
        className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? "Creating…" : "Create Rule"}
      </button>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const { mode } = useAuth();
  const isStandalone = mode === "standalone";

  const { data, isLoading, mutate } = useSWR<AlertsResponse>(
    isStandalone ? null : "/api/alerts?events=1",
    fetcher<AlertsResponse>,
    { revalidateOnFocus: false }
  );

  async function handleToggle(id: number, enabled: boolean) {
    await fetch(`/api/alerts?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    mutate();
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this alert rule?")) return;
    await fetch(`/api/alerts?id=${id}`, { method: "DELETE" });
    mutate();
  }

  const rules = data?.rules ?? [];
  const events = data?.events ?? [];

  if (isStandalone) {
    return (
      <div className="p-8 space-y-6">
        <Breadcrumb items={[{ label: "Alerts" }]} />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <Bell className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Alert Rules</h1>
            <p className="text-sm text-slate-400">Define thresholds — alerts are evaluated when runs are synced to DB</p>
          </div>
        </div>
        <div className="flex items-start gap-4 px-5 py-4 bg-amber-500/8 border border-amber-500/20 rounded-xl">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-300">
              Not available in standalone mode
            </p>
            <p className="text-xs text-amber-500/80">
              Alert rules require a PostgreSQL database and GitHub OAuth. Switch to organization mode,
              configure a GitHub OAuth App, and set a <span className="font-mono">DATABASE_URL</span> to use this feature.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <Breadcrumb items={[{ label: "Alerts" }]} />

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
          <Bell className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Alert Rules</h1>
          <p className="text-sm text-slate-400">Define thresholds — alerts are evaluated when runs are synced to DB</p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 px-4 py-3 bg-blue-500/8 border border-blue-500/20 rounded-xl">
        <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300/80 space-y-0.5">
          <p className="font-medium text-blue-300">How alerts work</p>
          <p>Rules are evaluated each time a repo sync runs via <span className="font-mono">POST /api/db/sync</span>. Browser alerts display here; Slack/email webhooks fire in real time.</p>
        </div>
      </div>

      {/* Create form */}
      <CreateRuleForm onCreated={() => mutate()} />

      {/* Existing rules */}
      <div>
        <h2 className="text-sm font-semibold text-white mb-3">
          Active Rules ({rules.length})
        </h2>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl skeleton" />
            ))}
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-10 text-slate-600 text-sm">
            No alert rules yet — create one above.
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent events */}
      {events.length > 0 && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Recent Alert Events</h2>
            <span className="ml-auto text-xs text-slate-500">{events.length} events</span>
          </div>
          <div className="divide-y divide-slate-800/60">
            {events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
