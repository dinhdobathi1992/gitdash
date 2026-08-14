/**
 * Alert notifier abstraction.
 *
 * Provides a unified interface for delivering alerts through browser (local),
 * Slack (webhook), and email (SMTP via Resend or SMTP env vars) channels.
 * Each provider is a pure function; no state is held here.
 */

import type { DbAlertRule } from "./db";
import { unseal } from "./secret-box";
import { withCache, cacheDelete } from "./cache";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AlertPayload {
  rule: DbAlertRule;
  repo: string;
  value: number;
  metricLabel: string;
  metricUnit: string;
  triggeredAt: string;
  eventId?: number;
}

export type DeliveryResult =
  | { ok: true }
  | { ok: false; error: string };

// ── Metric label map ──────────────────────────────────────────────────────────

export const METRIC_LABELS: Record<string, { label: string; unit: string }> = {
  failure_rate:           { label: "Failure Rate",          unit: "%" },
  duration_p95:           { label: "Duration P95",          unit: " min" },
  queue_wait_p95:         { label: "Queue Wait P95",        unit: " min" },
  success_streak:         { label: "Failure Streak",        unit: " runs" },
  pr_throughput_drop:     { label: "PR Throughput Drop",    unit: "%" },
  review_response_p90:    { label: "Review Response P90",   unit: " hrs" },
  afterhours_commit_pct:  { label: "After-Hours Commits",   unit: "%" },
  pr_abandon_rate:        { label: "PR Abandon Rate",       unit: "%" },
  unreviewed_pr_age:      { label: "Unreviewed PR Age",     unit: " days" },
  anomaly_count:          { label: "Statistical Anomalies", unit: " runs" },
  leadership_digest:      { label: "Weekly Leadership Digest", unit: "" },
};

export function buildPayload(
  rule: DbAlertRule,
  repo: string,
  value: number,
  eventId?: number,
): AlertPayload {
  const meta = METRIC_LABELS[rule.metric] ?? { label: rule.metric, unit: "" };
  return {
    rule,
    repo,
    value,
    metricLabel: meta.label,
    metricUnit: meta.unit,
    triggeredAt: new Date().toISOString(),
    eventId,
  };
}

// ── Browser / local delivery (no-op server-side, UI-handled) ─────────────────

/**
 * Browser notifications are handled on the client side via the Web Notifications
 * API. Server-side we record the event and return ok — the client polls
 * alert_events and shows the browser notification.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function deliverBrowser(_payload: AlertPayload): Promise<DeliveryResult> {
  return { ok: true };
}

// ── Slack delivery ────────────────────────────────────────────────────────────

export async function deliverSlack(payload: AlertPayload): Promise<DeliveryResult> {
  const { rule, repo, value, metricLabel, metricUnit, triggeredAt } = payload;
  if (!rule.destination) {
    return { ok: false, error: "No Slack webhook URL configured" };
  }

  const text =
    `*GitDash Alert* — \`${repo}\`\n` +
    `*${metricLabel}* exceeded threshold\n` +
    `Value: *${value}${metricUnit}* (threshold: ${rule.threshold}${metricUnit})\n` +
    `Window: ${rule.window_hours}h — triggered at ${triggeredAt}`;

  const body = JSON.stringify({
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  });

  try {
    const res = await fetch(rule.destination, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      return { ok: false, error: `Slack webhook returned ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ── Email provider resolution (v4.1.3) ────────────────────────────────────────

export interface ResolvedEmailProvider {
  provider: "resend" | "sendgrid";
  apiKey: string;
  from: string;
  /** Where the config came from — surfaced in Settings and the test endpoint. */
  source: "settings" | "env";
}

const DEFAULT_FROM = "alerts@gitdash.app";
const PROVIDER_CACHE_TTL = 30; // seconds — digests send in a loop

/**
 * Resolve which provider to send through: database settings first, then
 * environment variables.
 *
 * The precedence matters for upgrades. An instance that already had
 * RESEND_API_KEY set keeps working untouched after v4.1.3; the database only
 * takes over once someone explicitly enables email in Settings.
 *
 * The db import is dynamic on purpose: src/lib/db.ts imports this module, so a
 * static import here would close a cycle. It is also genuinely lazy — nothing
 * touches the database unless an email is actually being sent.
 */
