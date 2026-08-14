# GitDash AI Features — Design

**Date:** 2026-08-14
**Status:** Approved for implementation (rev 2 — corrected against codebase at v4.0.11)
**Target releases:** **v4.1.0 → v4.1.3 — one version and one PR per feature** (env-key-gated; zero behavior change when no AI keys are configured)
**Implementation plan:** [`docs/plans/2026-08-14-ai-features-plan.md`](../plans/2026-08-14-ai-features-plan.md)

> **Release discipline (non-negotiable).** Every feature in this spec ships as
> its own version, its own CHANGELOG entry, its own docs page, and its own PR —
> the same pattern used for v4.0.0–v4.0.3. Never batch two features into one
> release; each must be independently revertible. See §8 and §10.

> **Rev 2 changelog.** Rev 1 was reviewed against the codebase and three factual
> errors plus four design gaps were found. Corrections are marked **[R2]**
> throughout. Summary: `apiRateLimit` and `computeRepoDora` don't exist; the
> cost-control argument didn't hold on serverless; build order put an invisible
> feature first. See §11 for the full list.

---

## 1. Why

GitDash v4.x moved from raw CI metrics toward leadership-facing insight (health
scorecards, burnout radar, 1:1 briefs, weekly digests). The narrative layer is
currently **rule-based** (`src/lib/leadership-narrative.ts`,
`src/lib/one-on-one.ts`, `src/lib/optimization.ts`) — accurate but rigid: fixed
sentence templates, no synthesis across signals.

An LLM layer turns computed metrics into genuine analysis: *what changed, why it
likely happened, what to do about it* — the question every dashboard visitor
actually asks.

**Success criteria**

1. Every AI surface degrades gracefully: no API keys → surface hidden; provider
   error → rule-based fallback or "unavailable" state. Never a broken page.
2. AI output is grounded: every number in generated text must come from the
   provided snapshot. No invented metrics.
3. Privacy standard matches the product's "your PAT is yours" brand: metrics +
   names only — never code, logs, YAML content, PR bodies, or tokens.
4. Cost stays bounded **by a mechanism that actually works on the deployment
   target** (see §6) — not by cache/rate-limit assumptions that don't survive
   serverless. **[R2]**

---

## 2. Decisions already made

| Decision | Choice | Rationale |
| --- | --- | --- |
| Provider integration | **Direct API keys with fallback:** Gemini primary, Qwen fallback | Self-contained for any GitDash user; no dependency on a private gateway |
| Data sent to LLM | **Metrics + names only** (aggregate numbers, repo/workflow/job/step names, logins, dates). Never source code, PR/commit text, workflow YAML, or run logs | Matches product security brand; keeps prompt-injection surface near zero |
| Call site | **Server-side only** (`/api/ai/*` + `src/lib/ai.ts`) | Keys never reach the browser; snapshots assembled server-side |
| Prompt inputs | **Typed snapshots, no free-form user text** | Deterministic, testable, injection-resistant |
| Feature gating | Env-key presence (authoritative) + client flag `aiInsights` (cosmetic) **[R2]** | Opt-in, invisible otherwise |
| Spend ceiling | **`AI_DAILY_TOKEN_BUDGET` ships in v4.1.0** — not deferred **[R2]** | The only bound that survives serverless (§6) |

---

## 3. Architecture

```
Browser (SWR GET)
   │
   ▼
/api/ai/*  ── getTokenFromSession → validate → aiRateLimit → budget check
   │
   ▼
Snapshot builder (pure, allowlisted)  ←── existing libs: dora, anomaly,
   │                                      org-health-scorecard, github
   ▼
src/lib/ai.ts  ── OpenAI-compatible chat completions via fetch
   │              Gemini primary → Qwen fallback → AiFailure (never throws)
   ▼
JSON response ── validated against schema ── cached (withCache, token-scoped)
```

### 3.1 Provider layer — `src/lib/ai.ts` (new)

Zero new dependencies (raw `fetch` against OpenAI-compatible endpoints — both
Gemini and DashScope expose them).

**Env vars**

| Variable | Default | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Primary provider |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI-compatible endpoint |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Flash class is sufficient for all four surfaces |
| `QWEN_API_KEY` | — | Fallback provider |
| `QWEN_BASE_URL` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | Use `dashscope.aliyuncs.com` for CN accounts |
| `QWEN_MODEL` | `qwen-plus` | |
| `AI_TIMEOUT_MS` | `15000` | **[R2]** Per-attempt (was 30000 — see §3.1.1) |
| `AI_TOTAL_BUDGET_MS` | `45000` | **[R2]** Hard ceiling across all attempts |
| `AI_DAILY_TOKEN_BUDGET` | `2000000` | **[R2]** Process-wide daily cap; `0` = unlimited |
| `AI_DISABLED` | — | `true` hard-kills the layer regardless of keys |

**Interface**

