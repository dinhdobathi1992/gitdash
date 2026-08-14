# GitDash AI Features Implementation Plan (v4.1.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design spec:** [`docs/specs/2026-08-14-ai-features-design.md`](../specs/2026-08-14-ai-features-design.md) — read it first. This plan implements rev 2 of that spec; where the two disagree, the spec wins.

**Goal:** Add an LLM insight layer over existing computed metrics — an AI Insights panel (F1), anomaly explanations (F4), an AI executive summary in the weekly digest (F2), and failure root-cause hypotheses (F3) — gated entirely by env-key presence so a deployment with no AI keys behaves exactly as v4.0.11 does today.

**Shipped as four independent releases: v4.1.0 → v4.1.3. One feature = one version = one PR.**

**Architecture:** One provider module (`src/lib/ai.ts`, raw `fetch`, zero new deps), pure allowlisting snapshot builders (`src/lib/ai-snapshots.ts`), versioned prompt constants (`src/lib/ai-prompts.ts`), and thin GET route handlers under `src/app/api/ai/`. No database schema changes. No new GitHub API surface — every fetch reuses an existing function.

**Tech Stack:** Next.js 16 route handlers, React 19, TypeScript strict, vitest (tests in `tests/**`, alias `@` → `src`), Tailwind v4.

---

## Context for the implementer

- Repo: `/Users/thi/Devops/gitdash`. Package manager is **pnpm** (`corepack enable pnpm`), pinned via `packageManager` in `package.json`.
- Commands: `pnpm run lint`, `pnpm exec tsc --noEmit`, `pnpm test` (vitest run). Tests live in `tests/*.test.ts` and import via `@/lib/...`.
- Commit style: Conventional Commits (`feat:`, `fix:`, `refactor:`) with a short imperative summary. **Never add `Co-Authored-By`.**
- There is no TODO/FIXME culture here — write header comments in the style of the surrounding files (block comment explaining *why*, not *what*).
- Every task ends with lint + typecheck + tests green, then one commit.

### 🔒 Release discipline — applies to every phase, no exceptions

This repo ships **one feature per version per PR**, established in v4.0.0–v4.0.3
and reaffirmed by the owner. Four releases in this plan:

| Release | Phase | Contents |
| --- | --- | --- |
| **v4.1.0** (chart `0.5.0`) | 0 + 1 | Core AI layer + F1 AI Insights Panel |
| **v4.1.1** (chart `0.5.1`) | 2 | F4 Anomaly Explanations |
| **v4.1.2** (chart `0.5.2`) | 3 | F2 AI Leadership Digest |
| **v4.1.3** (chart `0.5.3`) | 4 | F3 Root-Cause Hypotheses |

> If F2 is still blocked by the email precondition when its turn comes, **skip it
> and ship F3 as v4.1.2.** Never reserve a version for an unshipped feature.

**Every release ends with the Release Checklist below. Do not defer it to the end
of the plan — an unreleased phase is an unfinished phase.**

<a id="release-checklist"></a>
### ✅ Release Checklist (repeat verbatim at the end of each phase)

- [ ] **Bump the version in all 7 locations** — a release is incomplete if any is missed:
  | # | File | What |
  | --- | --- | --- |
  | 1 | `package.json` | `"version": "X.Y.Z"` |
  | 2 | `helm/gitdash/Chart.yaml` | `version:` (chart — see mapping table above) |
  | 3 | `helm/gitdash/Chart.yaml` | `appVersion: "X.Y.Z"` |
  | 4 | `src/app/docs/page.tsx` | `ReleaseNotes()` — **insert** new top entry, `badge: "latest"` |
  | 5 | `src/app/docs/page.tsx` | demote previous top entry to `badge: null` |
  | 6 | `src/app/docs/page.tsx` | `NEXT_PUBLIC_APP_VERSION ?? "X.Y.Z"` — sidebar badge |
  | 7 | `src/app/docs/page.tsx` | `NEXT_PUBLIC_APP_VERSION ?? "X.Y.Z"` — footer |
  | 8 | `CHANGELOG.md` | new `## [X.Y.Z] — YYYY-MM-DD` section at the top |

  > ⚠️ **Step 4 has been broken before** (v4.0.4): an edit *overwrote* the previous
  > top entry instead of inserting above it. After editing, re-read the file and
  > confirm **both** entries exist with the correct badges.

  Self-check:
  ```bash
  grep -n 'NEXT_PUBLIC_APP_VERSION ?? "' src/app/docs/page.tsx   # both must show the new version
  grep -n '"version"' package.json
  grep -n "^version:\|^appVersion:" helm/gitdash/Chart.yaml
  grep -n 'version: "' src/app/docs/page.tsx | head -3           # top 2 release entries
  ```

