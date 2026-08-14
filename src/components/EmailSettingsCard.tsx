"use client";

/**
 * Email delivery settings (v4.1.3).
 *
 * Moves email provider config out of environment variables and into the app,
 * so enabling alert/digest email no longer needs a redeploy.
 *
 * Deliberately labelled by provider rather than "SMTP": this path speaks the
 * Resend and SendGrid HTTP APIs, not the SMTP protocol, so a form asking for
 * host/port/username/password would be a trap — those values cannot work here.
 *
 * The API key is write-only. The server returns a masked hint only, and an
 * empty key field means "keep the stored one".
 */

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { EmailSettingsResponse } from "@/app/api/settings/email/route";
import { Mail, Loader2, CheckCircle2, AlertTriangle, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const PROVIDER_META = {
  resend: { label: "Resend", keyLabel: "API key", keyPlaceholder: "re_…", docs: "https://resend.com" },
  sendgrid: { label: "SendGrid", keyLabel: "API key", keyPlaceholder: "SG.…", docs: "https://sendgrid.com" },
} as const;

type Provider = keyof typeof PROVIDER_META;

export default function EmailSettingsCard() {
  const { data, mutate, isLoading } = useSWR<EmailSettingsResponse>(
    "/api/settings/email",
    fetcher<EmailSettingsResponse>,
  );

  const [draft, setDraft] = useState<{
    enabled: boolean;
    provider: Provider;
    from: string;
    apiKey: string;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [testTo, setTestTo] = useState("");

  // Seed the draft once the server state arrives, then let the user own it.
  const state =
    draft ??
    (data
      ? {
          enabled: data.enabled,
          provider: data.provider as Provider,
          from: data.from_address ?? "",
          apiKey: "",
        }
      : null);

  function patch(p: Partial<NonNullable<typeof state>>) {
    if (!state) return;
    setDraft({ ...state, ...p });
    setMsg(null);
  }

  async function save() {
    if (!state) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          enabled: state.enabled,
          provider: state.provider,
          from_address: state.from,
          // Omitted when blank — the server keeps the stored key.
          ...(state.apiKey ? { api_key: state.apiKey } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "err", text: body.error ?? `Save failed (${res.status})` });
        return;
      }
      setMsg({ kind: "ok", text: "Saved." });
      setDraft(null); // fall back to server state, clearing the key field
      mutate();
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ to: testTo }),
      });
      const body = await res.json().catch(() => ({}));
      setMsg(
        res.ok
          ? { kind: "ok", text: `Test email sent to ${testTo}.` }
          : { kind: "err", text: body.error ?? `Send failed (${res.status})` },
      );
    } finally {
      setTesting(false);
    }
  }

  if (isLoading || !state || !data) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="h-4 w-40 rounded skeleton mb-3" />
        <div className="h-3 w-64 rounded skeleton" />
      </div>
    );
  }

  const meta = PROVIDER_META[state.provider];
  const dirty = draft !== null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="flex items-start gap-4 p-5 border-b border-slate-800">
        <span className="shrink-0 w-9 h-9 rounded-lg border border-sky-500/30 bg-sky-500/[0.12] flex items-center justify-center">
          <Mail className="w-4 h-4 text-sky-300" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-white">Email Delivery</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Powers alert emails, daily digests, and the Weekly Leadership Digest. Without it, those
            features run but never deliver.
          </p>
        </div>
        <StatusPill data={data} />
      </div>

      <div className="p-5 space-y-4">
        {!data.db_available && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              No database is configured on this deployment, so settings cannot be saved here. Use the{" "}
              <code className="text-amber-100">RESEND_API_KEY</code> environment variable instead.
            </span>
          </div>
        )}

        {data.effective_source === "env" && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-slate-800/60 border border-slate-700 text-xs text-slate-300">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
            <span>
              Email is currently configured by environment variables. Anything saved here takes over
              once you enable it.
            </span>
          </div>
        )}

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={state.enabled}
            disabled={!data.db_available}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="w-4 h-4 rounded accent-violet-500"
          />
          <span className="text-sm text-slate-200">Enable email delivery</span>
        </label>

        {state.enabled && (
          <div className="space-y-3.5 pl-7">
            <Field label="Provider">
              <select
                value={state.provider}
                onChange={(e) => patch({ provider: e.target.value as Provider })}
                className="w-full px-3 py-2 bg-slate-900/70 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              >
                {(Object.keys(PROVIDER_META) as Provider[]).map((p) => (
                  <option key={p} value={p}>{PROVIDER_META[p].label}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-600 mt-1">
                Both use their HTTP API — no SMTP server or port required.
              </p>
            </Field>

            <Field label={meta.keyLabel}>
              <input
                type="password"
                autoComplete="off"
                value={state.apiKey}
                placeholder={data.has_key ? `${data.api_key_hint} — leave blank to keep` : meta.keyPlaceholder}
                onChange={(e) => patch({ apiKey: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900/70 border border-slate-700 rounded-lg text-sm text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
              <p className="text-[11px] text-slate-600 mt-1">
                Stored encrypted and never shown again. Get one at{" "}
                <a href={meta.docs} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">
                  {meta.label}
                </a>.
              </p>
            </Field>

            <Field label="From address">
              <input
                type="email"
                value={state.from}
                placeholder="alerts@yourdomain.com"
                onChange={(e) => patch({ from: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900/70 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
              <p className="text-[11px] text-slate-600 mt-1">
                Must be on a domain you have verified with {meta.label}.
              </p>
            </Field>
          </div>
        )}

        {msg && (
          <div
            className={cn(
              "flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs border",
              msg.kind === "ok"
                ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-200"
                : "bg-red-500/10 border-red-500/25 text-red-200",
            )}
          >
            {msg.kind === "ok" ? (
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            )}
            <span className="break-words">{msg.text}</span>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={save}
            disabled={saving || !dirty || !data.db_available}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-200 hover:bg-violet-500/25 transition-colors disabled:opacity-40"
          >
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            {dirty ? "Save changes" : "Saved"}
          </button>

          {data.updated_by && (
            <span className="text-[11px] text-slate-600">
              Last changed by @{data.updated_by}
              {data.updated_at && ` · ${new Date(data.updated_at).toLocaleDateString()}`}
            </span>
          )}
        </div>

        {/* Verification — the only way to know this works before Monday. */}
        {data.effective_source !== "none" && (
          <div className="pt-3 border-t border-slate-800 space-y-2">
            <p className="text-xs text-slate-400">Send a test email</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="email"
                value={testTo}
                placeholder="you@yourdomain.com"
                onChange={(e) => setTestTo(e.target.value)}
                className="flex-1 min-w-[200px] px-3 py-1.5 bg-slate-900/70 border border-slate-700 rounded-lg text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
              <button
                onClick={sendTest}
                disabled={testing || !testTo}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-40"
              >
                {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                Send test
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function StatusPill({ data }: { data: EmailSettingsResponse }) {
  if (data.effective_source === "none") {
    return (
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full border border-slate-700 bg-slate-800/60 text-slate-400">
        Not configured
      </span>
    );
  }
  return (
    <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
      <CheckCircle2 className="w-3 h-3" />
      {data.effective_source === "settings" ? "Active" : "Active (env)"}
    </span>
  );
}