```ts
export type AiProvider = "gemini" | "qwen";

export interface AiSuccess {
  ok: true;
  provider: AiProvider;
  model: string;
  content: string;                                   // raw JSON text from the model
  usage?: { prompt_tokens: number; completion_tokens: number };
}
export interface AiFailure {
  ok: false;
  /** Machine-readable so routes can distinguish 503 from 429. */
  reason: "disabled" | "no_keys" | "budget_exceeded" | "timeout" | "provider_error" | "bad_response";
  error: string;                                     // safe for logs, never for users verbatim
}
export type AiResult = AiSuccess | AiFailure;

/** True when AI_DISABLED is unset AND at least one provider key is present. */
export function aiEnabled(): boolean;

/** Which providers are configured — for /api/ai/status. Never returns key material. */
export function configuredProviders(): AiProvider[];

export async function generateJson(
  systemPrompt: string,
  userPayload: unknown,                              // JSON-serialized snapshot
  opts?: { temperature?: number; maxOutputTokens?: number; signal?: AbortSignal },
): Promise<AiResult>;
```

**Behavior**

- Tries providers in order `[gemini, qwen]`, skipping any without a key.
- Per attempt: `AbortController` with `AI_TIMEOUT_MS`, request body
  `{ model, messages, temperature: 0.2, response_format: { type: "json_object" } }`.
- **Total-budget guard [R2]:** a single wall-clock deadline of
  `AI_TOTAL_BUDGET_MS` spans *all* attempts. Once exceeded, remaining providers
  are skipped and `{ reason: "timeout" }` is returned. This is what prevents the
  rev-1 worst case of 30s × 2 providers × retry ≈ 120s in one request.
- Non-retryable status (400/401/403) → skip straight to next provider.
  429/5xx → one retry after 1s, then next provider.
- **Never throws.** All failures return `AiFailure`.
- **Token accounting [R2]:** on success, add `usage.prompt_tokens +
  usage.completion_tokens` to an in-process daily counter (UTC-day keyed). When
  the counter exceeds `AI_DAILY_TOKEN_BUDGET`, `generateJson` short-circuits to
  `{ reason: "budget_exceeded" }` without calling any provider. See §6 for why
  this is per-instance and what that means.
- Logging: provider, model, latency, HTTP status, token counts, budget
  remaining. **Never log prompt content or snapshot payloads.**

#### 3.1.1 Why the timeout numbers changed **[R2]**

Rev 1 specified `AI_TIMEOUT_MS=30000` per attempt with 2 providers and a retry —
a ~120s worst case inside a single request. Only `/api/cron/sync` sets
`maxDuration` today (`src/app/api/cron/sync/route.ts:35`); every other route
uses the platform default. Rev 2 lowers the per-attempt timeout to 15s, adds a
45s total ceiling, and requires each AI route to declare
`export const maxDuration = 60;`.

### 3.2 Route group — `/api/ai/*` (new)

All GET (matches the SWR fetcher + `Cache-Control` convention of every other
analytics route).

| Route | Surface | Rate limit | Cache TTL |
| --- | --- | --- | --- |
| `/api/ai/status` | `{ enabled, providers }` — no secrets | none (cheap, no LLM call) | none |
| `/api/ai/insights` | F1 | 20/min | 15 min |
| `/api/ai/anomaly-explanation` | F4 | 20/min | 30 min |
| `/api/ai/root-cause` | F3 | 10/min | 10 min |

F2 needs no route — it runs inside the existing cron digest path.

**Rate limiting — corrected [R2].** Rev 1 referenced a non-existent
`apiRateLimit`. The real module is `src/lib/ratelimit.ts`:

```ts
rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs?: number }
getRateLimitKey(req: Request, prefix: string): string   // ← IP-based, NOT token-hash
```

Since the spec calls for per-token limiting, add a small helper to
`src/lib/ratelimit.ts`:

```ts
/** Token-hash-keyed limiter for authenticated, cost-bearing routes. */
export function aiRateLimit(
  tokenHash: string,
  surface: string,
  limit: number,
): { allowed: boolean; retryAfterMs?: number } {
  return rateLimit(`ai:${surface}:${tokenHash}`, limit, 60_000);
}
```

`tokenHash` comes from the existing `hashKey(token)` in `src/lib/cache.ts:34`.

**Common handler shape** (mirror `src/app/api/github/org-health-scorecard/route.ts`,
which is the closest existing analogue):

```ts
export const maxDuration = 60;                       // [R2] required on every AI route

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!aiEnabled()) {
    return NextResponse.json({ ok: false, error: "AI features are not configured" }, { status: 503 });
  }

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;
  // …validateRepo / validateOrg / validateId as appropriate

  const tokenHash = hashKey(token);
  const limit = aiRateLimit(tokenHash, "insights", 20);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60000) / 1000)) } },
    );
  }

  try {
    const snapshot = await buildInsightsSnapshot(token, { … });
    const fingerprint = hashKey(JSON.stringify(snapshot));   // [R2] see caching note
    const result = await withCache(
      `ai:insights:${tokenHash}:${scope}:${fingerprint}`,
      900,
      async () => { /* generateJson + schema validation */ },
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=900" },
    });
  } catch (e) {
    return safeError(e, "Failed to generate AI insights");
  }
}
```

