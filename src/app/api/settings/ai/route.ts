/**
 * GET  /api/settings/ai — current AI provider override (never the secret).
 * PUT  /api/settings/ai — save it.
 *
 * Organization mode only. A standalone deployment is meant to work from
 * environment defaults with no setup, so both verbs refuse there rather than
 * silently storing config that would never be read.
 *
 * The API key is write-only: encrypted at rest, never returned, and a blank
 * field on submit means "keep the stored one".
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession, getSession } from "@/lib/session";
import { getAppMode, isStandaloneMode } from "@/lib/mode";
import { getAiSettings, saveAiSettings, type AiSettingsProvider } from "@/lib/db";
import { envProviders, invalidateAiOverrideCache, resolveAiOverride } from "@/lib/ai";
import { seal, maskHint } from "@/lib/secret-box";
import { safeError } from "@/lib/validation";

export const maxDuration = 60;

const VALID_PROVIDERS: AiSettingsProvider[] = ["bailian", "gemini", "qwen"];

export interface AiSettingsResponse {
  /** False in standalone mode — the UI hides the section entirely. */
  configurable: boolean;
  mode: string;
  enabled: boolean;
  provider: AiSettingsProvider;
  model: string | null;
  base_url: string | null;
  api_key_hint: string | null;
  has_key: boolean;
  updated_by: string | null;
  updated_at: string | null;
  /** What is actually in effect: the saved override, env defaults, or nothing. */
  effective_source: "settings" | "env" | "none";
  /** Providers the deployment itself has keys for — capability only, no secrets. */
  env_providers: string[];
  db_available: boolean;
}

export async function GET() {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const standalone = isStandaloneMode();
  const envs = envProviders();
  const override = standalone ? null : await resolveAiOverride();

  const base = {
    configurable: !standalone,
    mode: getAppMode(),
    env_providers: envs,
    effective_source: (override ? "settings" : envs.length ? "env" : "none") as
      | "settings" | "env" | "none",
  };

  if (standalone) {
    return NextResponse.json(
      {
        ...base,
        enabled: false, provider: "bailian" as const, model: null, base_url: null,
        api_key_hint: null, has_key: false, updated_by: null, updated_at: null,
        db_available: false,
      } satisfies AiSettingsResponse,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const s = await getAiSettings();
    return NextResponse.json(
      {
        ...base,
        enabled: s?.enabled ?? false,
        provider: s?.provider ?? "bailian",
        model: s?.model ?? null,
        base_url: s?.base_url ?? null,
        api_key_hint: s?.api_key_hint ?? null,
        has_key: Boolean(s?.api_key_sealed),
        updated_by: s?.updated_by ?? null,
        updated_at: s?.updated_at ?? null,
        db_available: true,
      } satisfies AiSettingsResponse,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        ...base,
        enabled: false, provider: "bailian" as const, model: null, base_url: null,
        api_key_hint: null, has_key: false, updated_by: null, updated_at: null,
        db_available: false,
      } satisfies AiSettingsResponse,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

export async function PUT(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isStandaloneMode()) {
    return NextResponse.json(
      {
        error:
          "AI provider configuration is available in organization mode only. Standalone deployments use the server's environment defaults.",
      },
      { status: 403 },
    );
  }

  let payload: {
    enabled?: unknown; provider?: unknown; model?: unknown;
    base_url?: unknown; api_key?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const enabled = payload.enabled === true;

  const provider = payload.provider;
  if (typeof provider !== "string" || !VALID_PROVIDERS.includes(provider as AiSettingsProvider)) {
    return NextResponse.json(
      { error: 'provider must be one of "bailian", "gemini", "qwen"' },
      { status: 400 },
    );
  }

  const model = typeof payload.model === "string" ? payload.model.trim() : "";
  if (model.length > 120) {
    return NextResponse.json({ error: "model name is too long" }, { status: 400 });
  }

  const baseUrl = typeof payload.base_url === "string" ? payload.base_url.trim() : "";
  if (baseUrl && !/^https:\/\/[^\s]+$/i.test(baseUrl)) {
    // http:// is refused deliberately — this URL carries an API key.
    return NextResponse.json(
      { error: "base_url must be an https:// URL" },
      { status: 400 },
    );
  }

  const apiKeyRaw = typeof payload.api_key === "string" ? payload.api_key.trim() : "";

  let existingHasKey = false;
  try {
    existingHasKey = Boolean((await getAiSettings())?.api_key_sealed);
  } catch {
    return NextResponse.json(
      { error: "No database configured — AI settings cannot be stored on this deployment." },
      { status: 503 },
    );
  }
  if (enabled && !apiKeyRaw && !existingHasKey) {
    return NextResponse.json(
      { error: "An API key is required to enable a custom provider" },
      { status: 400 },
    );
  }

  let updatedBy: string | null = null;
  try {
    updatedBy = (await getSession()).user?.login ?? null;
  } catch {
    updatedBy = null;
  }

  try {
    await saveAiSettings({
      enabled,
      provider: provider as AiSettingsProvider,
      model: model || null,
      base_url: baseUrl || null,
      updated_by: updatedBy,
      ...(apiKeyRaw ? { api_key_sealed: seal(apiKeyRaw), api_key_hint: maskHint(apiKeyRaw) } : {}),
    });
    invalidateAiOverrideCache();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return safeError(e, "Failed to save AI settings");
  }
}
