/**
 * Plain-language alert copy and "firing now" derivation, shared by the
 * sidebar badge, the top-bar bell, the home attention list and /alerts.
 *
 * Client-safe: no server imports. Units match the values the evaluator
 * stores (see METRIC_LABELS in src/lib/notifier.ts).
 */

export interface AlertEventLike {
  id: number;
  rule_id: number | null;
  scope: string;
  metric: string;
  value: number | null;
  fired_at: string;
}

export interface AlertRuleLike {
  id: number;
  scope: string;
  metric: string;
  threshold: number;
  window_hours: number;
  channel: string;
  destination: string | null;
  enabled: boolean;
  muted_until: string | null;
}

export type AlertKind = "failure" | "duration" | "queue" | "review" | "people" | "digest";

export const METRIC_COPY: Record<string, { name: string; unit: string; kind: AlertKind }> = {
  failure_rate: { name: "Failure rate", unit: "%", kind: "failure" },
  success_streak: { name: "Failure streak", unit: " runs", kind: "failure" },
  duration_p95: { name: "p95 duration", unit: " min", kind: "duration" },
  queue_wait_p95: { name: "Queue wait p95", unit: " min", kind: "queue" },
  anomaly_count: { name: "Anomalous runs", unit: " runs", kind: "duration" },
  pr_throughput_drop: { name: "Pull request throughput drop", unit: "%", kind: "review" },
  review_response_p90: { name: "Review response p90", unit: " h", kind: "review" },
  unreviewed_pr_age: { name: "Unreviewed pull request age", unit: " days", kind: "review" },
  pr_abandon_rate: { name: "Pull request abandon rate", unit: "%", kind: "review" },
  afterhours_commit_pct: { name: "After-hours commits", unit: "%", kind: "people" },
  oversized_commit_pct: { name: "Oversized commits", unit: "%", kind: "people" },
  leadership_digest: { name: "Weekly leadership digest", unit: "", kind: "digest" },
};

export function metricCopy(metric: string) {
  return METRIC_COPY[metric] ?? { name: metric.replace(/_/g, " "), unit: "", kind: "failure" as AlertKind };
}

/** "repo:owner/name" → "name"; "org:acme" → "acme"; "*" → "all repositories". */
export function scopeLabel(scope: string): string {
  if (scope === "*" || scope === "global") return "All repositories";
  if (scope.startsWith("repo:")) return scope.slice(5).split("/").pop() ?? scope;
  if (scope.startsWith("org:")) return scope.slice(4);
  return scope;
}

export function scopeHref(scope: string): string | null {
  if (!scope.startsWith("repo:")) return null;
  const [owner, ...rest] = scope.slice(5).split("/");
  return owner && rest.length ? `/repos/${owner}/${rest.join("/")}` : null;
}

/**
 * Postgres NUMERIC columns (threshold, value) arrive as strings from the
 * Neon driver, so coerce before formatting.
 */
function fmtValue(v: number | string | null | undefined, unit: string): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${Number.isInteger(n) ? String(n) : n.toFixed(1)}${unit}`;
}

/** Title that says what is wrong: "Failure rate is 33% on tesda-backend". */
export function alertTitle(e: Pick<AlertEventLike, "metric" | "value" | "scope">): string {
  const m = metricCopy(e.metric);
  return `${m.name} is ${fmtValue(e.value, m.unit)} on ${scopeLabel(e.scope)}`;
}

/** Rule sentence: "Failure rate above 20% in 24 hours". */
export function ruleSentence(r: Pick<AlertRuleLike, "metric" | "threshold" | "window_hours">): string {
  const m = metricCopy(r.metric);
  if (r.metric === "leadership_digest") return m.name;
  return `${m.name} above ${fmtValue(r.threshold, m.unit)} in ${r.window_hours} hours`;
}

/** Threshold phrase only: "above 20% in 24 hours". */
export function ruleThreshold(r: Pick<AlertRuleLike, "metric" | "threshold" | "window_hours">): string {
  const m = metricCopy(r.metric);
  return `above ${fmtValue(r.threshold, m.unit)} in ${r.window_hours} hours`;
}

export function channelLabel(r: Pick<AlertRuleLike, "channel" | "destination">): string {
  const ch = r.channel === "slack" ? "Slack" : r.channel === "email" ? "Email" : r.channel === "digest" ? "Digest" : "Browser";
  if (!r.destination || r.channel === "browser") return ch;
  // Never echo a full webhook URL — it is a credential.
  if (r.channel === "slack") return `${ch} · webhook`;
  return `${ch} · ${r.destination}`;
}

export interface FiringAlert {
  key: string;
  event: AlertEventLike;
  rule: AlertRuleLike | null;
  title: string;
  kind: AlertKind;
  href: string | null;
}

/**
 * Firing now = the newest event per scope+metric fired inside its rule's
 * window (24 h when the rule is unknown), whose rule is enabled and not muted.
 */
export function firingAlerts(events: AlertEventLike[], rules: AlertRuleLike[], now: number): FiringAlert[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: FiringAlert[] = [];
  const sorted = [...events].sort((a, b) => new Date(b.fired_at).getTime() - new Date(a.fired_at).getTime());
  for (const e of sorted) {
    if (e.metric === "leadership_digest") continue;
    const key = `${e.scope}:${e.metric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rule = e.rule_id !== null ? byId.get(e.rule_id) ?? null : null;
    if (rule && !rule.enabled) continue;
    if (rule?.muted_until && new Date(rule.muted_until).getTime() > now) continue;
    const windowMs = (rule?.window_hours ?? 24) * 3_600_000;
    if (now - new Date(e.fired_at).getTime() > windowMs) continue;
    out.push({ key, event: e, rule, title: alertTitle(e), kind: metricCopy(e.metric).kind, href: scopeHref(e.scope) });
  }
  return out;
}