- [ ] **Docs — the feature gets its own page** (not just a changelog line):
  1. `feat-*` entry in the docs `NAV` array under **Features**
  2. Index card in `Features()` with `since: "X.Y.Z"` → renders the `VersionBadge`
  3. Detail component registered in `SECTION_COMPONENTS`
  4. Any new `/api/*` rows added to the **API Reference** section

- [ ] **CHANGELOG entry** in the established format: `### Overview`, `### Added`
      (one `####` per feature), `### Rollback`, `### Changed (infra)`.
      Rollback section must list all three levers: unset AI env keys · promote
      previous Vercel deployment · `git revert` (no migration).

- [ ] **Full verification gate** (below) — all green.

- [ ] **PR** — `gh pr create` with a test-plan checklist in the body.
      **Wait for the owner to merge. Never self-merge.**

- [ ] **After merge:** `git checkout main && git pull origin main` before starting
      the next phase.

### Verification gate

Run after every task (first three) and in full before every release commit:

```bash
pnpm exec tsc --noEmit           # must be 0 errors
pnpm test                         # all green — record the count for the PR body
pnpm exec eslint <changed files>  # 0 errors (pre-existing warnings elsewhere are OK)
rm -rf .next && pnpm run build    # must succeed

# API Reference parity — documented paths vs actual routes:
grep -o 'path: "/api/[^"]*"' src/app/docs/page.tsx | sed 's/path: "//;s/"//' | sort -u > /tmp/documented.txt
find src/app/api -name route.ts | sed 's|src/app||;s|/route.ts||' | sort -u > /tmp/actual.txt
comm -13 /tmp/documented.txt /tmp/actual.txt   # must be empty (no undocumented routes)
```

**Baseline at v4.0.11 (verified 2026-08-14):** 0 tsc errors · 63/63 tests ·
0 lint errors (11 pre-existing warnings) · build succeeds · route parity clean.
**Any regression against this baseline blocks the release.**

### Branch workflow

```bash
git checkout main && git pull origin main
git checkout -b feat/vX.Y.Z-<slug>
# …tasks, one commit each…
# …Release Checklist…
git push -u origin feat/vX.Y.Z-<slug>
gh pr create --title "feat: vX.Y.Z — <feature>" --body "…"
```

> ⚠️ **Known hazard:** a PR merged before a later commit is pushed silently drops
> that commit (this happened with the v4.0.6 screenshots — they had to be
> re-landed in a follow-up PR). Confirm `git status` is clean and the branch is
> fully pushed **before** asking for merge.

### Ground rules specific to this feature

1. **Never log prompt content or snapshot payloads.** Log provider, model, latency, HTTP status, token counts only.
2. **Never send** to a provider: tokens, run logs, file contents, workflow YAML, PR/commit message bodies, email addresses. Logins and repo/workflow/step names are allowed.
3. **Every AI route calls `aiEnabled()` itself.** The client feature flag is localStorage-backed and is not a security control.
4. **`generateJson` never throws.** Every failure path returns an `AiFailure`.
5. **Every AI route declares `export const maxDuration = 60;`**

---

## Phase 0 + 1 → **Release v4.1.0** (chart `0.5.0`)

**Branch:** `feat/v4.1.0-ai-insights`
**Contents:** core AI layer (tasks 0a–0c) + F1 AI Insights Panel (tasks 1a–1d) + release (task 1e).
**Why bundled:** the core layer produces no user-visible surface on its own — releasing it alone would mean a version bump whose release notes describe nothing a user can see. They remain separate *commits*, so F1 can be reverted independently of the layer.

### Task 0a: Provider module (`src/lib/ai.ts`)

**Why:** One place that owns keys, provider fallback, timeouts, budget accounting, and the never-throw contract. Everything else in this plan depends on it.

**Files:**
- Create: `src/lib/ai.ts`
- Create: `tests/ai.test.ts`
- Modify: `.env.local.example`

- [ ] **Step 1: Write the failing tests**

Create `tests/ai.test.ts`. Mock `globalThis.fetch` with `vi.fn()`; reset `process.env` and module state between tests (`vi.resetModules()` + dynamic `await import("@/lib/ai")` so env is re-read).

Cover:

```ts
describe("aiEnabled", () => {
  it("false when no keys are set");
  it("false when AI_DISABLED=true even with keys");
  it("true when GEMINI_API_KEY is set");
  it("true when only QWEN_API_KEY is set");
});

describe("configuredProviders", () => {
  it("returns [] with no keys");
  it("returns ['gemini','qwen'] in priority order when both keys set");
  it("never includes key material in its output");
});

describe("generateJson", () => {
  it("returns {ok:false, reason:'no_keys'} when unconfigured — and does not call fetch");
  it("returns {ok:false, reason:'disabled'} when AI_DISABLED=true");
  it("posts to <GEMINI_BASE_URL>/chat/completions with response_format json_object and temperature 0.2");
  it("returns ok:true with provider 'gemini' on a 200");
  it("falls back to qwen on a 401 from gemini WITHOUT retrying gemini");
  it("retries once after a 429, then falls back to qwen");
  it("falls back to qwen on a 500");
  it("returns reason:'provider_error' when all providers fail");
  it("returns reason:'timeout' when a provider exceeds AI_TIMEOUT_MS");
  it("returns reason:'timeout' when the total budget is exhausted mid-fallback");
  it("returns reason:'budget_exceeded' once the daily token budget is spent — without calling fetch");
  it("never throws, for every failure mode above");
});
```

- [ ] **Step 2: Implement `src/lib/ai.ts`**

Export exactly the interface in spec §3.1 (`AiProvider`, `AiSuccess`, `AiFailure`, `AiResult`, `aiEnabled`, `configuredProviders`, `generateJson`).

Implementation notes:

- Read env **inside** the functions, not at module scope, so tests can vary it.
- Provider config table:
  ```ts
  const PROVIDERS = [
    { name: "gemini" as const, keyEnv: "GEMINI_API_KEY", baseEnv: "GEMINI_BASE_URL",
      modelEnv: "GEMINI_MODEL",
      defaultBase: "https://generativelanguage.googleapis.com/v1beta/openai",
      defaultModel: "gemini-2.5-flash" },
    { name: "qwen" as const, keyEnv: "QWEN_API_KEY", baseEnv: "QWEN_BASE_URL",
      modelEnv: "QWEN_MODEL",
      defaultBase: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      defaultModel: "qwen-plus" },
  ];
  ```
- Request shape (both providers are OpenAI-compatible):
  ```ts
  await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      temperature: opts?.temperature ?? 0.2,
      max_tokens: opts?.maxOutputTokens ?? 900,
      response_format: { type: "json_object" },
    }),
    signal: attemptController.signal,
  });
  ```
- **Total-budget guard:** compute `const deadline = Date.now() + totalBudgetMs` once at the top. Before each attempt, `if (Date.now() >= deadline) return { ok:false, reason:"timeout", … }`. Each attempt's own timeout is `Math.min(perAttemptMs, deadline - Date.now())`.
- **Daily token counter:** module-level `let budget = { day: "", tokens: 0 }`. Key on `new Date().toISOString().slice(0,10)`; reset when the day changes. Add `usage.prompt_tokens + usage.completion_tokens` after each success. Short-circuit when `AI_DAILY_TOKEN_BUDGET > 0 && budget.tokens >= limit`. **Write a header comment stating plainly that this is per-instance and therefore a damage-limiter, not a global cap** (spec §6.2).
- Extract `content` from `json.choices?.[0]?.message?.content`. If missing/empty → treat as a provider error and fall through.

- [ ] **Step 3: Add the env block to `.env.local.example`**

Match the file's existing comment style (`# ── Section ──` headers, commented-out values):

```bash
# ── AI features (optional) ────────────────────────────────────────────────────
# When no key is set, every AI surface is hidden and GitDash behaves exactly as
# it did before v4.1.0. Gemini is tried first, Qwen is the fallback.
# GEMINI_API_KEY=...
# GEMINI_MODEL=gemini-2.5-flash
# QWEN_API_KEY=...
# QWEN_MODEL=qwen-plus
#
# Safety valves:
# AI_DISABLED=true              # hard-kill the layer regardless of keys
# AI_TIMEOUT_MS=15000           # per provider attempt
# AI_TOTAL_BUDGET_MS=45000      # across all attempts in one request
# AI_DAILY_TOKEN_BUDGET=2000000 # per instance per UTC day; 0 = unlimited
```

- [ ] **Step 4: Verify + commit** — `feat: add AI provider layer with Gemini/Qwen fallback`

