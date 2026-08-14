/**
 * GET  /api/settings/email — current email delivery config (never the secret).
 * PUT  /api/settings/email — save it.
 *
 * The API key is write-only by design. It is never returned, only a masked
 * hint like "••••4f2a", so a logged-in user can confirm *which* key is stored
 * without being able to read it back. Submitting the form without a key
 * preserves the stored one.
 *
 * This config is instance-wide — like alert_rules, it has no per-user scoping,
 * so any authenticated user can change it. `updated_by` records who did, which
 * is what makes that acceptable rather than silent.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getSession } from "@/lib/session";
import { getEmailSettings, saveEmailSettings, type EmailProvider } from "@/lib/db";
import { resolveEmailProvider, invalidateEmailProviderCache } from "@/lib/notifier";
import { seal, maskHint } from "@/lib/secret-box";
import { safeError } from "@/lib/validation";

export const maxDuration = 60;

const VALID_PROVIDERS: EmailProvider[] = ["resend", "sendgrid"];

/** Deliberately permissive — real-world addresses are stranger than any strict regex. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EmailSettingsResponse {
  enabled: boolean;
  provider: EmailProvider;
  from_address: string | null;
  /** Masked, e.g. "••••4f2a". Null when no key is stored. */
  api_key_hint: string | null;
  has_key: boolean;
  updated_by: string | null;
  updated_at: string | null;
  /**
   * What the app would actually send through right now, accounting for the
   * environment-variable fallback. "env" means legacy config is still in
   * charge; "none" means nothing will send.
   */
  effective_source: "settings" | "env" | "none";
  db_available: boolean;
}

export async function GET() {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const resolved = await resolveEmailProvider();

  try {
    const s = await getEmailSettings();
    const body: EmailSettingsResponse = {
      enabled: s?.enabled ?? false,
      provider: s?.provider ?? "resend",
      from_address: s?.from_address ?? null,
      api_key_hint: s?.api_key_hint ?? null,
      has_key: Boolean(s?.api_key_sealed),
      updated_by: s?.updated_by ?? null,
      updated_at: s?.updated_at ?? null,
      effective_source: resolved?.source ?? "none",
      db_available: true,
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // No DATABASE_URL — the section still renders, read-only, explaining that
    // env vars are the only option on this deployment.
    const body: EmailSettingsResponse = {
      enabled: false,
      provider: "resend",
      from_address: null,
      api_key_hint: null,
      has_key: false,
      updated_by: null,
      updated_at: null,
      effective_source: resolved?.source ?? "none",
      db_available: false,
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function PUT(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: {
    enabled?: unknown;
    provider?: unknown;
    from_address?: unknown;
    api_key?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const enabled = payload.enabled === true;

  const provider = payload.provider;
  if (typeof provider !== "string" || !VALID_PROVIDERS.includes(provider as EmailProvider)) {
    return NextResponse.json({ error: 'provider must be "resend" or "sendgrid"' }, { status: 400 });
  }

  const fromRaw = typeof payload.from_address === "string" ? payload.from_address.trim() : "";
  if (fromRaw && !EMAIL_RE.test(fromRaw)) {
    return NextResponse.json({ error: "from_address is not a valid email address" }, { status: 400 });
  }

  const apiKeyRaw = typeof payload.api_key === "string" ? payload.api_key.trim() : "";

  // Enabling with no key stored and none supplied would silently do nothing —
  // reject it rather than let the UI show "enabled" over a dead config.
  let existingHasKey = false;
  try {
    existingHasKey = Boolean((await getEmailSettings())?.api_key_sealed);
  } catch {
    return NextResponse.json(
      { error: "No database configured — email settings must be set via environment variables." },
      { status: 503 },
    );
  }
  if (enabled && !apiKeyRaw && !existingHasKey) {
    return NextResponse.json({ error: "An API key is required to enable email" }, { status: 400 });
  }
  if (enabled && !fromRaw) {
    return NextResponse.json({ error: "A from address is required to enable email" }, { status: 400 });
  }

  // Attribution: who last changed the instance-wide credential.
  let updatedBy: string | null = null;
  try {
    const session = await getSession();
    updatedBy = session.user?.login ?? null;
  } catch {
    updatedBy = null;
  }

  try {
    await saveEmailSettings({
      enabled,
      provider: provider as EmailProvider,
      from_address: fromRaw || null,
      updated_by: updatedBy,
      ...(apiKeyRaw ? { api_key_sealed: seal(apiKeyRaw), api_key_hint: maskHint(apiKeyRaw) } : {}),
    });
    invalidateEmailProviderCache();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return safeError(e, "Failed to save email settings");
  }
}