**Important caching note [R2].** Fingerprinting by snapshot hash means the
snapshot must be built *before* the cache lookup — so a cache hit still costs
the full GitHub fan-out, only saving the LLM call. That is the intended
trade-off (LLM calls are the metered resource; GitHub calls are already cached
one layer down by `getRepoSummary`/`withCache`), but it must be understood: **the
AI cache does not protect GitHub rate limits.** See §6.3.

**Response envelope**

```json
{
  "ok": true,
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "generated_at": "2026-08-14T03:20:00Z",
  "cached": false,
  "content": { "summary": "…", "bullets": ["…"], "actions": ["…"] }
}
```

Failure mapping **[R2]** — routes translate `AiFailure.reason` to status:

| `reason` | HTTP | Body `error` |
| --- | --- | --- |
| `disabled`, `no_keys` | 503 | `"AI features are not configured"` |
| `budget_exceeded` | 429 | `"AI daily budget reached"` |
| `timeout`, `provider_error`, `bad_response` | 503 | `"AI insights unavailable"` |

Snapshot-assembly errors → 500 via `safeError` (never leak provider errors
verbatim).

**Shared model output schema**

```json
{
  "summary": "2-3 sentence plain-English synthesis",
  "bullets": ["finding grounded in provided numbers", "…"],
  "actions": ["concrete next step", "…"]
}
```

Server-side validation: keys present, string arrays, length caps (summary ≤ 400
chars, ≤ 6 bullets, ≤ 4 actions, each item ≤ 200 chars). Invalid shape → retry
once → `{ reason: "bad_response" }`.

### 3.3 Snapshot builders — `src/lib/ai-snapshots.ts` (new)

One pure builder per surface. Each builder:

- takes `(token, scopeParams)` and returns a typed snapshot object,
- is the **enforcement point of the privacy policy** — it allowlists fields;
  anything not in the type cannot leak,
- reuses existing fetchers only.

**Corrected symbol table [R2]** — rev 1 named `computeRepoDora`, which does not
exist. Verified symbols as of v4.0.11:

| Need | Real symbol | Location |
| --- | --- | --- |
| Repo DORA | `calculateRepoDora(mergedPrs, releases, detailMap)` → `RepoDoraSummary` | `src/lib/dora.ts:386` (pure) |
| …its fetching | route handler | `src/app/api/github/repo-dora/route.ts` |
| CI DORA from runs | `calculateDoraMetrics(runs)` → `DoraMetrics` | `src/lib/dora.ts:173` |
| Repo summary | `getRepoSummary(token, owner, repo)` | `src/lib/github.ts:243` |
| Org scorecard | `computeScorecard(token, octokit, org, limit)` | `src/lib/org-health-scorecard.ts:68` |
| Bus factor | `computeBusFactor(octokit, owner, repo)` | `src/lib/bus-factor.ts` |
| Anomalies | `detectAnomalies(runs, threshold?)` → `Map<number, RunAnomalies>` | `src/lib/anomaly.ts:153` (pure) |
| Baseline | `computeBaseline(runs, metric, threshold?)` → `BaselineStats \| null` | `src/lib/anomaly.ts:185` (pure) |
| Workflow runs | `listWorkflowRuns(token, owner, repo, workflow_id, per_page?)` | `src/lib/github.ts:511` |
| Job/step stats | `getJobStats(token, owner, repo, workflow_id, per_page?)` → `JobStatsResponse` | `src/lib/github.ts:638` |
| Workflow file history | `listWorkflowFileCommits(token, owner, repo, limit?)` → `WorkflowFileCommit[]` | `src/lib/github.ts:765` |
| Token → cache key | `hashKey(secret)` | `src/lib/cache.ts:34` |
| Cache | `withCache(key, ttlSeconds, factory)` | `src/lib/cache.ts:99` |

Unit tests assert snapshot shape against fixtures **and** assert absence of
forbidden fields by construction (see §7).

---

## 4. Feature specs

Build order is **F1 → F4 → F2 → F3** — changed in rev 2, see §8.

### F1 — AI Insights Panel  *(flagship, builds first)*

**What:** A card on the repo overview (`/repos/[owner]/[repo]`) and org health
scorecard (`/org/[orgName]/health`) pages: plain-English synthesis of the metrics
already on screen.

**Snapshot — `InsightsSnapshot`**

