/**
 * AI provider layer (v4.1.0) — Gemini primary, Qwen fallback.
 *
 * Zero new dependencies: both providers expose OpenAI-compatible
 * chat-completions endpoints, so a raw `fetch` is enough.
 *
 * Three contracts the rest of the app depends on:
 *
 *   1. `generateJson` NEVER throws. Every failure — no keys, disabled,
 *      timeout, HTTP error, unparseable body — comes back as an `AiFailure`
 *      with a machine-readable `reason`, so callers can pick their own
 *      fallback UX instead of wrapping everything in try/catch.
 *   2. Nothing here logs prompt content or snapshot payloads. Provider,
 *      model, latency, status and token counts only.
 *   3. Env is read inside the functions, never at module scope, so a
 *      deployment can flip AI_DISABLED without a rebuild (and so tests can
 *      vary it between cases).
 *
 * Cost note: the daily token budget below is an in-process counter, which
 * means it is PER INSTANCE, not global. On a serverless platform each
 * instance carries its own budget, so this is a damage-limiter — it turns a
 * runaway loop into a bounded-per-instance cost — not a hard spend cap. A
 * shared limiter would need the database; that was deliberately deferred to
 * keep this release free of schema changes (see docs/specs, §6.2).
 */

import { unseal } from "./secret-box";
import { withCache, cacheDelete } from "./cache";
import { isStandaloneMode } from "./mode";

export type AiProvider = "bailian" | "gemini" | "qwen";

/**
 * Wire format. Not every provider speaks OpenAI's shape — Alibaba's Bailian
 * "apps/anthropic" endpoint serves the Anthropic Messages API, which differs
 * in path, auth header, where the system prompt goes, and how the response
 * body is structured. Modelling this explicitly beats bolting on special
 * cases at each call site.
 */
type AiProtocol = "openai" | "anthropic";