**Acceptance:** all `tests/ai.test.ts` green; no network calls in CI; `grep -rn "console.log" src/lib/ai.ts` shows no payload logging.

---

### Task 0b: Status route, hook, and feature flag

**Why:** The UI needs a cheap way to ask "is AI configured?" without exposing keys, and the flag needs to exist before any surface can reference it.

**Files:**
- Create: `src/app/api/ai/status/route.ts`
- Create: `src/lib/use-ai-enabled.ts` (there is no `src/hooks/` dir in this repo; client-side hooks live in `src/lib` — precedent: `src/lib/swr.tsx`)
- Modify: `src/lib/ratelimit.ts` (add `aiRateLimit`)
- Modify: `src/lib/feature-flags.ts` (add `aiInsights`)
- Modify: `src/app/settings/page.tsx` (flag row)

- [ ] **Step 1: Add `aiRateLimit` to `src/lib/ratelimit.ts`**

```ts
/**
 * Token-hash-keyed limiter for authenticated, cost-bearing routes.
 *
 * The existing getRateLimitKey() keys on IP, which is wrong for AI routes:
 * cost follows the *token* (one user behind changing IPs should still be
 * limited). Callers pass hashKey(token) from src/lib/cache.ts.
 */
export function aiRateLimit(
  tokenHash: string,
  surface: string,
  limit: number,
): { allowed: boolean; retryAfterMs?: number } {
  return rateLimit(`ai:${surface}:${tokenHash}`, limit, 60_000);
}
```

- [ ] **Step 2: Add the `aiInsights` flag**

In `src/lib/feature-flags.ts`, add `aiInsights: boolean;` to `FeatureFlags` and `aiInsights: true` to `DEFAULT_FLAGS`. (Defaulting to `true` is correct — the env-key check is the real gate, so a flag default of `true` means "show it once keys exist.")

In `src/app/settings/page.tsx`, add a row alongside the existing entries (~line 138):

```ts
{ key: "aiInsights", label: "AI Insights", description: "LLM-generated analysis of your metrics. Requires AI provider keys to be configured on the server.", affects: "Repository Overview, Organization Health, Workflow Detail" },
```

- [ ] **Step 3: Implement `/api/ai/status`**

```ts
export const maxDuration = 60;

export async function GET() {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(
    { enabled: aiEnabled(), providers: configuredProviders() },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
```

Do **not** add this path to `ALWAYS_PUBLIC` in `src/middleware.ts` — it must stay behind session auth.

- [ ] **Step 4: Implement the `useAiEnabled()` hook**

Thin SWR wrapper over `/api/ai/status` returning `{ enabled: boolean; providers: string[]; isLoading: boolean }`. Use the existing `fetcher` from `@/lib/swr`. Because `SWRProvider` sets `dedupingInterval: 600_000`, all call sites share one request automatically — no extra caching needed.

- [ ] **Step 5: Verify + commit** — `feat: add /api/ai/status, useAiEnabled hook, and aiInsights flag`

**Acceptance:** `/api/ai/status` returns `{enabled:false, providers:[]}` with no keys set, 401 unauthenticated, and never includes key material.

---

### Task 0c: Route-handler test pattern

**Why:** Spec §7.1 — this repo has zero route-handler tests and `vitest.config.ts` scopes coverage to `src/lib/**`. Establish the pattern once, on the simplest route, before four more routes depend on it.

**Files:**
- Create: `tests/api-ai-status.test.ts`

- [ ] **Step 1: Attempt the direct approach**

Import the route handler and mock its dependencies:

```ts
vi.mock("@/lib/session", () => ({ getTokenFromSession: vi.fn() }));
vi.mock("@/lib/ai", () => ({ aiEnabled: vi.fn(), configuredProviders: vi.fn() }));

const { GET } = await import("@/app/api/ai/status/route");
```

Assert: 401 when `getTokenFromSession` resolves `null`; `{enabled:true, providers:["gemini"]}` when mocked so.

- [ ] **Step 2: If Step 1 is awkward, use the extract-to-lib fallback**

If mocking `next/headers`/iron-session fights back, **stop and refactor instead** — this is the preferred outcome, not a defeat. Extract the logic into a pure function in `src/lib/` taking its dependencies as arguments, unit-test that, and leave the route as a 5-line adapter. Precedent: `computeScorecard` (v4.0.3) and `computeBusFactor` (v4.0.0) were both extracted out of their routes for exactly this reason.

Record which approach won in the test file's header comment, so tasks 1–4 follow it without re-deciding.