export async function resolveEmailProvider(): Promise<ResolvedEmailProvider | null> {
  const fromSettings = await withCache<ResolvedEmailProvider | null>(
    "email-provider:settings",
    PROVIDER_CACHE_TTL,
    async () => {
      try {
        const { getEmailSettings } = await import("./db");
        const s = await getEmailSettings();
        if (!s || !s.enabled || !s.api_key_sealed) return null;

        const apiKey = unseal(s.api_key_sealed);
        if (!apiKey) {
          // Sealed with a different SESSION_SECRET, or corrupted. Fall through
          // to env rather than failing outright, and say so in the log — this
          // is the one case an operator genuinely needs to know about.
          console.error(
            "[notifier] Stored email credential could not be decrypted — re-enter it in Settings.",
          );
          return null;
        }
        return {
          provider: s.provider,
          apiKey,
          from: s.from_address || DEFAULT_FROM,
          source: "settings" as const,
        };
      } catch {
        // No DATABASE_URL, or the table is not reachable. Env fallback covers it.
        return null;
      }
    },
  );

  if (fromSettings) return fromSettings;

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    return {
      provider: "resend",
      apiKey: resendKey,
      from: process.env.RESEND_FROM ?? DEFAULT_FROM,
      source: "env",
    };
  }

  const sendgridKey = process.env.SMTP_PASS ?? process.env.SENDGRID_API_KEY;
  if (process.env.SMTP_HOST && sendgridKey) {
    return {
      provider: "sendgrid",
      apiKey: sendgridKey,
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? DEFAULT_FROM,
      source: "env",
    };
  }

  return null;
}

/** Invalidate the provider cache after a Settings save. */
export function invalidateEmailProviderCache(): void {
  cacheDelete("email-provider:settings");
}

const NO_PROVIDER_ERROR =
  "No email provider configured. Enable email in Settings, or set RESEND_API_KEY.";

/** Single send path for every email the app produces. */
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<DeliveryResult> {
  const cfg = await resolveEmailProvider();
  if (!cfg) return { ok: false, error: NO_PROVIDER_ERROR };

  return cfg.provider === "resend"
    ? deliverViaResend(to, subject, html, text, cfg.apiKey, cfg.from)
    : deliverViaSendgridCompat(to, subject, text, html, cfg.apiKey, cfg.from);
}

// ── Email delivery ────────────────────────────────────────────────────────────

/**
 * Alert email. Provider selection is centralised in resolveEmailProvider().
 */
export async function deliverEmail(payload: AlertPayload): Promise<DeliveryResult> {
  const { rule, repo, value, metricLabel, metricUnit, triggeredAt } = payload;

  if (!rule.destination) {
    return { ok: false, error: "No email destination configured" };
  }

  const subject = `[GitDash] ${metricLabel} alert — ${repo}`;
  const html = `
    <h2>GitDash Alert</h2>
    <p><strong>Repository:</strong> ${repo}</p>
    <p><strong>Metric:</strong> ${metricLabel}</p>
    <p><strong>Value:</strong> ${value}${metricUnit} (threshold: ${rule.threshold}${metricUnit})</p>
    <p><strong>Window:</strong> ${rule.window_hours} hours</p>
    <p><strong>Triggered at:</strong> ${triggeredAt}</p>
    <hr/>
    <p style="color:#888;font-size:12px">Sent by GitDash alert system. To disable this alert, update the rule in the Alerts page.</p>
  `;
  const text =
    `GitDash Alert — ${repo}\n` +
    `Metric: ${metricLabel}\n` +
    `Value: ${value}${metricUnit} (threshold: ${rule.threshold}${metricUnit})\n` +
    `Window: ${rule.window_hours}h — triggered at ${triggeredAt}`;

  return sendEmail(rule.destination, subject, html, text);
}

async function deliverViaResend(
  to: string,
  subject: string,
  html: string,
  text: string,
  apiKey: string,
  from: string,
): Promise<DeliveryResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend returned ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Minimal SMTP-over-HTTP using SendGrid-compatible API as fallback.
 * Requires SMTP_HOST to equal "https://api.sendgrid.com" or similar.
 * For full SMTP support, inject a server-side mailer (e.g., nodemailer).
 */