```ts
export interface InsightsSnapshot {
  surface: "repo" | "org";
  scope: string;                      // "owner/repo" or "orgName"
  period_days: number;                // 30
  dora: {
    deployments_per_day: number;
    lead_time_p50_hours: number;
    change_failure_rate_pct: number;
    mttr_p50_hours: number;
    benchmark: DoraLevel;             // "elite" | "high" | "medium" | "low"
  } | null;
  ci: {
    total_runs: number;
    success_rate_pct: number;
    success_rate_prev_period_pct: number | null;
    duration_p95_ms: number;
    duration_p95_prev_period_ms: number | null;
    queue_wait_p95_ms: number;
  } | null;
  anomalies: { metric: AnomalyMetric; direction: "high" | "low"; run_number: number }[];
  bus_factor: { overall: number; critical_modules: number; top_module_share_pct: number } | null;
  risk_bands: { healthy: number; watch: number; at_risk: number } | null;  // org surface only
  recent_workflow_changes: { date: string; author_login: string | null }[];  // metadata only
}
```

**Prompt** — versioned constant in `src/lib/ai-prompts.ts`:

```
SYSTEM
You are a senior DevOps analyst embedded in GitDash, a CI/CD analytics
dashboard. You receive a JSON snapshot of pre-computed engineering metrics.

Rules:
- Use ONLY numbers and facts present in the snapshot. Never invent metrics,
  dates, or causes that the data does not support.
- If a signal is weak or missing (null fields, small sample sizes), say so
  explicitly instead of guessing.
- Be concrete and actionable; no generic advice ("improve testing") — tie
  every recommendation to a specific snapshot signal.
- Tone: candid, concise, leadership-friendly. No jargon without a one-clause
  explanation.
- Respond with JSON only: {"summary": "...", "bullets": [...], "actions": [...]}
  summary <= 3 sentences. bullets <= 5, each <= 25 words. actions <= 3, imperative.

USER
<InsightsSnapshot JSON>
```

**UI:** New `src/components/AiInsightsCard.tsx` — collapsible card reusing the
`Section` header pattern introduced in v4.0.11
(`src/app/repos/[owner]/[repo]/team/page.tsx`), sparkle icon, loading skeleton,
"Regenerate" button (appends `?refresh=1`, which bypasses cache), and an
`unavailable` state. Rendered only when the `useAiEnabled()` hook reports
enabled **and** the `aiInsights` client flag is on.

**Effort:** 1–1.5 days.

---

### F4 — Anomaly Explanations  *(second — cheapest surface once F1's UI pattern exists)*

**What:** `src/lib/anomaly.ts` already flags duration/queue-wait outliers on the
workflow detail page. Each flag gains a "Why?" button that lazy-fetches a 2–3
sentence AI explanation.

**Snapshot — `AnomalySnapshot`**

```ts
export interface AnomalySnapshot {
  workflow_name: string;
  repo: string;                       // "owner/repo"
  metric: AnomalyMetric;              // "duration" | "queue_wait"
  baseline: { mean_ms: number; stddev_ms: number; sample_size: number };
  outliers: {                         // cap 5, most recent first
    run_number: number;
    date: string;
    value_ms: number;
    z_score: number;
    trigger: string;                  // WorkflowRun.event
    actor_login: string | null;
  }[];
  concurrent_signals: {
    workflow_file_changes: { date: string; author_login: string | null }[];
    trigger_mix: Record<string, number>;
  };
}
```

**Server-side rebuild is required [R2].** `detectAnomalies` is currently invoked
**client-side only** (`src/app/repos/[owner]/[repo]/workflows/[workflow_id]/page.tsx`).
Because §2 mandates server-side snapshot assembly and GET-only routes, the F4
route must call `listWorkflowRuns` and re-run `detectAnomalies` +
`computeBaseline` server-side. This duplicates work the client already did. It is
accepted (keeps the injection surface at zero and the client can't forge
snapshot numbers), but it means each cache-miss "Why?" click costs one
`listWorkflowRuns` call plus one `listWorkflowFileCommits` call. Budget
accordingly; do not describe this as free.

**Prompt**

```
SYSTEM
You explain CI metric anomalies in two or three sentences. Input is JSON:
baseline stats, the outlier runs, and concurrent signals (workflow-file
changes, trigger mix). Use only the provided data. Name the most likely cause
first, note alternatives only if evidence supports them, and end with one
concrete check the team can perform. You do NOT have run logs and must not
pretend to. Respond JSON only: {"explanation": "...", "check": "..."}.

USER
<AnomalySnapshot JSON>
```

**Response schema differs from the shared envelope:** `content.explanation`,
`content.check` (both strings, ≤ 400 chars each).

**Effort:** 0.75–1 day (upped from rev 1 to account for the server-side rebuild).

---

### F2 — AI Leadership Digest  *(third — see the blocker below)*

> ### ⚠️ Precondition [R2]
> **The weekly digest email currently cannot send.** Production has neither
> `RESEND_API_KEY` nor `SMTP_HOST`, so `deliverLeadershipDigestEmail`
> (`src/lib/notifier.ts:304`) returns
> `{ ok: false, error: "No email provider configured…" }` on every call.
>
> Rev 1 sequenced F2 first as *"fastest to ship — most visible."* It is
> currently the **least** visible: an AI summary inside an email nobody
> receives. **Do not start F2 until an email provider is configured and a test
> digest has been received.** If that is blocked, skip F2 and go straight to F3.

