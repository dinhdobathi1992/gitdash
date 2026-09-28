"use client";

/**
 * Alerts — `Alerts` artboard, contract §9.
 * "Firing now" rows with Mute 1h + Investigate · rules list with switches ·
 * new-rule form in a side panel with a plain-language preview sentence ·
 * delivery history. Rule changes are admin-only in organization mode;
 * everyone can see rules and the alerts they fire.
 */

import { useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Send, CircleX, Clock, Layers, GitPullRequest, Users, Mail, X } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { RepoPicker } from "@/components/RepoPicker";
import { cn, formatRelative } from "@/lib/utils";
import { useAlerts } from "@/lib/use-alerts";
import {
  METRIC_COPY, alertTitle, channelLabel, metricCopy, ruleSentence, ruleThreshold, scopeLabel,
  type AlertKind, type AlertRuleLike,
} from "@/lib/alert-copy";
import { Page, PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ErrorBanner } from "@/components/ui/Card";

const KIND_ICON: Record<AlertKind, { icon: React.ComponentType<{ className?: string }>; box: string }> = {
  failure: { icon: CircleX, box: "bg-status-fail-tint text-status-fail-text" },
  duration: { icon: Clock, box: "bg-status-warn-tint text-status-warn-text" },
  queue: { icon: Layers, box: "bg-status-warn-tint text-status-warn-text" },
  review: { icon: GitPullRequest, box: "bg-status-run-tint text-status-run-text" },
  people: { icon: Users, box: "bg-status-run-tint text-status-run-text" },
  digest: { icon: Mail, box: "bg-status-neutral-tint text-status-neutral-text" },
};

const DESCRIPTIONS: Record<string, string> = {
  failure_rate: "Share of runs that fail",
  duration_p95: "95th-percentile run duration",
  queue_wait_p95: "95th-percentile wait for a runner",
  success_streak: "Consecutive failed runs",
  anomaly_count: "Runs more than two standard deviations off the rolling baseline",
  pr_throughput_drop: "Drop in merged pull requests against the prior window",
  review_response_p90: "90th-percentile time to first review",
  afterhours_commit_pct: "Share of commits made after hours",
  oversized_commit_pct: "Share of commits in merged pull requests over the size limit (files or lines). Needs 5+ commits and a fully analysed window. An organization-wide rule reports the first repository that breaches in a window",
  pr_abandon_rate: "Pull requests closed without merging",
  unreviewed_pr_age: "Business days an open pull request has waited for review",
  leadership_digest: "Every Monday, an org-wide summary of health, trends and what needs attention",
};

