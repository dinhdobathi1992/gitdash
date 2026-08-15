/**
 * GitHub security alerts (v4.2.0) — Dependabot, code scanning, secret scanning.
 *
 * The existing Security page statically analyses workflow YAML for
 * anti-patterns. Useful, but it means a page called "Security" showed none of
 * GitHub's own findings. This module adds those.
 *
 * ── Access is the hard part ───────────────────────────────────────────────
 * All three endpoints need the `security_events` scope, which GitDash has
 * never asked for — so most existing tokens will 403 here. That is not an
 * error state to bury: each source reports its own status so the UI can say
 * "your token can't read this, here's how to fix it" instead of showing an
 * empty list that looks like good news.
 *
 * An empty result and an inaccessible result must never look the same on a
 * security page.
 */

import { getOctokit } from "@/lib/github";

export type AlertSeverity = "critical" | "high" | "medium" | "low";
export type AlertSource = "dependabot" | "code_scanning" | "secret_scanning";

/**
 * Why a source has no data. Distinguishing these is the whole point:
 * "clean" is good news, "forbidden" and "not_enabled" are not.
 */
export type SourceStatus = "ok" | "forbidden" | "not_enabled" | "error";

export interface SecurityAlert {
  source: AlertSource;
  /** GitHub's alert number, unique per repo per source. */
  number: number;
  severity: AlertSeverity;
  title: string;
  /** Package, rule id, or secret type — whatever identifies the finding. */
  subject: string;
  created_at: string;
  age_days: number;
  html_url: string;
}

export interface SourceResult {
  status: SourceStatus;
  open_count: number;
  /** Null when the source was not readable. */
  fixed_last_90d: number | null;
  /** Mean days from open to fix over the last 90 days. Null when no fixes. */
  mttr_days: number | null;
}

export interface SecurityAlertsResponse {
  repo: string;
  sources: Record<AlertSource, SourceResult>;
  /** Open alerts across all readable sources, worst-first then oldest-first. */
  alerts: SecurityAlert[];
  counts: Record<AlertSeverity, number>;
  total_open: number;
  /** Age in days of the oldest open alert, or null when there are none. */
  oldest_open_days: number | null;
  /** True when at least one source could not be read — the UI must say so. */
  partial: boolean;
  /** True when any source returned 403 — actionable: the token needs a scope. */
  needs_scope: boolean;
}

const MAX_ALERTS_RETURNED = 50;
const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/** Map GitHub's several severity vocabularies onto one scale. */
function normaliseSeverity(raw: string | null | undefined): AlertSeverity {
  switch ((raw ?? "").toLowerCase()) {
    case "critical": return "critical";
    case "high": case "error": return "high";
    case "medium": case "moderate": case "warning": return "medium";
    default: return "low";
  }
}

/** Classify a failure so the UI can distinguish "can't read" from "nothing found". */
function statusFromError(e: unknown): SourceStatus {
  const status = (e as { status?: number })?.status;
  if (status === 403) return "forbidden";
  // 404 here means the feature is off for this repo (or the repo is private
  // without Advanced Security) — not an error worth alarming anyone about.
  if (status === 404) return "not_enabled";
  return "error";
}

interface RawAlert {
  number: number;
  state: string;
  created_at: string;
  html_url?: string;
  fixed_at?: string | null;
  updated_at?: string;
}

/** Mean days-to-fix across alerts resolved in the window. */
function computeMttr(fixed: { created_at: string; fixed_at: string }[]): number | null {
  if (fixed.length === 0) return null;
  const total = fixed.reduce(
    (sum, a) =>
      sum + (new Date(a.fixed_at).getTime() - new Date(a.created_at).getTime()) / 86_400_000,
    0,
  );
  return Math.round((total / fixed.length) * 10) / 10;
}

const NINETY_DAYS_MS = 90 * 86_400_000;
const isRecent = (iso: string) => Date.now() - new Date(iso).getTime() <= NINETY_DAYS_MS;

