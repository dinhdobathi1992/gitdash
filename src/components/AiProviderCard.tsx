"use client";

/**
 * AI provider settings (v4.1.5) — organization mode only.
 *
 * A shared team deployment usually wants its own LLM account and model choice
 * rather than whatever the server operator configured. Standalone deployments
 * deliberately have no such section: they are meant to work out of the box
 * from the environment defaults, so this component renders nothing there.
 *
 * The API key is write-only — the server returns a masked hint only, and a
 * blank field on save keeps the stored key.
 */

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { AiSettingsResponse } from "@/app/api/settings/ai/route";
import { Sparkles, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type Provider = "bailian" | "gemini" | "qwen";

const PROVIDER_META: Record<Provider, {
  label: string; keyPlaceholder: string; models: string[]; note: string;
}> = {
  bailian: {
    label: "Bailian (Alibaba Cloud)",
    keyPlaceholder: "sk-sp-…",
    models: ["qwen3.6-flash", "qwen3.6-plus", "qwen3.7-plus", "qwen3.7-max", "qwen3.8-max"],
    note: "Anthropic-compatible endpoint. Extended thinking is disabled automatically to keep cost down.",
  },
  gemini: {
    label: "Google Gemini",
    keyPlaceholder: "AIza…",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    note: "OpenAI-compatible endpoint.",
  },
  qwen: {
    label: "Qwen (DashScope)",
    keyPlaceholder: "sk-…",
    models: ["qwen-plus", "qwen-max", "qwen-turbo"],
    note: "OpenAI-compatible endpoint. Distinct from Bailian.",
  },
};

export default function AiProviderCard() {
  const { data, mutate, isLoading } = useSWR<AiSettingsResponse>(
    "/api/settings/ai",
    fetcher<AiSettingsResponse>,
  );

  const [draft, setDraft] = useState<{
    enabled: boolean; provider: Provider; model: string; baseUrl: string; apiKey: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const state =
    draft ??
    (data
      ? {
          enabled: data.enabled,
          provider: data.provider as Provider,
          model: data.model ?? "",
          baseUrl: data.base_url ?? "",
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
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          enabled: state.enabled,
          provider: state.provider,
          model: state.model,
          base_url: state.baseUrl,
          ...(state.apiKey ? { api_key: state.apiKey } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "err", text: body.error ?? `Save failed (${res.status})` });
        return;
      }
      setMsg({ kind: "ok", text: "Saved. New requests use this provider within 30 seconds." });
      setDraft(null);
      mutate();
    } finally {
      setSaving(false);
    }
  }

  // Standalone deployments use environment defaults — nothing to configure.
  if (!isLoading && data && !data.configurable) return null;

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
        <span className="shrink-0 w-9 h-9 rounded-lg border border-violet-500/30 bg-violet-500/[0.14] flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-violet-300" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-white">AI Provider</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Use your own model and API key for AI Insights, anomaly explanations, failure hypotheses
            and the leadership digest.
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full border",
            data.effective_source === "settings"
              ? "border-violet-500/25 bg-violet-500/10 text-violet-300"
              : data.effective_source === "env"
                ? "border-slate-700 bg-slate-800/60 text-slate-400"
                : "border-slate-700 bg-slate-800/60 text-slate-500",
          )}
        >
          {data.effective_source === "settings" && <CheckCircle2 className="w-3 h-3" />}
          {data.effective_source === "settings"
            ? "Your key"
            : data.effective_source === "env"
              ? "Server default"
              : "Not configured"}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {!data.db_available && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>No database configured — settings cannot be stored on this deployment.</span>
          </div>
        )}

        {data.effective_source === "env" && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-slate-800/60 border border-slate-700 text-xs text-slate-300">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
            <span>
              Currently using the server&apos;s default provider
              {data.env_providers.length ? ` (${data.env_providers.join(", ")})` : ""}. Enabling
              below switches to your own key — the server default is <strong>not</strong> used as a
              fallback, so its billing stays separate from yours.
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
          <span className="text-sm text-slate-200">Use our own AI provider</span>
        </label>

        {state.enabled && (
          <div className="space-y-3.5 pl-7">
            <Field label="Provider">
              <select
                value={state.provider}
                onChange={(e) => patch({ provider: e.target.value as Provider, model: "" })}
                className="w-full px-3 py-2 bg-slate-900/70 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              >
                {(Object.keys(PROVIDER_META) as Provider[]).map((p) => (
                  <option key={p} value={p}>{PROVIDER_META[p].label}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-600 mt-1">{meta.note}</p>
            </Field>

            <Field label="Model">
              <input
                list="ai-model-options"
                value={state.model}
                placeholder={`${meta.models[0]} (default)`}
                onChange={(e) => patch({ model: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900/70 border border-slate-700 rounded-lg text-sm text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
              <datalist id="ai-model-options">
                {meta.models.map((m) => <option key={m} value={m} />)}
              </datalist>
              <p className="text-[11px] text-slate-600 mt-1">
                Suggestions shown, but any model your account can reach is accepted. Blank uses{" "}
                <code className="text-slate-500">{meta.models[0]}</code>.
              </p>
            </Field>

            <Field label="API key">
              <input
                type="password"
                autoComplete="off"
                value={state.apiKey}
                placeholder={data.has_key ? `${data.api_key_hint} — leave blank to keep` : meta.keyPlaceholder}
                onChange={(e) => patch({ apiKey: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900/70 border border-slate-700 rounded-lg text-sm text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
              <p className="text-[11px] text-slate-600 mt-1">
                Stored encrypted and never shown again.
              </p>
            </Field>

            <Field label="Base URL (optional)">
              <input
                type="url"
                value={state.baseUrl}
                placeholder="Leave blank for the provider's default endpoint"
                onChange={(e) => patch({ baseUrl: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900/70 border border-slate-700 rounded-lg text-sm text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
              <p className="text-[11px] text-slate-600 mt-1">
                For a gateway or regional endpoint. Must be https — this URL carries your key.
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
            {msg.kind === "ok"
              ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
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