- [ ] **Step 3: Verify + commit** — `test: establish route-handler test pattern for AI routes`

**Acceptance:** the chosen pattern is documented in a header comment and is reusable by the remaining four routes.

---

### Task 1a: Insights snapshot builder

**Why:** The snapshot is the privacy enforcement point (spec §3.3) — it must exist and be tested before anything sends data anywhere.

**Files:**
- Create: `src/lib/ai-snapshots.ts`
- Create: `tests/ai-snapshots.test.ts`

- [ ] **Step 1: Write the failing tests, including the privacy assertion**

The privacy test is the important one. Write a reusable helper and use it in every snapshot test in this plan:

```ts
const FORBIDDEN_KEYS = ["token", "pat", "accessToken", "logs", "log", "body",
  "content", "yaml", "yml", "message", "patch", "diff", "email"];

function assertNoForbiddenKeys(obj: unknown, path = "$") {
  if (obj === null || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    expect(FORBIDDEN_KEYS, `forbidden key at ${path}.${k}`).not.toContain(k);
    assertNoForbiddenKeys(v, `${path}.${k}`);
  }
}
```

Then: build a snapshot from fixtures and assert exact shape + `assertNoForbiddenKeys(snapshot)`.

- [ ] **Step 2: Implement `buildInsightsSnapshot`**

```ts
export async function buildInsightsSnapshot(
  token: string,
  scope: { surface: "repo"; owner: string; repo: string }
        | { surface: "org"; org: string },
): Promise<InsightsSnapshot>;
```

Reuse **only** these (verified symbols, spec §3.3): `getRepoSummary`, `calculateRepoDora` / `calculateDoraMetrics`, `computeBusFactor`, `computeScorecard`, `detectAnomalies`, `listWorkflowFileCommits`.

Build the object field-by-field — **never spread a raw API object into the snapshot.** For `recent_workflow_changes`, map `WorkflowFileCommit` down to `{ date, author_login }` only; the source type has `message`, `sha`, and `html_url`, none of which may be included.

Use `pLimitSettled` from `src/lib/concurrency.ts` for any fan-out, matching how `computeScorecard` does it.

- [ ] **Step 3: Verify + commit** — `feat: add insights snapshot builder with allowlisted fields`

**Acceptance:** `assertNoForbiddenKeys` passes; snapshot contains no field absent from the `InsightsSnapshot` interface.

---

### Task 1b: Prompts module + response validation

**Files:**
- Create: `src/lib/ai-prompts.ts`
- Create: `src/lib/ai-schema.ts`
- Create: `tests/ai-schema.test.ts`

- [ ] **Step 1: `src/lib/ai-prompts.ts`** — export the system prompts from spec §4 as versioned `const` strings (`INSIGHTS_SYSTEM_PROMPT`, later `ANOMALY_SYSTEM_PROMPT`, `DIGEST_SYSTEM_PROMPT`, `ROOT_CAUSE_SYSTEM_PROMPT`). Copy them verbatim from the spec.

- [ ] **Step 2: `src/lib/ai-schema.ts`** — pure validators, no deps:

```ts
export interface InsightsContent { summary: string; bullets: string[]; actions: string[]; }
export function parseInsightsContent(raw: string): InsightsContent | null;
```

Rules: `JSON.parse` in a try/catch (return `null`, never throw); require `summary` string ≤ 400 chars; `bullets` string[] ≤ 6, each ≤ 200 chars; `actions` string[] ≤ 4, each ≤ 200 chars. Trim strings; drop extra keys.