**What:** The existing weekly digest email gains an LLM-written executive summary
above the rule-based narrative.

**Integration point:** `sendWeeklyLeadershipDigests` (`src/lib/sync.ts:178`).
After `computeScorecard` + `generateLeadershipNarrative`, call `generateJson`.
On any `AiFailure` → send the email with only the rule-based narrative (current
behavior). **The digest never fails because AI is down.**

**Snapshot — `DigestSnapshot`**

```ts
export interface DigestSnapshot {
  org: string;
  week: string;                       // ISO week, e.g. "2026-W33"
  scorecard: OrgHealthScorecardResponse;    // existing type, already metrics-only
  rule_narrative: {                   // anchor: model refines, must not contradict
    summary_line: string;
    highlights: string[];
    concerns: string[];
  };
}
```

**Email rendering — corrected [R2].** Rev 1's prompt said *"email body renders
plain text."* It does not: `deliverLeadershipDigestEmail` builds **both** an HTML
body (primary) and a plain-text fallback. Therefore:

- Keep the "no markdown / no emojis" instruction (it keeps the text fallback
  clean), but
- **HTML-escape the AI summary before interpolating it into the `html`
  template.** Add a small `escapeHtml()` helper in `notifier.ts` and apply it to
  the new `aiSummary` field. (The existing narrative fields are also
  un-escaped — fixing those is in scope for this task since it's the same
  helper and the same file.)

**Signature change:**

```ts
export interface LeadershipDigestEmailInput {
  subject: string;
  summary_line: string;
  highlights: string[];
  concerns: string[];
  aiSummary?: string;                 // [R2] new, optional
}
```

Rendered in its own section labeled **"AI summary"** (transparency) above the
existing narrative.

**Effort:** 0.5 day *after* the email precondition is met.

---

### F3 — Failure Root-Cause Hypotheses  *(last — deepest build)*

**What:** On the workflow detail page, when recent failures exist: an "AI
hypotheses" panel ranking likely causes with supporting evidence. Metadata only —
never run logs.

**Snapshot — `RootCauseSnapshot`**

```ts
export interface RootCauseSnapshot {
  workflow_name: string;
  repo: string;
  window_days: number;                // 14
  run_count: number;
  failure_count: number;
  failure_rate_pct: number;
  first_failure_at: string | null;
  prior_success_streak: number;
  failures: {                         // cap 10, most recent first
    run_number: number;
    date: string;
    trigger: string;
    branch_type: "main" | "pr" | "other";
    failed_jobs: { job_name: string; failed_step_names: string[]; duration_ms: number }[];
  }[];
  step_failure_frequency: { step_name: string; failure_count: number; share_of_failures_pct: number }[];
  failure_clustering: {
    same_step_share_pct: number;
    trigger_distribution: Record<string, number>;
    branch_distribution: Record<string, number>;
  };
  workflow_file_changes: { date: string; author_login: string | null }[];
  duration_shift: { before_failures_p50_ms: number; during_failures_p50_ms: number } | null;
}
```

**GitHub fan-out warning [R2].** This snapshot needs `getJobStats`
(`src/lib/github.ts:638`), which fetches runs and then jobs for each completed
run, batched 8 at a time — **on the order of 50 GitHub API calls per cache
miss.** With a 10/min rate limit, a single user can consume a meaningful slice of
a 5,000/hr GitHub budget. Mitigations, all required:

1. Call `getJobStats` with `per_page` ≤ 30, not the default 50.
2. Gate the UI to `failure_count >= 3` (already specified) so the route is not
   hit on healthy workflows.
3. Reuse the `withCache` layer *around the snapshot build itself*, not just
   around the LLM call — this is the one surface where that is worth the extra
   key.

**Prompt**

```
SYSTEM
You are a CI failure analyst. You receive JSON metadata about recent workflow
failures: which steps failed, how often, triggers, branches, timing, and dates
when the workflow definition itself changed. You do NOT have logs and must not
pretend to.

Rules:
- Produce 1-3 ranked hypotheses. Each must cite the specific evidence from the
  snapshot that supports it (step names, dates, concentrations).
- Prefer boring explanations: a workflow-file change right before the first
  failure, one flaky step, infra/queue signals - in that order of evidence.
- Mark each hypothesis confidence: "high" | "medium" | "low" based on how
  strongly the evidence supports it. Low-evidence guesses must say so.
- Never reference log contents, code, or anything not in the snapshot.
- Respond JSON only: {"hypotheses": [{"rank": 1, "hypothesis": "...",
  "evidence": "...", "confidence": "...", "next_step": "..."}]}

USER
<RootCauseSnapshot JSON>
```

**Response schema:** `content.hypotheses[]` — array of ≤ 3, each
`{ rank: number; hypothesis: string; evidence: string; confidence: "high"|"medium"|"low"; next_step: string }`.