export interface AiSuccess {
  ok: true;
  provider: AiProvider;
  model: string;
  /** Raw text returned by the model — expected to be a JSON document. */
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export type AiFailureReason =
  | "disabled"
  | "no_keys"
  | "budget_exceeded"
  | "timeout"
  | "provider_error"
  | "bad_response";

export interface AiFailure {
  ok: false;
  reason: AiFailureReason;
  /** Safe for server logs. Never surface verbatim to a client. */
  error: string;
}

export type AiResult = AiSuccess | AiFailure;

interface ProviderConfig {
  name: AiProvider;
  protocol: AiProtocol;
  keyEnv: string;
  baseEnv: string;
  modelEnv: string;
  defaultBase: string;
  defaultModel: string;
}

/**
 * Attempt order is significant: index 0 is primary. Providers without a key
 * are skipped entirely, so the effective order is "whichever of these you
 * have configured" — adding a provider here costs nothing at runtime.
 */
const PROVIDERS: ProviderConfig[] = [
  {
    name: "bailian",
    protocol: "anthropic",
    keyEnv: "BAILIAN_API_KEY",
    baseEnv: "BAILIAN_BASE_URL",
    modelEnv: "BAILIAN_MODEL",
    defaultBase: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic/v1",
    defaultModel: "qwen3.6-flash",
  },
  {
    name: "gemini",
    protocol: "openai",
    keyEnv: "GEMINI_API_KEY",
    baseEnv: "GEMINI_BASE_URL",
    modelEnv: "GEMINI_MODEL",
    defaultBase: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
  },
  {
    name: "qwen",
    protocol: "openai",
    keyEnv: "QWEN_API_KEY",
    baseEnv: "QWEN_BASE_URL",
    modelEnv: "QWEN_MODEL",
    defaultBase: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
  },
];

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_TOTAL_BUDGET_MS = 45_000;
const DEFAULT_DAILY_TOKEN_BUDGET = 2_000_000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isDisabled(): boolean {
  return process.env.AI_DISABLED === "true";
}

// ── Organization-mode provider override (v4.1.5) ──────────────────────────────

export interface AiOverride {
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
}

const OVERRIDE_CACHE_KEY = "ai-provider:settings";
const OVERRIDE_CACHE_TTL = 30; // seconds

/**
 * Resolve an instance-configured provider, when one applies.
 *
 * Only ever consulted in **organization** mode. A standalone deployment is
 * meant to work out of the box from environment defaults, so it never touches
 * the database here — that is the whole shape of the feature.
 *
 * The db import is dynamic to keep this module free of a static dependency on
 * the database layer, and because nothing should query on a request that will
 * not make an AI call anyway.
 */
export async function resolveAiOverride(): Promise<AiOverride | null> {
  if (isDisabled()) return null;
  if (isStandaloneMode()) return null;

  return withCache<AiOverride | null>(OVERRIDE_CACHE_KEY, OVERRIDE_CACHE_TTL, async () => {
    try {
      const { getAiSettings } = await import("./db");
      const s = await getAiSettings();
      if (!s || !s.enabled || !s.api_key_sealed) return null;

      const apiKey = unseal(s.api_key_sealed);
      if (!apiKey) {
        console.error(
          "[ai] Stored provider key could not be decrypted — re-enter it in Settings.",
        );
        return null;
      }

      const cfg = PROVIDERS.find((p) => p.name === s.provider);
      if (!cfg) return null;

      return {
        provider: s.provider,
        model: s.model || cfg.defaultModel,
        apiKey,
        baseUrl: (s.base_url || cfg.defaultBase).replace(/\/+$/, ""),
      };
    } catch {
      // No DATABASE_URL or table unreachable — environment defaults apply.
      return null;
    }
  });
}

/** Drop the cached override after a Settings save. */
export function invalidateAiOverrideCache(): void {
  cacheDelete(OVERRIDE_CACHE_KEY);
}

/** Providers with a key in the environment. Never returns key material. */
export function envProviders(): AiProvider[] {
  return PROVIDERS.filter((p) => Boolean(process.env[p.keyEnv])).map((p) => p.name);
}

/**
 * Providers actually available right now, accounting for an org-mode override.
 * Never returns key material.
 */
export async function configuredProviders(): Promise<AiProvider[]> {
  if (isDisabled()) return [];
  const override = await resolveAiOverride();
  if (override) return [override.provider];
  return envProviders();
}

/** True when the layer is not hard-disabled and some provider is usable. */
export async function aiEnabled(): Promise<boolean> {
  if (isDisabled()) return false;
  if (await resolveAiOverride()) return true;
  return envProviders().length > 0;
}

// ── Daily token budget ────────────────────────────────────────────────────────
// Per-instance, UTC-day keyed. See the cost note in the file header.

let budgetState = { day: "", tokens: 0 };

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function budgetLimit(): number {
  return envInt("AI_DAILY_TOKEN_BUDGET", DEFAULT_DAILY_TOKEN_BUDGET);
}

function budgetExhausted(): boolean {
  const limit = budgetLimit();
  if (limit === 0) return false; // 0 = unlimited
  if (budgetState.day !== utcDay()) return false; // new day resets on next record
  return budgetState.tokens >= limit;
}

function recordTokens(used: number): void {
  const today = utcDay();
  if (budgetState.day !== today) budgetState = { day: today, tokens: 0 };
  budgetState.tokens += used;
}

/** Exposed for tests and future observability. Never includes key material. */
export function budgetSnapshot(): { day: string; tokens: number; limit: number } {
  return { day: budgetState.day, tokens: budgetState.tokens, limit: budgetLimit() };
}

/** Test-only: clear the in-process daily counter. */
export function __resetBudgetForTests(): void {
  budgetState = { day: "", tokens: 0 };
}

// ── Provider call ─────────────────────────────────────────────────────────────

interface AttemptOutcome {
  kind: "success" | "retryable" | "fatal";
  result?: AiSuccess;
  error: string;
}

interface WireRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface WireResponse {
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function buildRequest(
  cfg: ProviderConfig,
  baseUrl: string,
  model: string,
  key: string,
  systemPrompt: string,
  userPayload: unknown,
  opts: { temperature: number; maxOutputTokens: number },
): WireRequest {
  const userContent = JSON.stringify(userPayload);

  if (cfg.protocol === "anthropic") {
    return {
      url: `${baseUrl}/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxOutputTokens,
        temperature: opts.temperature,
        // The system prompt is a top-level field here, not a message role.
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
        // Bailian's Qwen models enable extended thinking by default, which
        // costs ~10x the output tokens for no benefit on structured
        // extraction — measured 799 vs 85 tokens on an identical request.
        thinking: { type: "disabled" },
      }),
    };
  }

  return {
    url: `${baseUrl}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: opts.temperature,
      max_tokens: opts.maxOutputTokens,
      response_format: { type: "json_object" },
    }),
  };
}

/** Normalise either wire format into { content, usage }. */
function parseResponse(cfg: ProviderConfig, json: unknown): WireResponse {
  if (cfg.protocol === "anthropic") {
    const j = json as {
      content?: { type?: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    // Pick the text block explicitly: with thinking enabled the first block is
    // a "thinking" block and content[0].text would be undefined. We disable
    // thinking above, but a model is free to ignore that.
    const text = j.content?.find((b) => b.type === "text")?.text ?? "";
    const usage =
      j.usage && typeof j.usage.input_tokens === "number"
        ? {
            prompt_tokens: j.usage.input_tokens ?? 0,
            completion_tokens: j.usage.output_tokens ?? 0,
          }
        : undefined;
    return { content: text, usage };
  }

  const j = json as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const usage =
    j.usage && typeof j.usage.prompt_tokens === "number"
      ? {
          prompt_tokens: j.usage.prompt_tokens ?? 0,
          completion_tokens: j.usage.completion_tokens ?? 0,
        }
      : undefined;
  return { content: j.choices?.[0]?.message?.content ?? "", usage };
}

async function callProvider(
  cfg: ProviderConfig,
  systemPrompt: string,
  userPayload: unknown,
  opts: {
    temperature: number;
    maxOutputTokens: number;
    timeoutMs: number;
    /** Set when an organization has configured its own provider in Settings. */
    override?: AiOverride;
  },
): Promise<AttemptOutcome> {
  const key = opts.override?.apiKey ?? process.env[cfg.keyEnv]!;
  const baseUrl = (
    opts.override?.baseUrl ?? process.env[cfg.baseEnv] ?? cfg.defaultBase
  ).replace(/\/+$/, "");
  const model = opts.override?.model ?? process.env[cfg.modelEnv] ?? cfg.defaultModel;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const startedAt = Date.now();

  const wire = buildRequest(cfg, baseUrl, model, key, systemPrompt, userPayload, {
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
  });

  try {
    const res = await fetch(wire.url, {
      method: "POST",
      headers: wire.headers,
      body: wire.body,
      signal: controller.signal,
    });

    const latency = Date.now() - startedAt;

    if (!res.ok) {
      // 400/401/403 are configuration problems — retrying the same provider
      // cannot help, so fall straight through to the next one.
      const retryable = res.status === 429 || res.status >= 500;
      console.error(
        `[ai] ${cfg.name}/${model} HTTP ${res.status} in ${latency}ms (${retryable ? "retryable" : "fatal"})`,
      );
      return {
        kind: retryable ? "retryable" : "fatal",
        error: `${cfg.name} returned HTTP ${res.status}`,
      };
    }

    const { content, usage } = parseResponse(cfg, await res.json());

    if (!content || !content.trim()) {
      console.error(`[ai] ${cfg.name}/${model} returned an empty completion in ${latency}ms`);
      return { kind: "retryable", error: `${cfg.name} returned an empty completion` };
    }

    if (usage) recordTokens(usage.prompt_tokens + usage.completion_tokens);

    console.info(
      `[ai] ${cfg.name}/${model} ok in ${latency}ms` +
        (usage ? ` (${usage.prompt_tokens}+${usage.completion_tokens} tokens)` : ""),
    );

    return {
      kind: "success",
      result: { ok: true, provider: cfg.name, model, content, usage },
      error: "",
    };
  } catch (e) {
    const latency = Date.now() - startedAt;
    const aborted = e instanceof Error && e.name === "AbortError";
    console.error(
      `[ai] ${cfg.name}/${model} ${aborted ? "timed out" : "failed"} after ${latency}ms`,
    );
    // A timeout is retryable in principle, but the caller's total budget is the
    // real guard — the loop below re-checks the deadline before every attempt.
    return {
      kind: "retryable",
      error: aborted ? `${cfg.name} timed out` : `${cfg.name} request failed`,
    };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ask a provider for a JSON document, trying Gemini then Qwen.
 *
 * `userPayload` is JSON-serialized as the user message — it must be a typed
 * snapshot from src/lib/ai-snapshots.ts, never free-form user input.
 */
export async function generateJson(
  systemPrompt: string,
  userPayload: unknown,
  opts?: { temperature?: number; maxOutputTokens?: number },
): Promise<AiResult> {
  if (isDisabled()) {
    return { ok: false, reason: "disabled", error: "AI layer is disabled by AI_DISABLED" };
  }

  // An organization-configured provider takes over EXCLUSIVELY — it is never
  // used as a first attempt with the instance's own keys behind it. Falling
  // back would silently bill the deployment owner for an org's traffic, which
  // is a surprise nobody wants to discover on an invoice.
  const override = await resolveAiOverride();
  const available = override
    ? PROVIDERS.filter((p) => p.name === override.provider)
    : PROVIDERS.filter((p) => Boolean(process.env[p.keyEnv]));

  if (available.length === 0) {
    return { ok: false, reason: "no_keys", error: "No AI provider key is configured" };
  }

  if (budgetExhausted()) {
    const { tokens, limit } = budgetSnapshot();
    console.warn(`[ai] daily token budget exhausted (${tokens}/${limit}) — skipping call`);
    return { ok: false, reason: "budget_exceeded", error: "Daily AI token budget exhausted" };
  }

  const perAttemptMs = envInt("AI_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const deadline = Date.now() + envInt("AI_TOTAL_BUDGET_MS", DEFAULT_TOTAL_BUDGET_MS);
  const temperature = opts?.temperature ?? 0.2;
  const maxOutputTokens = opts?.maxOutputTokens ?? 900;

  let lastError = "All AI providers failed";

  for (const cfg of available) {
    // One wall-clock deadline spans every attempt, so a slow primary can never
    // push a single request past the route's maxDuration.
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return { ok: false, reason: "timeout", error: "AI total time budget exhausted" };
    }

    const attempt = await callProvider(cfg, systemPrompt, userPayload, {
      temperature,
      maxOutputTokens,
      timeoutMs: Math.min(perAttemptMs, remaining),
      override: override ?? undefined,
    });

    if (attempt.kind === "success") return attempt.result!;
    lastError = attempt.error;

    if (attempt.kind === "retryable") {
      const left = deadline - Date.now();
      if (left > 1_000) {
        await sleep(1_000);
        const retry = await callProvider(cfg, systemPrompt, userPayload, {
          temperature,
          maxOutputTokens,
          timeoutMs: Math.min(perAttemptMs, deadline - Date.now()),
          override: override ?? undefined,
        });
        if (retry.kind === "success") return retry.result!;
        lastError = retry.error;
      }
    }
    // fatal → fall through to the next provider without retrying this one
  }

  if (Date.now() >= deadline) {
    return { ok: false, reason: "timeout", error: "AI total time budget exhausted" };
  }
  return { ok: false, reason: "provider_error", error: lastError };
}