const WINDOWS = [
  { hours: 1, label: "1 hour" },
  { hours: 6, label: "6 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];

type Channel = "slack" | "email" | "browser" | "digest";

const field = "w-full h-[38px] px-3 rounded-control bg-panel border border-control-strong text-sm text-fg placeholder:text-faint focus:outline-none focus:border-brand-fg";

function NewRulePanel({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [scope, setScope] = useState("");
  const [metric, setMetric] = useState("failure_rate");
  const [threshold, setThreshold] = useState("20");
  const [windowHours, setWindowHours] = useState(24);
  const [channel, setChannel] = useState<Channel>("slack");
  const [destination, setDestination] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digest = metric === "leadership_digest";
  const m = metricCopy(metric);
  const needsDestination = channel !== "browser";
  const repoName = scope.split("/").pop();

  const preview = digest
    ? `Every Monday, ${scope || "the organization"} gets the leadership digest by ${channel === "slack" ? "Slack" : "email"}.`
    : `You will be alerted ${channel === "browser" ? "in this browser" : channel === "slack" ? "in Slack" : channel === "digest" ? "in the daily email digest" : `at ${destination || "that address"}`} when the ${m.name.toLowerCase()} on ${repoName || "the repository"} goes above ${threshold || "…"}${m.unit} within ${WINDOWS.find((w) => w.hours === windowHours)?.label ?? `${windowHours} hours`}.`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!scope.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const s = scope.trim();
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: s.includes("/") ? `repo:${s}` : `org:${s}`,
          metric,
          threshold: digest ? 0 : Number(threshold),
          window_hours: digest ? 168 : windowHours,
          channel,
          destination: destination.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't create the rule");
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the rule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="new-rule-title" className="card !rounded-[16px] p-6 flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="new-rule-title" className="text-lg font-semibold text-fg">New alert rule</h2>
          <p className="mt-1 text-[13px] text-muted">Get told when a number crosses a line you set.</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="text-muted hover:text-fg -mr-2 -mt-1">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-fg" htmlFor={digest ? "rule-org" : undefined}>{digest ? "Organization" : "Watch"}</label>
        {digest ? (
          <input id="rule-org" required value={scope} onChange={(e) => setScope(e.target.value)} placeholder="org-name" className={cn(field, "font-mono")} />
        ) : (
          <RepoPicker value={scope} onChange={setScope} label="Repository to watch" className="[&>button]:h-[38px] [&>button]:text-sm" />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="rule-metric" className="text-sm font-medium text-fg">Metric</label>
        <select
          id="rule-metric"
          value={metric}
          onChange={(e) => {
            const next = e.target.value;
            setMetric(next);
            if (next === "leadership_digest") {
              setChannel((c) => (c === "slack" ? "slack" : "email"));
              setScope((s) => (s.includes("/") ? "" : s));
            } else if (metric === "leadership_digest") {
              setChannel("slack");
              setScope("");
            }
          }}
          className={field}
        >
          <optgroup label="Runs">
            {["failure_rate", "duration_p95", "queue_wait_p95", "success_streak", "anomaly_count"].map((k) => <option key={k} value={k}>{METRIC_COPY[k].name}</option>)}
          </optgroup>
          <optgroup label="People">
            {["pr_throughput_drop", "review_response_p90", "afterhours_commit_pct", "pr_abandon_rate", "unreviewed_pr_age", "oversized_commit_pct"].map((k) => <option key={k} value={k}>{METRIC_COPY[k].name}</option>)}
          </optgroup>
          <optgroup label="Leadership">
            <option value="leadership_digest">{METRIC_COPY.leadership_digest.name}</option>
          </optgroup>
        </select>
        <p className="text-xs text-muted">{DESCRIPTIONS[metric]}</p>
      </div>

      {!digest && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rule-threshold" className="text-sm font-medium text-fg">Goes above</label>
            <div className="relative">
              <input id="rule-threshold" required type="number" min="0" value={threshold} onChange={(e) => setThreshold(e.target.value)} className={cn(field, "font-mono pr-12")} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-faint">{m.unit.trim()}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rule-window" className="text-sm font-medium text-fg">Within</label>
            <select id="rule-window" value={windowHours} onChange={(e) => setWindowHours(Number(e.target.value))} className={field}>
              {WINDOWS.map((w) => <option key={w.hours} value={w.hours}>{w.label}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg" id="send-to">Send to</span>
        <SegmentedControl
          label="Send to"
          size="lg"
          value={channel}
          onChange={(c) => setChannel(c)}
          className="w-full"
          options={
            digest
              ? [{ value: "email", label: "Email" }, { value: "slack", label: "Slack" }]
              : [{ value: "slack", label: "Slack" }, { value: "email", label: "Email" }, { value: "browser", label: "Browser" }, { value: "digest", label: "Digest" }]
          }
        />
        {channel === "digest" && <p className="text-xs text-muted">Bundled into one email a day instead of one message per alert.</p>}
      </div>

      {needsDestination && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rule-dest" className="text-sm font-medium text-fg">{channel === "slack" ? "Slack webhook URL" : "Email address"}</label>
          <input
            id="rule-dest"
            required={digest || channel === "slack" || channel === "email"}
            type={channel === "slack" ? "url" : "email"}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={channel === "slack" ? "https://hooks.slack.com/services/…" : "team@example.com"}
            className={cn(field, "font-mono")}
          />
        </div>
      )}

      <p className="px-4 py-3 rounded-control bg-brand-soft/60 border border-brand-fg/20 text-[13px] leading-5 text-violet-100">{preview}</p>

      {error && <ErrorBanner message={error} />}

      <div className="flex items-center justify-end gap-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={saving || !scope.trim()}>{saving ? "Creating…" : "Create rule"}</Button>
      </div>
    </form>
  );
}

function RuleRow({ rule, canEdit, onToggle, onDelete, onTest, testState, now }: {
  rule: AlertRuleLike;
  now: number;
  canEdit: boolean;
  onToggle: (r: AlertRuleLike) => void;
  onDelete: (r: AlertRuleLike) => void;
  onTest: (r: AlertRuleLike) => void;
  testState?: "sending" | "sent" | "failed";
}) {
  const sentence = ruleSentence(rule);
  const muted = rule.muted_until && new Date(rule.muted_until).getTime() > now;
  return (
    <li className="flex items-center gap-4 px-5 py-4 border-b border-line last:border-0">
      {canEdit ? (
        <Switch checked={rule.enabled} onChange={() => onToggle(rule)} label={`${rule.enabled ? "Turn off" : "Turn on"}: ${sentence}`} />
      ) : (
        <span className={cn("text-xs font-medium w-9", rule.enabled ? "text-status-pass-text" : "text-faint")}>{rule.enabled ? "On" : "Off"}</span>
      )}
      <div className={cn("flex-1 min-w-0", !rule.enabled && "opacity-60")}>
        <p className="text-sm font-medium text-fg truncate">{sentence}</p>
        <p className="text-[13px] text-muted truncate">
          {rule.metric === "leadership_digest" ? `Mondays · ${scopeLabel(rule.scope)}` : scopeLabel(rule.scope)}
          {muted && <span className="text-status-warn-text"> · muted until {new Date(rule.muted_until!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
        </p>
      </div>
      <span className="hidden md:block w-52 shrink-0 text-[13px] text-muted truncate">{channelLabel(rule)}</span>
      {canEdit && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onTest(rule)}
            disabled={testState === "sending"}
            className="font-medium"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            {testState === "sending" ? "Sending…" : testState === "sent" ? "Sent" : testState === "failed" ? "Failed" : "Send a test"}
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Delete rule: ${sentence}`} onClick={() => onDelete(rule)} className="text-faint hover:text-status-fail-text w-8 h-8">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      )}
    </li>
  );
}

export default function AlertsPage() {
  const { mode, isAdmin } = useAuth();
  const standalone = mode === "standalone";
  const { data, error, isLoading, mutate, firing, now } = useAlerts();
  const [panelOpen, setPanelOpen] = useState(false);
  const [tests, setTests] = useState<Record<number, "sending" | "sent" | "failed">>({});

  const rules = (data?.rules ?? []) as AlertRuleLike[];
  const events = data?.events ?? [];
  const active = rules.filter((r) => r.enabled).length;
  const channels = [...new Set(rules.filter((r) => r.enabled).map((r) => (r.channel === "browser" ? "this browser" : r.channel === "digest" ? "email" : r.channel === "slack" ? "Slack" : "email")))];

  async function patch(id: number, body: Record<string, unknown>) {
    await fetch(`/api/alerts?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    mutate();
  }
  async function remove(r: AlertRuleLike) {
    if (!confirm(`Delete the rule "${ruleSentence(r)}"?`)) return;
    await fetch(`/api/alerts?id=${r.id}`, { method: "DELETE" });
    mutate();
  }
  async function test(r: AlertRuleLike) {
    setTests((t) => ({ ...t, [r.id]: "sending" }));
    try {
      const res = await fetch("/api/alerts/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rule_id: r.id }) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setTests((t) => ({ ...t, [r.id]: res.ok && body.ok ? "sent" : "failed" }));
    } catch {
      setTests((t) => ({ ...t, [r.id]: "failed" }));
    }
  }

  if (standalone) {
    return (
      <Page>
        <PageHeading title="Alerts" meta="Thresholds on your runs and pull requests, delivered to Slack, email or this browser" />
        <p className="card px-5 py-4 text-sm text-muted">
          Alerts need organization mode with a database (<span className="font-mono text-fg">DATABASE_URL</span>) and a GitHub OAuth app. They aren&apos;t available in standalone mode.
        </p>
      </Page>
    );
  }

  const meta = isLoading
    ? "Loading alerts…"
    : [`${firing.length} firing now`, `${active} of ${rules.length} rules active`, channels.length ? `delivered to ${channels.join(", ").replace(/, ([^,]*)$/, " and $1")}` : null].filter(Boolean).join(" · ");

  return (
    <Page>
      <PageHeading
        title="Alerts"
        meta={meta}
        actions={isAdmin && !panelOpen && (
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            <Plus className="w-4 h-4" aria-hidden="true" /> New rule
          </Button>
        )}
      />

      {error && <ErrorBanner message={`Couldn't load alerts: ${(error as Error).message}`} onRetry={() => mutate()} />}

      <div className={cn("grid gap-6 items-start", panelOpen && "xl:grid-cols-[minmax(0,1fr)_400px]")}>
        <div className="flex flex-col gap-7 min-w-0">
          {/* Firing now */}
          <section aria-labelledby="firing-title">
            <h2 id="firing-title" className="text-[15px] font-semibold text-fg mb-3">Firing now</h2>
            <div className="card overflow-hidden">
              {isLoading ? (
                <div className="p-5 space-y-3">{[0, 1].map((i) => <div key={i} className="h-10 rounded skeleton" />)}</div>
              ) : firing.length === 0 ? (
                <p className="px-5 py-4 text-sm text-status-pass-text bg-status-pass-tint">Nothing is firing.</p>
              ) : (
                <ul>
                  {firing.map((f) => {
                    const k = KIND_ICON[f.kind];
                    const Icon = k.icon;
                    return (
                      <li key={f.key} className="flex items-center gap-4 px-5 py-4 border-b border-line last:border-0">
                        <span className={cn("flex items-center justify-center w-8 h-8 rounded-control shrink-0", k.box)}>
                          <Icon className="w-4 h-4" aria-hidden="true" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-fg truncate">{alertTitle(f.event)}</p>
                          <p className="text-[13px] text-muted truncate">
                            {[
                              f.rule ? `Rule: ${ruleThreshold(f.rule)}` : null,
                              f.rule ? `sent to ${channelLabel(f.rule)}` : null,
                              `firing for ${formatRelative(f.event.fired_at, now).replace(/ ago$/, "")}`,
                            ].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isAdmin && f.rule && (
                            <Button size="sm" onClick={() => patch(f.rule!.id, { muted_until: new Date(Date.now() + 3_600_000).toISOString() })}>
                              Mute 1h
                            </Button>
                          )}
                          {f.href && (
                            <Link href={f.href} className="inline-flex items-center h-8 px-3 rounded-control bg-raised text-[13px] font-semibold text-fg hover:bg-raised/70">
                              Investigate
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Rules */}
          <section aria-labelledby="rules-title">
            <div className="flex items-center justify-between mb-3">
              <h2 id="rules-title" className="text-[15px] font-semibold text-fg">Rules</h2>
              {events.length > 0 && <a href="#history" className="text-[13px] font-medium text-link hover:text-violet-200">Delivery history →</a>}
            </div>
            {!isAdmin && <p className="mb-3 text-[13px] text-muted">Admins manage alert rules. You can see the rules and the alerts they fire.</p>}
            <div className="card overflow-hidden">
              {isLoading ? (
                <div className="p-5 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-10 rounded skeleton" />)}</div>
              ) : rules.length === 0 ? (
                <div className="flex items-center justify-between gap-3 px-5 py-4 text-sm text-muted">
                  <span>No alert rules yet.</span>
                  {isAdmin && <Button size="sm" onClick={() => setPanelOpen(true)}>Create one</Button>}
                </div>
              ) : (
                <ul>
                  {rules.map((r) => (
                    <RuleRow
                      key={r.id}
                      rule={r}
                      canEdit={isAdmin}
                      onToggle={(x) => patch(x.id, { enabled: !x.enabled })}
                      onDelete={remove}
                      onTest={test}
                      testState={tests[r.id]}
                      now={now}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Delivery history */}
          {events.length > 0 && (
            <section id="history" aria-labelledby="history-title" className="scroll-mt-20">
              <h2 id="history-title" className="text-[15px] font-semibold text-fg mb-3">Delivery history</h2>
              <ul className="card overflow-hidden">
                {events.slice(0, 20).map((e) => (
                  <li key={e.id} className="flex items-center gap-4 px-5 h-12 border-b border-line last:border-0 text-[13px]">
                    <span className="flex-1 min-w-0 truncate text-fg">{alertTitle(e)}</span>
                    <span className="hidden sm:block w-40 text-muted truncate">
                      {(e as { delivery_status?: string | null }).delivery_status ?? "—"}
                    </span>
                    <span className="w-24 text-right text-faint">{formatRelative(e.fired_at, now)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {panelOpen && isAdmin && (
          <aside className="xl:sticky xl:top-20">
            <NewRulePanel onCreated={() => mutate()} onClose={() => setPanelOpen(false)} />
          </aside>
        )}
      </div>
    </Page>
  );
}