**UI placement:** Below the reliability tab charts, shown only when
`failure_count >= 3` in window.

**Effort:** 1.5–2 days.

---

## 5. Security & privacy

1. **Allowlist enforcement at the type level** — snapshots are the only thing
   serialized into prompts; builders expose no passthrough of raw API objects.
2. **Never sent:** PAT/OAuth tokens, run logs, file contents, workflow YAML,
   PR/commit message bodies, email addresses. **Logins are sent** (needed for
   accountability statements) — this must be documented on the docs page.
3. **Keys server-side only.** `/api/ai/status` returns capability, never key
   material. It is not in `ALWAYS_PUBLIC` (`src/middleware.ts:12`), so it
   inherits session auth — keep it that way.
4. **Prompt injection:** no free-form user input enters any prompt anywhere in
   the v4.1.x series. (The deferred NL-Q&A feature is the one that would change
   this — it needs its own injection review before it is planned.)
5. **The client flag is not a security control [R2].** `src/lib/feature-flags.ts`
   is localStorage-backed and trivially flipped by any user. Every AI route must
   independently call `aiEnabled()` server-side; the flag only hides UI.
6. **Rate limiting + budget** — see §6 for what these actually guarantee.
7. **Transparency:** docs page section "AI features" stating exactly what data
   leaves the instance and to which providers; AI-generated sections labeled in
   both UI and email.

---

## 6. Cost control — corrected **[R2]**

Rev 1 claimed *"Rate limits above bound worst case to a few dollars/day even
under abuse."* That does not follow on this deployment target. Both mechanisms
are in-process `Map`s:

| Mechanism | File | Scope |
| --- | --- | --- |
| `withCache` | `src/lib/cache.ts:1-7` | Self-documented: *"Not shared across serverless instances — treat as a request-coalescing layer, not a distributed cache"* |
| `rateLimit` | `src/lib/ratelimit.ts:11` | Module-level `Map`, per-instance |

On Vercel, every instance gets a fresh window and a cold cache. So:

### 6.1 What is actually guaranteed

| Claim | Holds? | Notes |
| --- | --- | --- |
| Per-call cost is small | **Yes** | Flash-class, ~1.5k in + 200 out ≈ $0.0002–0.0005 |
| Cache reduces repeat calls | **Partially** | Only within one warm instance |
| Rate limit bounds a single user | **Partially** | Per instance, not globally |
| Total spend is bounded | **Only via `AI_DAILY_TOKEN_BUDGET`** | Promoted into v4.1.0 for exactly this reason |

### 6.2 The decision

`AI_DAILY_TOKEN_BUDGET` ships in v4.1.0 (default 2,000,000 tokens/day ≈ a few
dollars on flash pricing). It is **also per-instance**, so it is a
damage-limiter, not a hard global cap — that is stated plainly rather than
papered over. Its job is to make a runaway loop or a hostile authenticated user
expensive-but-survivable instead of unbounded.

**Deliberately not doing:** a Neon-backed distributed limiter. It would be a
real fix but requires a schema change, and §10's rollback story ("revert the
version commit, no migration") is worth more at this stage than a tighter bound.
Revisit if actual spend justifies it.

### 6.3 GitHub rate limit is a separate budget

The AI cache is keyed on a snapshot fingerprint, so a cache hit still pays the
GitHub fan-out — it only saves the LLM call. F3 is the sharp edge here (~50 calls
per snapshot build via `getJobStats`); see its mitigations. Do not conflate "AI
cached" with "GitHub calls avoided."

---

## 7. Testing strategy

| Layer | Test | Precedent |
| --- | --- | --- |
| `ai.ts` | Mocked `fetch`: provider order, fallback on 401/429/5xx, per-attempt timeout, **total-budget abort**, JSON-mode request body, `AI_DISABLED`, key absence, **daily-budget short-circuit** | New file, pure Node ✓ |
| Snapshot builders | Fixture inputs → exact snapshot shape; **assert forbidden keys absent** (walk the serialized JSON, fail on `logs`/`body`/`content`/`yaml`/`token`) | Matches `tests/dora.test.ts` style ✓ |
| Prompt builders | Snapshot → messages array snapshot tests (prompts are versioned constants) | New, trivial ✓ |
| Response validation | Malformed model JSON (missing keys, oversize, wrong types) → rejected; retry-once path exercised | New, pure ✓ |
| Digest integration | `generateJson` mocked to fail → email still sends with rule-based narrative only | Extends `tests/notifier.test.ts` ✓ |
| Routes | Handler tests with mocked `generateJson`: 401, 429, 503, cache hit | **⚠️ No precedent — see below [R2]** |

### 7.1 Route-handler tests are new infrastructure **[R2]**

All 7 existing test files test pure `src/lib` functions; `vitest.config.ts`
scopes coverage to `src/lib/**/*.ts`. There are **zero** route-handler tests
today. Testing a route requires mocking `NextRequest` and `getTokenFromSession`
(which reads iron-session cookies via `next/headers`).