async function deliverViaSendgridCompat(
  to: string,
  subject: string,
  text: string,
  html: string,
  apiKey: string,
  from: string,
): Promise<DeliveryResult> {
  // SendGrid's HTTP API base. SMTP_HOST is a legacy name for it — this path
  // has never spoken the SMTP protocol, so a hostname like smtp.gmail.com
  // cannot work here. Settings-based config always supplies the real base URL.
  const host = process.env.SMTP_HOST || "https://api.sendgrid.com";

  try {
    const res = await fetch(`${host}/v3/mail/send`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content: [
          { type: "text/plain", value: text },
          { type: "text/html",  value: html },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `SendGrid returned ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ── Unified dispatch ──────────────────────────────────────────────────────────

/**
 * Dispatches an alert to the appropriate channel based on rule.channel.
 * Never throws — returns a DeliveryResult so callers can update delivery_status.
 */
export async function dispatchAlert(payload: AlertPayload): Promise<DeliveryResult> {
  switch (payload.rule.channel) {
    case "slack":   return deliverSlack(payload);
    case "email":   return deliverEmail(payload);
    // Digest rules don't deliver at fire-time — the event is recorded and
    // picked up by the daily digest send (see sendPendingDigests below).
    case "digest":  return { ok: true };
    case "browser":
    default:        return deliverBrowser(payload);
  }
}

// ── Digest delivery ────────────────────────────────────────────────────────────

export interface DigestItem {
  repo: string;
  metric: string;
  value: number | null;
  fired_at: string;
}

/**
 * Sends one summary email per destination for all pending digest-channel
 * events. Reuses the same Resend/SMTP provider selection as deliverEmail.
 */
export async function deliverDigestEmail(
  to: string,
  items: DigestItem[],
): Promise<DeliveryResult> {
  if (!items.length) return { ok: true };

  const subject = `[GitDash] Daily digest — ${items.length} alert${items.length === 1 ? "" : "s"}`;
  const rows = items
    .map((i) => {
      const meta = METRIC_LABELS[i.metric] ?? { label: i.metric, unit: "" };
      return `<tr><td>${i.repo}</td><td>${meta.label}</td><td>${i.value ?? "—"}${meta.unit}</td><td>${new Date(i.fired_at).toLocaleString()}</td></tr>`;
    })
    .join("\n");
  const html = `
    <h2>GitDash Daily Digest</h2>
    <p>${items.length} alert${items.length === 1 ? "" : "s"} fired in the last 24 hours.</p>
    <table cellpadding="6" style="border-collapse:collapse;width:100%">
      <thead><tr style="text-align:left;border-bottom:1px solid #ccc"><th>Repo</th><th>Metric</th><th>Value</th><th>Fired at</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <hr/>
    <p style="color:#888;font-size:12px">Sent by GitDash alert system. To change digest frequency or disable, update the rule in the Alerts page.</p>
  `;
  const text =
    `GitDash Daily Digest — ${items.length} alerts\n\n` +
    items.map((i) => {
      const meta = METRIC_LABELS[i.metric] ?? { label: i.metric, unit: "" };
      return `${i.repo}: ${meta.label} = ${i.value ?? "—"}${meta.unit} at ${i.fired_at}`;
    }).join("\n");

  return sendEmail(to, subject, html, text);
}

// ── Weekly Leadership Digest (v4.0.3) ──────────────────────────────────────────

export interface LeadershipDigestEmailInput {
  subject: string;
  summary_line: string;
  highlights: string[];
  concerns: string[];
}

export async function deliverLeadershipDigestEmail(
  to: string,
  narrative: LeadershipDigestEmailInput,
): Promise<DeliveryResult> {
  const listHtml = (items: string[]) =>
    items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("\n")}</ul>` : "<p>None this week.</p>";

  const html = `
    <h2>GitDash Weekly Leadership Digest</h2>
    <p>${narrative.summary_line}</p>
    <h3>Highlights</h3>
    ${listHtml(narrative.highlights)}
    <h3>Needs attention</h3>
    ${listHtml(narrative.concerns)}
    <hr/>
    <p style="color:#888;font-size:12px">Sent by GitDash. To stop receiving this, delete the Weekly Leadership Digest rule in the Alerts page.</p>
  `;
  const text =
    `GitDash Weekly Leadership Digest\n\n${narrative.summary_line}\n\n` +
    `Highlights:\n${narrative.highlights.length ? narrative.highlights.map((i) => `- ${i}`).join("\n") : "None this week."}\n\n` +
    `Needs attention:\n${narrative.concerns.length ? narrative.concerns.map((i) => `- ${i}`).join("\n") : "None this week."}`;

  return sendEmail(to, narrative.subject, html, text);
}

// ── Test send (v4.1.3) ────────────────────────────────────────────────────────

/**
 * Send a verification email using the currently-resolved provider.
 *
 * Exists because email is the one feature whose failure is otherwise invisible
 * until a real alert or a Monday digest silently does not arrive.
 */
export async function sendTestEmail(to: string): Promise<DeliveryResult & { source?: string }> {
  const cfg = await resolveEmailProvider();
  if (!cfg) return { ok: false, error: NO_PROVIDER_ERROR };

  const subject = "[GitDash] Test email";
  const html = `
    <h2>GitDash email is working</h2>
    <p>This is a test message sent from your GitDash instance.</p>
    <p style="color:#888;font-size:12px">
      Provider: ${cfg.provider} · configured via ${cfg.source === "settings" ? "Settings" : "environment variables"}
    </p>
  `;
  const text =
    `GitDash email is working.\n\n` +
    `This is a test message sent from your GitDash instance.\n` +
    `Provider: ${cfg.provider} (configured via ${cfg.source === "settings" ? "Settings" : "environment variables"})`;

  const result =
    cfg.provider === "resend"
      ? await deliverViaResend(to, subject, html, text, cfg.apiKey, cfg.from)
      : await deliverViaSendgridCompat(to, subject, text, html, cfg.apiKey, cfg.from);

  return { ...result, source: cfg.source };
}