export async function getSecurityAlerts(
  token: string,
  owner: string,
  repo: string,
): Promise<SecurityAlertsResponse> {
  const octokit = getOctokit(token);

  const [depRes, codeRes, secretRes] = await Promise.allSettled([
    octokit.rest.dependabot.listAlertsForRepo({ owner, repo, per_page: 100, state: "open" }),
    octokit.rest.codeScanning.listAlertsForRepo({ owner, repo, per_page: 100, state: "open" }),
    octokit.rest.secretScanning.listAlertsForRepo({ owner, repo, per_page: 100, state: "open" }),
  ]);

  // Resolved alerts power MTTR. Fetched separately and best-effort — a failure
  // here costs a metric, not the page.
  const [depFixed, codeFixed, secretFixed] = await Promise.allSettled([
    octokit.rest.dependabot.listAlertsForRepo({ owner, repo, per_page: 100, state: "fixed" }),
    octokit.rest.codeScanning.listAlertsForRepo({ owner, repo, per_page: 100, state: "fixed" }),
    octokit.rest.secretScanning.listAlertsForRepo({ owner, repo, per_page: 100, state: "resolved" }),
  ]);

  const alerts: SecurityAlert[] = [];
  const sources = {} as Record<AlertSource, SourceResult>;

  // ── Dependabot ──────────────────────────────────────────────────────────
  if (depRes.status === "fulfilled") {
    const open = depRes.value.data as unknown as (RawAlert & {
      security_advisory?: { severity?: string; summary?: string; cve_id?: string | null };
      dependency?: { package?: { name?: string } };
    })[];
    for (const a of open) {
      alerts.push({
        source: "dependabot",
        number: a.number,
        severity: normaliseSeverity(a.security_advisory?.severity),
        title: a.security_advisory?.summary ?? a.security_advisory?.cve_id ?? "Vulnerable dependency",
        subject: a.dependency?.package?.name ?? "unknown package",
        created_at: a.created_at,
        age_days: daysSince(a.created_at),
        html_url: a.html_url ?? "",
      });
    }
    const fixed =
      depFixed.status === "fulfilled"
        ? (depFixed.value.data as unknown as RawAlert[])
            .filter((a) => a.fixed_at && isRecent(a.fixed_at))
            .map((a) => ({ created_at: a.created_at, fixed_at: a.fixed_at! }))
        : [];
    sources.dependabot = {
      status: "ok",
      open_count: open.length,
      fixed_last_90d: depFixed.status === "fulfilled" ? fixed.length : null,
      mttr_days: computeMttr(fixed),
    };
  } else {
    sources.dependabot = {
      status: statusFromError(depRes.reason),
      open_count: 0, fixed_last_90d: null, mttr_days: null,
    };
  }

  // ── Code scanning ───────────────────────────────────────────────────────
  if (codeRes.status === "fulfilled") {
    const open = codeRes.value.data as unknown as (RawAlert & {
      rule?: { security_severity_level?: string | null; severity?: string | null; description?: string; id?: string };
    })[];
    for (const a of open) {
      alerts.push({
        source: "code_scanning",
        number: a.number,
        // security_severity_level is the meaningful one; rule.severity is
        // note/warning/error, which is about confidence, not impact.
        severity: normaliseSeverity(a.rule?.security_severity_level ?? a.rule?.severity),
        title: a.rule?.description ?? "Code scanning finding",
        subject: a.rule?.id ?? "rule",
        created_at: a.created_at,
        age_days: daysSince(a.created_at),
        html_url: a.html_url ?? "",
      });
    }
    const fixed =
      codeFixed.status === "fulfilled"
        ? (codeFixed.value.data as unknown as RawAlert[])
            .filter((a) => a.updated_at && isRecent(a.updated_at))
            .map((a) => ({ created_at: a.created_at, fixed_at: a.updated_at! }))
        : [];
    sources.code_scanning = {
      status: "ok",
      open_count: open.length,
      fixed_last_90d: codeFixed.status === "fulfilled" ? fixed.length : null,
      mttr_days: computeMttr(fixed),
    };
  } else {
    sources.code_scanning = {
      status: statusFromError(codeRes.reason),
      open_count: 0, fixed_last_90d: null, mttr_days: null,
    };
  }

  // ── Secret scanning ─────────────────────────────────────────────────────
  if (secretRes.status === "fulfilled") {
    const open = secretRes.value.data as unknown as (RawAlert & {
      secret_type_display_name?: string; secret_type?: string;
    })[];
    for (const a of open) {
      alerts.push({
        source: "secret_scanning",
        number: a.number,
        // A live leaked credential has no severity field and needs no triage
        // discussion — it is always the most urgent thing on the page.
        severity: "critical",
        title: "Exposed secret detected",
        subject: a.secret_type_display_name ?? a.secret_type ?? "secret",
        created_at: a.created_at,
        age_days: daysSince(a.created_at),
        html_url: a.html_url ?? "",
      });
    }
    const fixed =
      secretFixed.status === "fulfilled"
        ? (secretFixed.value.data as unknown as RawAlert[])
            .filter((a) => a.updated_at && isRecent(a.updated_at))
            .map((a) => ({ created_at: a.created_at, fixed_at: a.updated_at! }))
        : [];
    sources.secret_scanning = {
      status: "ok",
      open_count: open.length,
      fixed_last_90d: secretFixed.status === "fulfilled" ? fixed.length : null,
      mttr_days: computeMttr(fixed),
    };
  } else {
    sources.secret_scanning = {
      status: statusFromError(secretRes.reason),
      open_count: 0, fixed_last_90d: null, mttr_days: null,
    };
  }

  alerts.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.age_days - a.age_days,
  );

  const counts: Record<AlertSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const a of alerts) counts[a.severity]++;

  const statuses = Object.values(sources).map((s) => s.status);

  return {
    repo: `${owner}/${repo}`,
    sources,
    alerts: alerts.slice(0, MAX_ALERTS_RETURNED),
    counts,
    total_open: alerts.length,
    oldest_open_days: alerts.length ? Math.max(...alerts.map((a) => a.age_days)) : null,
    partial: statuses.some((s) => s !== "ok"),
    needs_scope: statuses.includes("forbidden"),
  };
}