**Decision:** treat this as its own task with its own budget (0.5 day, task 0c in
the plan), not as a free rider on the feature tasks. Establish the pattern once
against `/api/ai/status` — the simplest possible route — then reuse it.

If the mocking proves awkward, the acceptable fallback is: **extract each route's
logic into a pure `handleX(deps)` function in `src/lib/`, unit-test that, and
keep the route file as a thin adapter.** This matches how `computeScorecard` and
`computeBusFactor` were already extracted from their routes in v4.0.0/v4.0.3, and
is the preferred outcome if there's any friction.

All tests are pure/Node — **no network in CI.**

---

## 8. Build order & effort — revised **[R2]**

**One feature = one version = one PR.** Each row below is a complete,
independently revertible release: code + version bump (all 7 locations, §10.1) +
CHANGELOG entry + docs feature page + API Reference entries + PR.

| Release | Contents | Effort | Gate |
| --- | --- | --- | --- |
| **v4.1.0** | Core layer (`ai.ts`, `aiRateLimit`, `/api/ai/status`, `aiInsights` flag, route-test pattern) **+ F1 AI Insights Panel** | 2.25–2.75 d | — |
| **v4.1.1** | **F4** Anomaly Explanations | 0.75–1 d | v4.1.0 (reuses card pattern) |
| **v4.1.2** | **F2** AI Leadership Digest | 0.5 d | ⚠️ email provider configured |
| **v4.1.3** | **F3** Root-Cause Hypotheses | 1.5–2 d | v4.1.0 |
| | **Total** | **5–6.25 days** | |

**Why the core layer ships with F1 rather than alone.** The provider module,
status route, and flag produce **no user-visible surface** on their own —
releasing them as a standalone version would mean a version bump and a
release-notes entry describing nothing a user can see. Bundling them with F1
keeps every release meaningful. They are still separate *commits* inside that
PR, so `git revert` can drop F1 while keeping the layer if that's ever wanted.

**Order rationale (changed from rev 1).** Rev 1 built F2 first on the theory it
was "most visible." It is currently invisible (§F2 precondition). Rev 2 leads
with **F1** — the flagship, visible on page load, and the surface that
establishes the card UI pattern F4 reuses. F4 follows as the cheap add-on. F2
slots in whenever email is unblocked. F3 is last: biggest snapshot, bespoke
schema and UI, heaviest GitHub fan-out.

If F2 is still blocked when its turn comes, **skip it and ship F3 as v4.1.2** —
do not leave a version number reserved for an unshipped feature.

---

## 9. Deferred (not in the v4.1.x series)

- Natural-language metrics Q&A (chat) — biggest build; introduces free-form
  prompt input → needs an injection review first.
- Neon-backed distributed rate limit / budget (§6.2).
- AI cost-optimization tips, AI 1:1 coaching brief, security-finding explainer —
  same architecture, cheap follow-ups once the layer exists.
- Embedding-based repo similarity / anomaly clustering.
- Per-user AI usage metering.

---

## 10. Rollout

All four releases are gated by env-key presence (authoritative) + the
`aiInsights` client flag (cosmetic). **Zero schema changes across all four** —
no migration to undo at any point.

### 10.1 Version bump — all 7 locations, every release

A release is not complete until **every** one of these is updated. Verified
against the tree at v4.0.11:

| # | File | Line (at v4.0.11) | What |
| --- | --- | --- | --- |
| 1 | `package.json` | 3 | `"version": "X.Y.Z"` |
| 2 | `helm/gitdash/Chart.yaml` | 5 | `version:` (chart version — bump independently) |
| 3 | `helm/gitdash/Chart.yaml` | 6 | `appVersion: "X.Y.Z"` |
| 4 | `src/app/docs/page.tsx` | 2473 | `ReleaseNotes()` — **new** top entry, `badge: "latest"` |
| 5 | `src/app/docs/page.tsx` | 2473+ | previous top entry demoted to `badge: null` |
| 6 | `src/app/docs/page.tsx` | 2916 | `NEXT_PUBLIC_APP_VERSION ?? "X.Y.Z"` (sidebar badge) |
| 7 | `src/app/docs/page.tsx` | 3165 | `NEXT_PUBLIC_APP_VERSION ?? "X.Y.Z"` (footer) |
| 8 | `CHANGELOG.md` | 9 | new `## [X.Y.Z] — YYYY-MM-DD` section at the top |

Chart-version mapping for this series: `0.4.11` → **`0.5.0`** (v4.1.0) → `0.5.1`
(v4.1.1) → `0.5.2` (v4.1.2) → `0.5.3` (v4.1.3).

Self-check — after bumping, this must return only the new version:

```bash
grep -rn "NEXT_PUBLIC_APP_VERSION ?? \"" src/app/docs/page.tsx
grep -n '"version"' package.json; grep -n "^version:\|^appVersion:" helm/gitdash/Chart.yaml
```