- [ ] **Step 3: Tests** — valid payload; missing key; wrong types; oversize summary; too many bullets; non-JSON garbage; JSON wrapped in ```` ```json ```` fences (models do this — strip fences before parsing).

- [ ] **Step 4: Verify + commit** — `feat: add AI prompt constants and response schema validation`

---

### Task 1c: `/api/ai/insights` route

**Files:**
- Create: `src/app/api/ai/insights/route.ts`
- Create: `tests/api-ai-insights.test.ts` (following task 0c's pattern)

- [ ] **Step 1: Implement**, following the handler shape in spec §3.2 exactly. Params: `owner`+`repo` (repo surface) or `org` (org surface); validate with `validateOwner`/`validateRepo`/`validateOrg`. Rate limit 20/min. Cache TTL 900s, key `ai:insights:${tokenHash}:${scope}:${fingerprint}`.

  Support `?refresh=1` to bypass cache (call the factory directly, then write through). Still rate-limited — do not let refresh become an unmetered path.

  On `parseInsightsContent` returning `null`, retry `generateJson` **once**, then map to 503.

- [ ] **Step 2: Tests** — 401 unauthenticated; 503 when `aiEnabled()` false; 429 over rate limit; 503 on `AiFailure`; 200 + `cached:true` on second identical call; `budget_exceeded` → 429.

- [ ] **Step 3: Verify + commit** — `feat: add /api/ai/insights route`

---

### Task 1d: `AiInsightsCard` component + page wiring

**Files:**
- Create: `src/components/AiInsightsCard.tsx`
- Modify: `src/app/repos/[owner]/[repo]/page.tsx`
- Modify: `src/app/org/[orgName]/health/page.tsx`

- [ ] **Step 1: Build the card.** Reuse the collapsible `Section` visual pattern established in v4.0.11 (`src/app/repos/[owner]/[repo]/team/page.tsx` — tone-colored icon badge, title, count badge, description, Show/Hide pill). Use `Sparkles` from lucide, violet tone.

  States, all required:
  - **Loading** — spinner + "Analysing your metrics…" (follow the v4.0.10 precedent in the health page: a bare skeleton reads as frozen; a spinner + status line reads as working).
  - **Success** — `summary` paragraph, `bullets` list, `actions` list under an "Actions" subheading.
  - **Unavailable (503)** — muted one-liner, card stays collapsed. Never an error-red box; this is an optional enhancement, not a failure.
  - **Rate-limited (429)** — "Try again in a minute."
  - Always render a small provider/model attribution line and a "Regenerate" button.

- [ ] **Step 2: Wire into both pages.** Render only when `useAiEnabled().enabled && flags.aiInsights`. When either is false, render **nothing** — no placeholder, no "enable this" nag.

- [ ] **Step 3: Verify + commit** — `feat: add AI Insights card to repo overview and org health pages`

**Acceptance:** with no AI keys configured, both pages are byte-identical in behavior to v4.0.11.

---

### Task 1e: 🚢 Release v4.1.0

**Files:** `package.json`, `helm/gitdash/Chart.yaml`, `CHANGELOG.md`, `src/app/docs/page.tsx`, `README.md`, `.env.local.example`

- [ ] **Step 1: Docs — AI transparency section.** New `feat-ai-insights` entry in `NAV` under Features, index card in `Features()` with `since: "4.1.0"`, and a detail component in `SECTION_COMPONENTS`. Must state explicitly:
  - which providers receive data, and that keys are server-side only;
  - the exact allowlist of what is sent (metrics, repo/workflow/job/step names, **logins**, dates);
  - the explicit never-sent list (tokens, logs, code, YAML, PR/commit bodies, emails);
  - that all surfaces disappear when no keys are configured.

- [ ] **Step 2: API Reference** — add `/api/ai/status` and `/api/ai/insights` rows, then run the parity check (must print nothing).

- [ ] **Step 3: README** — add an "AI Insights" row to the capability table (~line 50).

- [ ] **Step 4: Run the full [Release Checklist](#release-checklist)** — version to `4.1.0`, chart to `0.5.0`.

- [ ] **Step 5: Commit + PR** — `feat: v4.1.0 — AI insight layer and AI Insights panel`.
  PR body must include the test-plan checklist, the recorded test count, and a one-line note that the feature is inert without env keys. Then flag the four reviewer notes at the bottom of this plan.

---

## Phase 2 → **Release v4.1.1** (chart `0.5.1`) — F4: Anomaly Explanations

**Branch:** `feat/v4.1.1-anomaly-explanations` (off freshly pulled `main`)

### Task 2a: Anomaly snapshot builder

**Files:** Modify `src/lib/ai-snapshots.ts`, `tests/ai-snapshots.test.ts`

- [ ] **Step 1:** Implement `buildAnomalySnapshot(token, { owner, repo, workflow_id, metric })`.

  **Note the server-side rebuild** (spec §F4): call `listWorkflowRuns(token, owner, repo, workflow_id, 50)`, map to `AnomalyInputRun[]`, then run `detectAnomalies` + `computeBaseline` server-side. The client already computed these, but snapshots must be server-assembled. Cap `outliers` at 5, most recent first. Add `listWorkflowFileCommits(token, owner, repo, 10)` for `concurrent_signals`, mapped to `{ date, author_login }` only.

- [ ] **Step 2:** Tests including `assertNoForbiddenKeys`.
- [ ] **Step 3:** Commit — `feat: add anomaly snapshot builder`

### Task 2b: Route + UI

**Files:** Create `src/app/api/ai/anomaly-explanation/route.ts`, `tests/api-ai-anomaly.test.ts`; modify `src/app/repos/[owner]/[repo]/workflows/[workflow_id]/page.tsx`; add `parseAnomalyContent` to `src/lib/ai-schema.ts`.

- [ ] **Step 1:** Route — params `owner`, `repo`, `workflow_id` (`validateId`), `metric` (must be exactly `"duration"` or `"queue_wait"`; reject anything else with a 400 — do not pass user strings through to a prompt). Rate limit 20/min, TTL 1800s.
- [ ] **Step 2:** `parseAnomalyContent` → `{ explanation: string; check: string }`, each ≤ 400 chars.
- [ ] **Step 3:** UI — a "Why?" button under each anomaly badge that lazy-fetches (SWR key `null` until clicked). Inline result, no modal.
- [ ] **Step 4:** Verify + commit — `feat: add AI anomaly explanations to workflow detail`

### Task 2c: 🚢 Release v4.1.1

- [ ] **Step 1: Docs** — new `feat-ai-anomaly` page (NAV + index card `since: "4.1.1"` + detail component), and add the `/api/ai/anomaly-explanation` API Reference row.
- [ ] **Step 2: Amend the transparency section** — F4 sends actor logins and trigger names; confirm the allowlist wording still covers it, and widen it if not.
- [ ] **Step 3: Full [Release Checklist](#release-checklist)** — version `4.1.1`, chart `0.5.1`.
- [ ] **Step 4: Commit + PR** — `feat: v4.1.1 — AI anomaly explanations`.

---

## Phase 3 → **Release v4.1.2** (chart `0.5.2`) — F2: AI Leadership Digest

> ### ⚠️ Gate — do not start until this is true
> `RESEND_API_KEY` or `SMTP_HOST` is configured **and** a real weekly digest email has been received. Until then `deliverLeadershipDigestEmail` (`src/lib/notifier.ts:304`) returns `{ok:false, "No email provider configured"}` and this whole phase ships something no one can see.
>
> **If still blocked when you reach this point: skip to Phase 4 and revisit.**

### Task 3a: Digest snapshot, escaping, and AI summary

**Files:** Modify `src/lib/notifier.ts`, `src/lib/sync.ts`, `src/lib/ai-snapshots.ts`, `src/lib/ai-prompts.ts`, `tests/notifier.test.ts`

- [ ] **Step 1: Add `escapeHtml()` to `src/lib/notifier.ts`** and apply it to the new `aiSummary` **and** to the existing `summary_line` / `highlights` / `concerns` interpolations. Those are currently un-escaped; same helper, same file, fix them together.

- [ ] **Step 2:** Extend `LeadershipDigestEmailInput` with `aiSummary?: string`. Render it above the existing narrative under an explicit `<h3>AI summary</h3>` heading (transparency requirement, spec §5.7) in the HTML body, and as an `AI summary:` block in the text body.

- [ ] **Step 3:** In `sendWeeklyLeadershipDigests` (`src/lib/sync.ts:178`), after `generateLeadershipNarrative`, call `generateJson` with the digest snapshot. Wrap in try/catch **and** check `result.ok` — on any failure, log and pass `aiSummary: undefined`. The digest must send regardless.

- [ ] **Step 4: Test the failure path explicitly** — mock `generateJson` to return `AiFailure` and assert the email still sends with the rule-based narrative intact. This is the single most important test in this phase.

- [ ] **Step 5:** Verify + commit — `feat: add AI executive summary to weekly leadership digest`

### Task 3b: 🚢 Release v4.1.2

- [ ] **Step 1: Docs** — extend the existing **Leadership Digest** feature page (added in v4.0.6) with an "AI summary" subsection carrying a `VersionBadge` `since: "4.1.2"`. This feature amends an existing page rather than adding a new one — no new NAV entry, no new API Reference row (F2 has no route).
- [ ] **Step 2: Full [Release Checklist](#release-checklist)** — version `4.1.2`, chart `0.5.2`.
- [ ] **Step 3: Commit + PR** — `feat: v4.1.2 — AI executive summary in weekly leadership digest`.
  State in the PR body whether a real digest email was received (the Phase 3 gate).

---

## Phase 4 → **Release v4.1.3** (chart `0.5.3`) — F3: Root-Cause Hypotheses

> If F2 was skipped, **this ships as v4.1.2 / chart `0.5.2`** instead. Adjust every number in this phase accordingly.

**Files:** Modify `src/lib/ai-snapshots.ts`, `src/lib/ai-schema.ts`, `src/lib/ai-prompts.ts`; create `src/app/api/ai/root-cause/route.ts`, `tests/api-ai-root-cause.test.ts`; modify the workflow detail page.

- [ ] **Step 1: Snapshot builder** — `buildRootCauseSnapshot(token, { owner, repo, workflow_id })`.

  **Apply all three fan-out mitigations from spec §F3 — they are required, not optional:**
  1. Call `getJobStats(token, owner, repo, workflow_id, 30)` — **30, not the default 50**.
  2. The route only runs when `failure_count >= 3` (enforce server-side too, not just in the UI: return 200 with `content: null` and let the UI hide).
  3. Wrap the **snapshot build itself** in `withCache` (key `ai:root-cause-snap:${tokenHash}:${owner}/${repo}/${workflow_id}`, TTL 600) — this is the one surface where caching the GitHub fan-out separately from the LLM call is worth the extra key.

  Derive `branch_type` by comparing `head_branch` to the repo default branch: `"main"` if equal, `"pr"` if `event === "pull_request"`, else `"other"`.

- [ ] **Step 2:** `parseRootCauseContent` → `{ hypotheses: Array<{rank, hypothesis, evidence, confidence, next_step}> }`, ≤ 3 entries, `confidence` must be one of `"high"|"medium"|"low"` (reject the payload otherwise).

- [ ] **Step 3:** Route — rate limit **10/min** (half the others; this is the expensive one), TTL 600s.

- [ ] **Step 4:** UI — ranked list under the reliability tab charts, confidence badge per hypothesis (red/amber/slate), evidence line in muted text, `next_step` as the call to action. Shown only when `failure_count >= 3`.

- [ ] **Step 5:** Verify + commit — `feat: add AI failure root-cause hypotheses to workflow detail`

### Task 4b: 🚢 Release v4.1.3

- [ ] **Step 1: Docs** — new `feat-ai-root-cause` page (NAV + index card `since: "4.1.3"` + detail component). Document the confidence levels and state plainly that hypotheses are derived from **metadata only, never run logs** — this is the feature most likely to be misread as log analysis.
- [ ] **Step 2: API Reference** — add the `/api/ai/root-cause` row; run the parity check.
- [ ] **Step 3: Amend the transparency section** — F3 sends job and step **names**; confirm the allowlist wording covers them explicitly.
- [ ] **Step 4: Full [Release Checklist](#release-checklist)** — version `4.1.3`, chart `0.5.3`.
- [ ] **Step 5: Commit + PR** — `feat: v4.1.3 — AI failure root-cause hypotheses`.

---

## Final state (all four releases merged)

- [ ] `package.json` at `4.1.3`, chart at `0.5.3` / appVersion `4.1.3`
- [ ] `CHANGELOG.md` has four new sections: 4.1.0, 4.1.1, 4.1.2, 4.1.3
- [ ] Docs `ReleaseNotes()` has four new entries; only 4.1.3 carries `badge: "latest"`
- [ ] Docs Features section has 3 new pages (`feat-ai-insights`, `feat-ai-anomaly`, `feat-ai-root-cause`) plus an amended Leadership Digest page
- [ ] API Reference documents all four `/api/ai/*` routes; parity check clean
- [ ] Verification baseline still met: 0 tsc errors · tests all green (≥63, will be higher) · 0 lint errors · build succeeds
- [ ] With every AI env var unset, the app is behaviorally identical to v4.0.11

---

## Release notes for the reviewer

Call these out explicitly in the PR body of **v4.1.0** (and re-flag any that a later release changes) — they are the judgement calls a reviewer should check rather than discover:

1. **`AI_DAILY_TOKEN_BUDGET` is per-instance, not global** (spec §6.2). It limits damage; it does not hard-cap spend across a serverless fleet. A Neon-backed limiter was deliberately deferred to preserve the zero-migration rollback story.
2. **The AI cache does not protect GitHub rate limits** (spec §6.3) — snapshot-fingerprint keying means a cache hit still pays the GitHub fan-out. F3 is the sharp edge and carries three required mitigations.
3. **Logins are sent to the AI provider.** This is intentional (accountability statements need names) and is documented on the docs page. Flag it for an explicit sign-off.
4. **F2 was resequenced** behind an email-provider precondition; if it shipped without one, say so.