### 10.2 Docs — every feature gets its own page

Per spec §4, each feature is a user-facing surface, so each release adds:

1. A `feat-*` entry in the docs `NAV` array under **Features**.
2. An index card in `Features()` with `since: "X.Y.Z"` (renders the `VersionBadge`).
3. A dedicated detail component registered in `SECTION_COMPONENTS`.
4. Its `/api/ai/*` row(s) in the **API Reference** section.
5. A `ReleaseNotes()` entry (see §10.1 #4/#5).

The transparency section (what data leaves the instance, to which providers,
what is never sent) ships once with v4.1.0 and is amended if a later feature
widens the data set — F3 and F4 both do, so both must revisit it.

**API Reference parity is verified every release:**

```bash
grep -o 'path: "/api/[^"]*"' src/app/docs/page.tsx | sed 's/path: "//;s/"//' | sort -u > /tmp/documented.txt
find src/app/api -name route.ts | sed 's|src/app||;s|/route.ts||' | sort -u > /tmp/actual.txt
comm -13 /tmp/documented.txt /tmp/actual.txt   # must print nothing
```

### 10.3 PR workflow — mandatory

Never commit to `main`. Per release:

1. Branch off an up-to-date `main`: `git checkout main && git pull origin main && git checkout -b feat/vX.Y.Z-<slug>`
2. Multiple commits within the branch are fine and encouraged (one per task).
3. Full verification gate green **before** the release commit (§10.4).
4. `gh pr create` with a test-plan checklist in the body.
5. **Wait for the owner to merge.** Do not self-merge.
6. After merge: `git checkout main && git pull origin main` before starting the next release.

> **Known hazard:** a PR merged before a later commit is pushed silently drops
> that commit (this happened with the v4.0.6 screenshots). Always confirm
> `git status` is clean and the branch is fully pushed *before* asking for merge.

### 10.4 Verification gate — before every release commit

```bash
pnpm exec tsc --noEmit           # 0 errors
pnpm test                         # all green — record the count in the PR
pnpm exec eslint <changed files>  # 0 errors (pre-existing warnings OK)
rm -rf .next && pnpm run build    # succeeds
# + the API Reference parity check from §10.2
```

Baseline at v4.0.11: **0 tsc errors, 63/63 tests, 0 lint errors (11 pre-existing
warnings), build succeeds, route parity clean.** Any regression against this
baseline blocks the release.

### 10.5 Rollback

Three independent levers, in increasing order of cost:

1. **Unset the AI env keys** — every surface hides, no redeploy, no code change.
2. **Promote the previous Vercel deployment** — instant, no rebuild.
3. **`git revert` the release commit** — clean, because each feature is its own
   version and its own PR. Zero schema changes means nothing to migrate back.

---

## 11. Rev 2 correction log

| # | Rev 1 said | Reality | Fix |
| --- | --- | --- | --- |
| 1 | Rate limit "via `apiRateLimit`" | No such symbol. `src/lib/ratelimit.ts` exports `rateLimit` + `getRateLimitKey` (IP-keyed) | §3.2 adds `aiRateLimit(tokenHash, surface, limit)` |
| 2 | Snapshots reuse `computeRepoDora` | No such symbol. Real: `calculateRepoDora` (pure) / `calculateDoraMetrics` | §3.3 symbol table, all verified w/ line refs |
| 3 | Rate limits bound spend "to a few dollars/day" | Cache + limiter are in-process; per-instance on Vercel | §6 rewritten; `AI_DAILY_TOKEN_BUDGET` promoted into v4.1.0 |
| 4 | F2 first — "smallest, most visible" | Digest email cannot send (no `RESEND_API_KEY`/`SMTP_HOST`) | F2 gated on a precondition; order → F1, F4, F2, F3 |
| 5 | F2 prompt: "email body renders plain text" | `deliverLeadershipDigestEmail` renders HTML + text | Keep no-markdown rule; add `escapeHtml()` |
| 6 | F4 "thin context-builder", 0.5–1 d | `detectAnomalies` runs client-side only; server must re-fetch + recompute | Documented; effort → 0.75–1 d |
| 7 | F3 composes existing fetchers (implied cheap) | `getJobStats` is ~50 GitHub calls per build | Fan-out warning + 3 required mitigations |
| 8 | Route tests listed as routine | Zero route-test precedent; coverage scoped to `src/lib/**` | §7.1 — own task (0c) + extract-to-lib fallback |
| 9 | `AI_TIMEOUT_MS=30000`, no total cap | Worst case ~120s/request; no `maxDuration` on non-cron routes | 15s/attempt, 45s total, `maxDuration = 60` required |
| 10 | Flag named `ai-insights` | Existing flags are camelCase (`healthScorecard`, `workloadRisk`) | → `aiInsights` |
| 11 | Client flag implied as gating | localStorage-backed, trivially flipped | §5.5 — routes must check `aiEnabled()` themselves |
