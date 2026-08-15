# Changelog

All notable changes to GitDash are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [4.2.1] — 2026-08-15

### Overview
The DORA figures on the repository overview were **inferred from naming conventions, not measured**. This adds real delivery metrics from GitHub's Deployments API — and, just as importantly, makes the app state which of the two you are looking at.

### The problem

| Metric | Previous derivation | How it failed |
| --- | --- | --- |
| Deploy frequency | GitHub Releases → **falls back to every merged PR** | A team that doesn't tag releases had its *merge rate* reported as its deploy rate |
| Change failure rate | PRs whose branch matches `/hotfix\|revert\|fix-prod\|emergency/` | A team that doesn't use those names got **exactly 0%** — which reads as excellence, not as no signal |
| MTTR | How long those PRs took to merge | Same fragility, plus it measured *merge speed*, not recovery |

These are reasonable proxies. The danger is that they fail **quietly and flatteringly**.

### Added

#### Deployments panel (`/repos/[owner]/[repo]`)
- Real deploy frequency, change failure rate and MTTR from GitHub's Deployments API, with a per-environment breakdown and recent rollout history.
- Production environment is detected by convention (`production`, `prod`, `live`, `main`), falling back to the busiest environment.
- New `GET /api/github/deployments`, cached 10 minutes.

### Changed

#### Provenance is now explicit
- Measured figures **never silently replace** estimated ones. The response carries `source`, and the panel is labelled **Measured** when real deployments exist.
- When a repo has no deployments, the panel *explains what the DORA cards above actually represent* rather than hiding. Knowing whether a number was measured or inferred matters more than the number.
- The DORA metrics reference now documents both definitions side by side.

#### Definitions that avoid flattering the numbers
- **Only successful production deploys** count toward frequency — a failed rollout is not a delivery.
- Pending and in-progress deploys are excluded from the failure rate entirely; a rate with nothing conclusive returns **null rather than 0%**.
- MTTR measures from the **first failure of a streak** to the next success, because recovery starts when things broke, not at the last symptom before the fix.
- A deployment with no status is treated as inconclusive, never as a failure.
- MTTR built from a single recovery is labelled as an anecdote in the UI rather than presented as a trend.

### Cost
- One call to list deployments, then status lookups for the 40 most recent (concurrency 8) — bounded, and `partial` is set when the sample was truncated or a lookup failed.

### Verified
- Test count 291 → 308, covering provenance, production-environment selection, rate exclusions, streak-aware MTTR, unrecovered failures, and partial-sample resilience.

### Rollback
1. **Promote the v4.2.0 Vercel deployment** — instant.
2. **`git revert`** — the panel is additive and the existing DORA calculation is untouched; no schema change.

### Changed (infra)
- Bumped app version from 4.2.0 to 4.2.1
- Bumped Helm chart version from 0.6.0 to 0.6.1

---

## [4.2.0] — 2026-08-15

### Overview
The Security page reported none of GitHub's own security findings. It statically analysed workflow YAML — useful, and something GitHub does not do for you — but a page called *Security* that cannot say how many critical CVEs are open, or whether a credential is currently leaked, is answering the wrong question first. This adds those.

First of four features chosen from a codebase gap review; the others are honest DORA from real deployments, issues/triage health, and a command palette.

### Added

#### GitHub Security Alerts
- New panel on `/repos/[owner]/[repo]/security`, above the workflow analysis — a live CVE or leaked credential outranks a YAML anti-pattern.
- Three sources: **Dependabot** (vulnerable dependencies), **code scanning** (CodeQL and third-party), and **secret scanning** (committed credentials).
- Severity counts, the age of the oldest open alert, and — per source — how many alerts were resolved in the last 90 days plus **mean time to remediate**. "We fix things quickly" becomes a number.
- New `GET /api/github/security-alerts`, cached 5 minutes.

### Changed

#### An unreadable source must never look like a clean one
This is the design rule the whole feature is built around, and it drove most of the code:

- Each source carries its **own status** — `ok`, `forbidden`, `not_enabled`, or `error` — rather than collapsing into one success/failure for the request.
- A `403` renders as a loud, actionable warning; a genuinely clean repo renders as a calm green state. Showing "0 alerts" when the real answer is "we could not check" would turn a token permission gap into false confidence on a security page.
- A `404` is reported as *not enabled for this repo*, not as a permission problem — those need different fixes and shouldn't be conflated.
- Every failure mode is covered by a test, including all three sources failing at once.

#### Scope requirement, stated plainly
- These endpoints need the **`security_events`** scope, which GitDash has never requested — so most existing tokens will be refused. The panel says exactly that, with the fix for both classic and fine-grained PATs, instead of surfacing a generic error.

#### Severity normalisation
- GitHub uses several severity vocabularies. Dependabot's `moderate` maps to medium; code scanning prefers `security_severity_level` over `rule.severity`, since the latter describes rule *confidence* (note/warning/error), not impact.
- Secret scanning alerts carry no severity at all and are always ranked **critical** — a live credential needs no triage debate.

#### Page retitled
- "Workflow Security" → **"Security"**, since it now covers more than workflow files.

### Verified
- Test count 278 → 291, covering permission and availability failures, severity normalisation across all three vocabularies, ordering, ageing, and MTTR.

### Rollback
1. **Disable the Security Scan feature flag** — hides the whole page including the new panel.
2. **Promote the v4.1.5 Vercel deployment** — instant.
3. **`git revert`** — no schema change in this release.

### Changed (infra)
- Bumped app version from 4.1.5 to 4.2.0
- Bumped Helm chart version from 0.5.5 to 0.6.0

---

## [4.1.5] — 2026-08-15

### Overview
Organizations can bring their own AI provider. A shared team deployment usually wants its own LLM account and model choice rather than whatever the server operator configured — while a self-hosted personal instance should keep working out of the box with no setup at all. Those are different needs, so the feature is deliberately mode-dependent.

### Added

#### AI Provider settings — organization mode only
- **Settings → AI Provider**: choose provider (Bailian, Gemini or Qwen), model, API key, and an optional base URL for a gateway or regional endpoint. Stored in the database (**migration 6**, `ai_settings`).
- Model is a free-text field with per-provider suggestions, so any model an account can reach is accepted rather than only a hardcoded list.
- **Standalone mode is untouched** — the section does not render, `PUT` returns 403, and the environment defaults apply exactly as before. Nothing about a standalone deployment changes.

### Changed

#### A configured key is used exclusively
- When an organization sets its own provider, the server's keys are **never tried as a fallback behind it**. If the org's key fails, the request fails.
- Falling back would silently bill the deployment owner for an organization's traffic — the kind of surprise best discovered before an invoice rather than after. There is a test asserting exactly one provider attempt in this case.

#### Credential handling
- The key is write-only: encrypted at rest with the same AES-256-GCM helper introduced for email credentials (`src/lib/secret-box.ts`), never returned to the browser, surfaced only as a masked hint. A blank field on save keeps the stored key.
- Base URLs must be `https` — that URL carries the API key, so `http` is refused rather than accepted with a warning.
- Like email settings, this is instance-wide with no per-user scoping, so `updated_by` / `updated_at` record who last changed it.

#### API surface
- `aiEnabled()` and `configuredProviders()` are now **async**, since either may depend on stored settings. All four AI routes await them.
- `/api/ai/status` and `/api/settings/ai` both report `effective_source` — whether the override, the environment, or nothing is actually in effect.
- Standalone mode never queries the database for this: the mode check short-circuits before any lookup.

### Verified
- Test count 266 → 278, covering mode gating, decryption failure, default-model fallback, exclusive-use billing safety, and normal environment behaviour when no override exists.

### Rollback
1. **Toggle the override off in Settings** — resolution returns to the environment defaults, no redeploy.
2. **Promote the v4.1.4 Vercel deployment** — instant.
3. **`git revert`** — migration 6 only *adds* a table; nothing existing is altered, so no down-migration is required.

### Changed (infra)
- Bumped app version from 4.1.4 to 4.1.5
- Bumped Helm chart version from 0.5.4 to 0.5.5
- Migration 6 creates `ai_settings` (singleton row, `CHECK (id = 1)`)

---

## [4.1.4] — 2026-08-14

### Overview
**F2 — the last unshipped feature of the original AI design.** The Weekly Leadership Digest gains an LLM-written executive summary above its rule-based narrative. This was deliberately deferred through v4.1.0–v4.1.2 because the digest email could not send at all; v4.1.3 made email configurable in-app, so the summary now activates the moment a provider key is entered.

### Added

#### AI executive summary in the Weekly Leadership Digest
- Four to six sentences of plain prose at the top of the Monday email, aimed at a reader who will not open the dashboard: most important change first, then the main risk, then one focus for the coming week.
- **Zero additional GitHub calls.** `buildDigestSnapshot()` performs no fetching — it composes the scorecard and narrative the digest already computed for the email itself.
- The rule-based narrative is passed to the model as an **anchor**: it may reprioritise and rephrase, but never contradict. The two halves of the email cannot disagree in front of a CTO.
- The AI section is explicitly headed **"AI summary"** in both the HTML and plain-text bodies, so a reader always knows which half a machine wrote.

### Fixed

#### Unescaped HTML in the digest email
- The digest interpolated repository names and narrative text straight into an HTML body. With model-generated text now in that body, every field goes through a new `escapeHtml()` helper. The plain-text alternative is deliberately left unescaped — it is not markup.

### Changed

#### The digest sends regardless of AI
- Every failure path degrades to the rule-based narrative alone: no provider keys, provider error, timeout, exhausted token budget, unparseable response, wrong-shaped JSON, and an outright throw. **There is a test for each.** A weekly email that stopped arriving because a model was unavailable would be worse than never adding the summary.
- An email delivery failure is still reported as a failure — only the *AI* is best-effort.

#### Week-over-week claims are forbidden in the prompt
- Because the email is weekly, models naturally reached for phrasing like *"this risk remains unchanged from last week"* — caught while reviewing real generated output. **The scorecard contains no previous week**: its `trend` field compares the recent half of a 30-day window against the prior half. The prompt now rules this out explicitly; verified across three consecutive live generations.

### Verified
- Live end-to-end against the provider: ~1.7–2.0s, ~550 in / ~130 out tokens, valid schema and clean prose on every run, no unsupported temporal claims.
- Test count 240 → 266.

### Rollback
1. **Unset the AI keys** — the digest reverts to the rule-based narrative alone, no redeploy.
2. **Promote the v4.1.3 Vercel deployment** — instant.
3. **`git revert`** — no schema change in this release.

### Changed (infra)
- Bumped app version from 4.1.3 to 4.1.4
- Bumped Helm chart version from 0.5.3 to 0.5.4

---

## [4.1.3] — 2026-08-14

### Overview
Email delivery moves out of environment variables and into Settings. Three features already sent email — alert notifications, the daily digest, and the Weekly Leadership Digest — but configuring them required an env var and a redeploy, and a misconfiguration was completely invisible until an expected email simply never arrived.

**This is the prerequisite for F2 (AI Leadership Digest)**, which was skipped in v4.1.2 precisely because the digest email could not send.

### Added

#### Email Delivery settings (`/settings`)
- Configure **Resend** or **SendGrid** in the app, stored in the database (**migration 5**, `email_settings`). No redeploy needed.
- **"Send test email"** — email was the one feature whose misconfiguration produced no visible signal; the only trace was a server log nobody reads.
- Status pill shows what is *actually* in effect: Settings, environment variables, or nothing.

#### Credential handling
- The API key is **write-only**: encrypted at rest with AES-256-GCM (`src/lib/secret-box.ts`, key derived from `SESSION_SECRET` with domain separation) and never returned to the browser. The UI shows a masked hint (`••••4f2a`); a blank field means "keep the stored key".
- Encryption exists because this column lands in every database backup — plaintext would make a leaked backup equivalent to a leaked credential. Stated limit: it does not defend against an attacker holding both the database *and* the environment.
- `unseal()` returns null rather than throwing on a rotated `SESSION_SECRET`, tampering, or corruption, so a bad row degrades to "not configured" instead of taking down the cron.

### Fixed

#### The SMTP_HOST documentation was actively misleading
- That code path has **never spoken the SMTP protocol** — it POSTs to SendGrid's HTTP API at `${SMTP_HOST}/v3/mail/send`. The documented example `SMTP_HOST=smtp.yourprovider.com` could therefore never work (it isn't even a valid URL), and `SMTP_PORT` was documented but never read.
- `.env.local.example` now states this plainly and shows the correct value. The Settings UI is labelled by **provider** rather than "SMTP" for the same reason: a form asking for host/port/username/password would be a trap.

#### Duplicated provider selection
- The same env-var branching was copy-pasted across three send paths (`deliverEmail`, `deliverDigestEmail`, `deliverLeadershipDigestEmail`). Resolution now happens once in `resolveEmailProvider()`, and `process.env` is read in exactly one place.

### Changed
- **Resolution is database-first with an environment fallback**, so an instance already using `RESEND_API_KEY` keeps working after upgrading and only switches over when someone explicitly enables email in Settings. Covered by a regression test.
- Settings are **instance-wide** (like `alert_rules`, which has no per-user scoping either), so any authenticated user can change them. `updated_by` / `updated_at` record who last did, and the key cannot be read back.
- Provider resolution is cached for 30s — digests send in a loop and would otherwise query per recipient.
- Test count 212 → 240.

### Rollback
1. **Toggle email off in Settings** — resolution falls straight back to environment variables.
2. **Promote the v4.1.2 Vercel deployment** — instant.
3. **`git revert`** — migration 5 only *adds* a table; existing rows and behaviour are untouched, so no down-migration is required.

### Changed (infra)
- Bumped app version from 4.1.2 to 4.1.3
- Bumped Helm chart version from 0.5.2 to 0.5.3
- **First schema change since v4.0.x** — migration 5 creates `email_settings` (singleton row, `CHECK (id = 1)`)

---

## [4.1.2] — 2026-08-14

### Overview
Final AI feature of the v4.1.x series: ranked root-cause hypotheses for failing workflows. **F2 (AI Leadership Digest) was skipped** — the weekly digest email still cannot send (no `RESEND_API_KEY`/`SMTP_HOST` configured), and per the plan a version is never reserved for an unshipped feature. F2 can ship later once an email provider exists.

### Added

#### AI Failure Hypotheses
- When a workflow has **3+ recent failures**, the Workflow Detail **Reliability** tab offers *"Suggest why this is failing"* — up to three ranked causes, each with the specific evidence behind it, a confidence level, and a next step the team can run in minutes.
- Signals used: workflow-file change dates versus the first failure, step-level failure concentration, trigger/branch clustering, run-duration shifts, and the length of the success streak that ended.
- **Metadata only — never run logs.** GitDash does not fetch log content for any feature, and the prompt states explicitly that the model has no logs and must not write as though it does.
- New `GET /api/ai/root-cause`.

### Changed

#### Cost proportional to the problem, not the window
- The original design called for `getJobStats()`, which fans out across every completed run (~30–50 GitHub calls). Job detail is only needed for runs that **failed**, so the builder fetches jobs for at most 10 failed runs instead — roughly 10 calls, bounded by the number of failures rather than the window size.
- The GitHub fan-out is cached **separately** from the LLM call on this route (10 min each). Every other AI route fingerprints its cache on the snapshot, so a cache hit still pays the fan-out; here the fan-out is the expensive part and earns its own key.
- Rate-limited to **10/min per token** — half the other AI surfaces.
- The minimum-failure floor is enforced server-side (returns `content: null`), so a UI bug cannot turn into provider spend.

#### Schema validation, corrected against real output
- Confidence is validated against a literal allowlist (`high`/`medium`/`low`) rather than coerced — the UI colours a badge from it, and an invented `"very high"` would render an uncoloured chip.
- Rank is re-derived from array position: models routinely emit duplicate or out-of-order ranks, and display order is what matters.
- **Per-field length caps, sized from measured output.** An initial shared 300-character cap rejected otherwise-good answers, because the prompt asks for cited dates and counts and `evidence` measured 211–292 characters in practice. Caps are now per-field (hypothesis 400, evidence 500, next_step 300) and the prompt asks for brevity — which cut typical output from ~600 to ~220 tokens *and* improved readability.

### Verified
- End-to-end against the live provider through the real code path, three consecutive generations: **3/3 schema pass**, ~2–3s latency, ~640 in / ~220 out tokens per call.

### Rollback
1. **Unset the AI keys** — every surface hides, no redeploy.
2. **Promote the v4.1.1 Vercel deployment** — instant.
3. **`git revert`** — no migration to undo, zero schema changes.

### Changed (infra)
- Bumped app version from 4.1.1 to 4.1.2
- Bumped Helm chart version from 0.5.1 to 0.5.2
- Test count 177 → 212

---

## [4.1.1] — 2026-08-14

### Overview
Second AI release: explanations for the statistical outliers GitDash already flags, plus a third provider whose wire format forced the provider layer to stop assuming one protocol.

### Added

#### AI Anomaly Explanations
- Each flagged metric on the Workflow Detail **Reliability** tab gains a *"Why did duration spike?"* button. The explanation is built from surrounding metadata: baseline statistics, the dates the workflow file changed, and the trigger mix — then ends with one concrete check the team can run.
- **Lazy by design.** The SWR key stays null until the button is clicked, so opening the Reliability tab never costs a provider call. Cached 30 minutes.
- One explanation per *metric*, not per run — the model reads the pattern across outliers, so a per-run button would ask the same question repeatedly.
- New `GET /api/ai/anomaly-explanation`. Returns **404 when there are no outliers to explain**, rather than asking a model to speculate about an empty list.
- The `metric` parameter is validated against a literal allowlist (`duration` / `queue_wait`). It reaches a prompt, and an arbitrary string there is exactly the injection vector this layer is built to avoid.

#### Bailian (Alibaba Cloud) provider
- Added as a third provider and tried first. It serves the **Anthropic Messages API**, not the OpenAI shape — different path (`/messages`), auth header (`x-api-key`), system-prompt placement (top-level, not a message role), and response structure (`content[]` blocks, `input_tokens`/`output_tokens`).
- The provider table now carries an explicit `protocol` field and the request/response handling branches on it, rather than special-casing at each call site. Fallback works across protocols: a Bailian failure hands off to Gemini's OpenAI-shaped endpoint transparently.
- Default model `qwen3.6-flash`. Also available: `qwen3.6-plus`, `qwen3.7-plus`, `qwen3.7-max`, `qwen3.8-max`.

### Changed
- **Extended thinking is disabled on Bailian requests.** Qwen models there enable it by default, which costs roughly **10× the output tokens** for no benefit on structured extraction — measured at 799 vs 85 output tokens on an identical request. The response parser still selects the `text` block explicitly rather than `content[0]`, because a model may ignore the flag and emit a `thinking` block first.
- Test count 142 → 177.

### Rollback
1. **Unset `BAILIAN_API_KEY`** — the provider is skipped; any other configured provider takes over. Unset all AI keys and every surface hides.
2. **Promote the v4.1.0 Vercel deployment** — instant, no rebuild.
3. **`git revert`** — no migration to undo, zero schema changes.

### Changed (infra)
- Bumped app version from 4.1.0 to 4.1.1
- Bumped Helm chart version from 0.5.0 to 0.5.1

---

## [4.1.0] — 2026-08-14

### Overview
First release of the AI insight layer: an optional LLM analysis of the metrics GitDash already computes. **Entirely opt-in — with no AI provider key configured, every surface is hidden and the app behaves exactly as it did in v4.0.11.** Design and plan: `docs/specs/2026-08-14-ai-features-design.md`, `docs/plans/2026-08-14-ai-features-plan.md`.

### Added

#### AI provider layer (`src/lib/ai.ts`)
- Gemini primary, Qwen fallback, both through their OpenAI-compatible chat-completions endpoints — **zero new dependencies**, just `fetch`.
- `generateJson()` **never throws.** Every failure (no keys, disabled, timeout, HTTP error, unparseable body) returns a typed `AiFailure` with a machine-readable reason, so callers own their fallback UX instead of wrapping everything in try/catch.
- A single wall-clock deadline (`AI_TOTAL_BUDGET_MS`, default 45s) spans *all* provider attempts, so one slow primary can never push a request past its route's `maxDuration`. Per-attempt timeout is `AI_TIMEOUT_MS` (default 15s).
- Non-retryable statuses (400/401/403) skip straight to the next provider; 429/5xx retry once before falling through.
- Nothing logs prompt content or snapshot payloads — provider, model, latency, status and token counts only.

#### AI Insights panel
- New card on `/repos/[owner]/[repo]` and `/org/[orgName]/health`: a summary, findings grounded in the snapshot's numbers, and up to three suggested actions.
- New `GET /api/ai/insights` (repo and org surfaces) and `GET /api/ai/status` (capability probe — reports which providers are configured, never key material).
- New `aiInsights` feature flag in Settings. Double-gated: the server must have keys **and** the flag must be on. The client flag controls visibility only — routes check `aiEnabled()` server-side themselves, because the flag is localStorage-backed and trivially flipped.
- Failure is a non-event by design: an unavailable provider renders a muted one-liner, not an error box. The page's own metrics are unaffected.

#### Privacy enforcement
- Prompts are assembled server-side from typed snapshots (`src/lib/ai-snapshots.ts`) built field-by-field against an explicit interface — never by spreading a GitHub API object, so a field absent from the type cannot leak even if an upstream fetcher starts returning more.
- **Sent:** aggregate metrics, repository/workflow/job/step names, contributor logins, dates. **Never sent:** tokens, run logs, source code, workflow YAML, PR/commit message bodies, email addresses.
- `tests/ai-snapshots.test.ts` walks the serialized output of every builder and fails on a forbidden key. Fixtures deliberately carry commit messages, SHAs and URLs to prove the builder drops them.
- No free-form user input enters any prompt, so the injection surface is zero by construction.

#### Cost controls
- 15-minute response caching, fingerprinted on the snapshot so unchanged metrics reuse the previous generation.
- 20 requests/minute per token via a new `aiRateLimit()` helper that keys on the token hash rather than IP — AI cost follows the token, not the network.
- `AI_DAILY_TOKEN_BUDGET` (default 2,000,000 tokens/day) short-circuits before any provider call once spent.
- **These are in-process counters**, so on a multi-instance deployment they bound cost per instance rather than globally. Documented in-app and in-code as a damage-limiter, not a hard spend cap.

### Changed
- `tests/` gained its first route-handler tests (`api-ai-status`, `api-ai-insights`). Everything prior tested pure `src/lib` functions; the pattern is documented in `tests/api-ai-status.test.ts` for reuse.
- Test count 63 → 142.

### Rollback
Three independent levers, in increasing order of cost:
1. **Unset the AI env keys** — every surface hides immediately. No redeploy, no code change.
2. **Promote the v4.0.11 Vercel deployment** — instant, no rebuild.
3. **`git revert` this release's commit(s)** — **no migration to undo, zero schema changes.**

### Changed (infra)
- Bumped app version from 4.0.11 to 4.1.0
- Bumped Helm chart version from 0.4.11 to 0.5.0

---

## [4.0.11] — 2026-08-13

### Overview
Visual redesign of the Team Analytics page (`/repos/[owner]/[repo]/team`), implemented from a second design imported via Claude Design ("Scorecard board redesign" project, `Section Headers.dc.html`).

### Changed

#### Team Analytics collapsible sections
- Replaced the plain chevron-and-text toggle rows (PR Leaderboard, Reviewer Load Matrix, Review Bottleneck, Workload Risk Radar, Knowledge & Bus Factor Map, Runner Utilization) with a polished card-style section header: a tone-colored icon badge, title, a live data-driven count badge (contributor count, matrix dimensions, module count, runner count), a one-line description, and a "Show/Hide" pill button.
- Restyled the "PRs analysed" / "Bus factor" status pills at the top of the page to match.
- Leaderboard, Reviewer Matrix, and Bus Factor Map now default open (highest at-a-glance value); Bottleneck, Workload Risk, and Runners keep their existing collapsed defaults — data fetching is unconditional either way, so this only changes what's visible on first paint, not what's fetched.
- Kept every existing content component (`TeamLeaderboard`, `ReviewerLoadMatrix`, `ReviewBottleneck`, `WorkloadRiskRadar`, `BusFactorHeatmap`, `RunnerUtilization`) unchanged — this is purely the header/collapse chrome around them, same as the icon-language adaptation used for the Team Health Scorecard redesign in v4.0.8 (lucide icons instead of the design's abstract glyph).
- No API or data changes.

### Rollback
- **Instant, no rebuild:** promote the v4.0.10 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — one file, no data or API change.

### Changed (infra)
- Bumped app version from 4.0.10 to 4.0.11
- Bumped Helm chart version from 0.4.10 to 0.4.11

---

## [4.0.10] — 2026-08-13

### Overview
UX follow-up after a scare: a GitHub-side 403 (secondary rate-limiting from repeated testing, not a code issue) made the Team Health Scorecard's loading skeleton sit motionless long enough to look frozen. The skeleton itself gave no signal that anything was actually happening.

### Changed

#### Scorecard loading state
- Added a spinner + status line ("Collecting data across up to N repositories — a DORA + bus-factor check runs per repo, usually a few seconds…") above the skeleton tiles, so a slow or retrying fetch visibly reads as "working," not "stuck."
- No behavior change to the fetch itself — this is purely the loading-state UI.

### Rollback
- **Instant, no rebuild:** promote the v4.0.9 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — one component, no data or API change.

### Changed (infra)
- Bumped app version from 4.0.9 to 4.0.10
- Bumped Helm chart version from 0.4.9 to 0.4.10

---

## [4.0.9] — 2026-08-13

### Overview
Drive-by fix reported alongside v4.0.8 testing: the browser console logged `Error with Permissions-Policy header: Unrecognized feature: 'interest-cohort'` on every page load.

### Fixed

#### Stale Permissions-Policy directive
- **Root cause:** the security-headers config in `next.config.ts` disabled `interest-cohort` (Google's FLoC/Topics cohort-tracking feature) via the `Permissions-Policy` header. FLoC was discontinued and modern browsers no longer recognize `interest-cohort` as a valid Permissions-Policy feature, so every request logged a harmless-but-noisy console warning.
- Removed the directive. `camera`, `microphone`, and `geolocation` remain disabled — no functional change, this is not the cause of any loading issue.

### Rollback
- **Instant, no rebuild:** promote the v4.0.8 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — one header value in `next.config.ts`.

### Changed (infra)
- Bumped app version from 4.0.8 to 4.0.9
- Bumped Helm chart version from 0.4.8 to 0.4.9

---

## [4.0.8] — 2026-08-13

### Overview
Visual redesign of the Team Health Scorecard, requested directly after v4.0.7: the flat list of same-weight rows gave a leader no at-a-glance read of overall org health. Implemented from a design imported via Claude Design ("Scorecard board redesign" project), adapted to the app's existing Geist typography and DORA color tokens rather than introducing a separate font/palette for one page.

### Changed

#### Team Health Scorecard redesign
- Added an "Estate distribution" card in the header — total repo count, a segmented proportion bar, and a legend — plus four stat tiles below it: At Risk / Watch / Healthy counts (each with a "% of estate" note) and a Median Score tile.
- Repos are now a proper grouped table: a column header row (Repository / DORA / Bus factor / Critical / Trend / Composite), then "At Risk" / "Watch" / "Healthy" sections with a labeled group header (count chip + one-line description of what the band means), instead of one undifferentiated worst-first list.
- Added interactive filter pills (All / At Risk / Watch / Healthy, each showing its count) and sort pills (Lowest score / Most critical / A–Z) — client-side, no extra fetches.
- Bus factor is now a number plus a 3-pip strength indicator, colored by the same risk tone as the composite-score bar. Critical-module count is color-coded (muted at zero, amber under 5, red above).
- Each row is a single click target with a colored left accent bar; the composite score keeps a linear bar (glow-tinted by risk band) next to the number rather than switching to a radial gauge.
- No API or data changes — same `/api/github/org-health-scorecard` response, purely presentational.

### Rollback
- **Instant, no rebuild:** promote the v4.0.7 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — one file (`src/app/org/[orgName]/health/page.tsx`), no data or schema change.

### Changed (infra)
- Bumped app version from 4.0.7 to 4.0.8
- Bumped Helm chart version from 0.4.7 to 0.4.8

---

## [4.0.7] — 2026-08-13

### Overview
Fix for a UI discoverability gap reported after v4.0.0 shipped: the Team Health Scorecard (`/org/[orgName]/health`) had no visible entry point from the main dashboard — it could only be reached by manually typing the URL, or by first noticing an unlabeled icon-only "Org overview" button (`QuickActions`) that leads to the org page, which *then* has the labeled button.

### Fixed

#### No visible way to reach the Team Health Scorecard
- **Root cause:** the only labeled "Team Health Scorecard" link lives in the header of `/org/[orgName]` — but the main dashboard (`/`) never links there directly. The sole path was through `QuickActions`, a small unlabeled icon (title-only tooltip) mixed in with the Alerts and Docs icon buttons.
- The main dashboard header now shows a labeled "Team Health Scorecard" button (same style as the one on the org page) whenever an org is selected — one click from wherever a leader already is, no detour through the org overview page required.

### Rollback
- **Instant, no rebuild:** promote the v4.0.6 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — additive UI only, no data or API change.

### Changed (infra)
- Bumped app version from 4.0.6 to 4.0.7
- Bumped Helm chart version from 0.4.6 to 0.4.7

---

## [4.0.6] — 2026-08-13

### Overview
Docs-only fix: the four v4.0.0–v4.0.3 features (Team Health Scorecard, Workload Risk Radar, 1:1 Prep Sheet, Leadership Digest) shipped with release-notes entries and API Reference rows, but no dedicated page in the in-app Features docs and no sidebar entry — reported by a user who couldn't find where the 1:1 feature lived after enabling all feature flags.

### Fixed

#### New features were undiscoverable in the docs
- **Root cause:** each v4.0.x release added a `ReleaseNotes()` entry and `API Reference` rows, but never added a corresponding `feat-*` entry to `NAV`, the `Features()` index, or a dedicated feature-detail component. The only place these features were mentioned was changelog prose.
- Added four dedicated feature pages: `feat-health-scorecard`, `feat-workload-risk`, `feat-one-on-one`, `feat-leadership-digest` — each with a sidebar entry, an index card, and a full detail page.
- Fixed stale labels: Feature Overview listed "Team Insights (In Development)" and "Contributor Profile (Coming Soon)" even though both have been fully built since well before v4.0.0.
- Added a `VersionBadge` ("New in vX.Y") convention, applied to the four new pages and retrofitted onto the Contributor Profile and Alerts pages where they were extended (v4.0.2's `period_comparison` field, v4.0.3's `leadership_digest` rule type). Going forward, new doc content for a feature should carry this badge.

### Rollback
- **Instant, no rebuild:** promote the v4.0.5 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — docs-only, no code path, database, or env var changes.

### Changed (infra)
- Bumped app version from 4.0.5 to 4.0.6
- Bumped Helm chart version from 0.4.5 to 0.4.6

---

## [4.0.5] — 2026-08-13

### Overview
Fix for a contributor-profile crash reported right after v4.0.4: "Failed to fetch contributor profile" whenever the repo owner is a personal GitHub account rather than an organization.

### Fixed

#### Contributor profile broke for personal-account-owned repos
- **Root cause:** `/api/github/contributor-profile` always called `GET /orgs/{org}/repos` to list the owner's repos. That endpoint 404s whenever `owner` is a personal account, not an organization — which is the common case for most users (personal repos, not org repos). Any click into a contributor from a personal repo's Team Analytics page failed outright.
- Added a fallback: try the org-repos endpoint first (the common path when contributor profiles are reached from org-owned repos), and on 404 fall back to `GET /users/{username}/repos` for personal accounts. No behavior change for org-owned repos.

### Rollback
- **Instant, no rebuild:** promote the v4.0.4 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — no migration, no schema change.

### Changed (infra)
- Bumped app version from 4.0.4 to 4.0.5
- Bumped Helm chart version from 0.4.4 to 0.4.5

---

## [4.0.4] — 2026-08-13

### Overview
Fix for a real usability gap reported after v4.0.0-4.0.3 shipped: on some accounts, the org switcher shows only "Personal repos" with no way to reach organization-scoped features (Team Health Scorecard, Weekly Leadership Digest), even for users who genuinely belong to orgs.

### Fixed

#### Org switcher silently hid orgs with no way to work around it
- **Root cause:** the switcher only lists orgs GitHub's `orgs.listForAuthenticatedUser` API returns for the *current* token — which depends on when that token was authorized, not just current org membership. A session authorized before `read:org` was added to the OAuth scope list (or a fine-grained PAT, which cannot see org data at all) silently returns an empty list even for a user who belongs to orgs. There was no feedback and no fallback.
- The org switcher now includes a "Go to org by name" input, always available, that navigates directly to any org by name — this works independently of the discovery list, because the actual repo fetch (`/api/github/org-repos`) checks real GitHub access itself rather than relying on the membership-listing API.
- When the discovered org list is empty, the switcher now explains why (stale OAuth scope, fine-grained PAT limitation, or org visibility settings) instead of silently showing nothing.
- Fixed a related cosmetic bug: navigating to an org not in the discovered list (e.g. via the new manual input, or a bookmarked `?org=` URL) previously fell back to showing "Personal Repos" as the page title even though the repo list was correctly filtered to that org — the title now always reflects the actual org being viewed.
- Added a FAQ entry in the in-app docs explaining the scope/discovery gap and the workaround.

Team Health Scorecard (`/org/[orgName]/health`) and the org-repos view already worked correctly by URL for any org name — this fix is entirely about *reaching* them when the switcher's auto-discovery falls short. No API or data-layer changes.

### Changed (infra)
- Bumped app version from 4.0.3 to 4.0.4
- Bumped Helm chart version from 0.4.3 to 0.4.4

---

## [4.0.3] — 2026-08-13

### Overview
Fourth and final leadership-focused release. The **Weekly Leadership Digest** — a plain-English narrative summary emailed to leadership every Monday: what's healthy, what's trending, and what needs attention across an org, without anyone having to log in and look.

### Added

#### Weekly Leadership Digest
- New alert metric `leadership_digest` and a dedicated form in the Alerts page: pick an org and an email address, and every Monday (UTC) you get a narrative summary — reuses the exact org-health-scorecard computation from v4.0.0 (`src/lib/org-health-scorecard.ts`, now extracted into a shared lib) and turns the ranked result into sentences instead of a UI list.
- **No new database table.** `leadership_digest` rules are stored in the existing `alert_rules` table (same schema, same UI, same CRUD) — the cron explicitly excludes them from the normal per-repo alert evaluation path (they'd otherwise fire once per repo per day instead of once per week) and evaluates them directly on its own weekly cadence.
- **No "last sent" state to track.** The cron runs daily; a simple day-of-week check (`getUTCDay() === 1`, Monday) is enough to fire the digest once a week — no extra column, no extra table.
- Narrative generation (`src/lib/leadership-narrative.ts`) is rule-based and testable, same style as the app's alert thresholds and the 1:1 Prep Sheet's talking points: highlights (healthy repos, upward trends), concerns (at-risk repos, critical bus-factor modules, downward trends), never more than what fits in a scannable email.
- 5 new unit tests for the narrative generator (`tests/leadership-narrative.test.ts`).

### Changed
- `src/lib/org-health-scorecard.ts` (new): the composite-score computation was extracted out of `/api/github/org-health-scorecard`'s route handler so the digest could call it directly. The route itself is unchanged in behavior — same thin cached wrapper pattern as v4.0.0's bus-factor extraction.

### Rollback
- **Instant, no redeploy:** delete or disable the `leadership_digest` rule(s) in the Alerts page — no more emails go out, nothing else in the app is affected.
- **Instant, no rebuild:** promote the v4.0.2 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — no migration to undo (the feature reused the existing `alert_rules` schema).

### Changed (infra)
- Bumped app version from 4.0.2 to 4.0.3
- Bumped Helm chart version from 0.4.2 to 0.4.3

---

## [4.0.2] — 2026-08-13

### Overview
Third of four leadership-focused releases. The **1:1 Prep Sheet** — a one-click, formatted brief for manager 1:1s: period-over-period diffs and auto-generated talking points, framed as conversation prompts rather than verdicts.

### Added

#### 1:1 Prep Sheet
- New `/contributor/[login]/brief` page — period-over-period PR/review/cycle-time comparison plus a short list of talking points, generated by a small threshold-based rules engine (`src/lib/one-on-one.ts`, same style as the app's existing alert-rule thresholds). Print-friendly (`window.print()` button, print CSS).
- Linked from the existing contributor profile page.
- **Zero new GitHub API calls.** `ContributorProfileResponse` gained a `period_comparison` field, computed by splitting PR/review data the route already fetches into two 45-day halves — no extra fan-out. The brief page reuses the exact same SWR cache key as the full profile page, so opening it after viewing the profile costs nothing extra, and opening it cold costs the same single fetch the profile page would need anyway.
- Talking points are deliberately phrased as observations + questions, never conclusions — e.g. "PRs merged dropped 40% vs. the prior period... worth asking about blockers" rather than "underperforming." Small-sample noise is filtered (comparisons require a baseline of at least 2 in the prior period).
- 6 new unit tests for the talking-point rules (`tests/one-on-one.test.ts`).

### Rollback
- **Instant, no redeploy:** the brief page and its link are additive UI — hiding them isn't flag-gated in this version (the underlying `period_comparison` field is inert extra data on an existing response, harmless to leave in place). If needed, remove the "1:1 Prep Sheet" link from the profile page and the route becomes unreachable via the UI.
- **Instant, no rebuild:** promote the v4.0.1 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — no migration to undo.

### Changed (infra)
- Bumped app version from 4.0.1 to 4.0.2
- Bumped Helm chart version from 0.4.1 to 0.4.2

---

## [4.0.1] — 2026-08-13

### Overview
Second of four leadership-focused releases. The **Burnout & Workload Risk Radar** — a team-wide people-risk view, distinct from v3.2.0's Review Bottleneck (which covers reviewer overload specifically). This one surfaces three signals nothing else in the app shows: sustained after-hours/weekend work, "went quiet" activity cliffs, and concurrent-PR overload.

### Added

#### Workload Risk Radar
- New `GET /api/github/team-workload-risk?owner=X&repo=Y` — one repo-wide commit fetch (not per-contributor) grouped locally by author, plus one open-PR fetch, producing per-person flags: after-hours pattern (≥30% of commits outside 9–18 UTC), weekend work (≥25% of commits on Sat/Sun), concurrent-PR overload (≥4 open PRs at once), and activity cliff (≥3 commits in the prior 4 weeks, zero in the most recent 2).
- New Team Analytics section, gated behind a new `workloadRisk` feature flag.
- Framed deliberately as a conversation-starter, not a verdict — the UI and docs both say so explicitly. Heuristic thresholds on a small sample can be wrong (timezone differences, a contractor's concentrated PR pattern, etc.); this is a "worth a check-in" signal for a manager, not a performance judgment.
- No new database table — computed live from the GitHub API on each request (15-min cache), same rollback-safety approach as v4.0.0.

### Rollback
- **Instant, no redeploy:** toggle "Workload Risk Radar" off in Settings → Feature Flags.
- **Instant, no rebuild:** promote the v4.0.0 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — no migration to undo.

### Changed (infra)
- Bumped app version from 4.0.0 to 4.0.1
- Bumped Helm chart version from 0.4.0 to 0.4.1

---

## [4.0.0] — 2026-08-13

### Overview
First of four leadership-focused releases (v4.0.0 → v4.0.3), each shipping as its own isolated, independently-rollback-able version — see "Rollback" below. This one: the **Team Health Scorecard**, an org-wide ranked view that answers "which of my teams needs attention" without opening repos one at a time.

### Added

#### Team Health Scorecard
- New `GET /api/github/org-health-scorecard?org=X&limit=N` — for every repo in an org, computes a composite health score (60% DORA tier + 40% bus-factor risk, 0–100) and a throughput trend (recent vs. prior half of the DORA window), sorted worst-first.
- New `/org/[orgName]/health` page — ranked list with risk bands (Healthy / Watch / At Risk), DORA tier, bus-factor and critical-module counts, and trend arrows. Linked from the existing Org Overview page.
- Deliberately **no new database table** — the trend signal is derived from data the DORA calculation already fetches (recent vs. prior weeks of merged-PR throughput), so this works identically whether or not `DATABASE_URL` is configured, and there's no schema change to roll back if the feature is reverted.
- Gated behind a new `healthScorecard` feature flag (Settings → Feature Flags), following the same pattern as every other optional analytics section.

### Changed
- `src/lib/bus-factor.ts` (new): the bus-factor calculation was extracted out of `src/app/api/github/bus-factor/route.ts` into a reusable function, so the scorecard can compute it per-repo via a direct function call instead of an internal HTTP round trip. The route itself is now a thin cached wrapper — its response shape and behavior are unchanged.

### Rollback
This release is intentionally isolated to make reverting it low-risk:
- **Instant, no redeploy:** toggle "Team Health Scorecard" off in Settings → Feature Flags. Hides the new page and stops the client from calling the new endpoint.
- **Instant, no rebuild:** promote the prior Vercel deployment (`vercel rollback`, or "Promote to Production" on the v3.2.0 deployment in the Vercel dashboard).
- **Full revert:** `git revert` this release's commit(s) — no database migration was added, so there is nothing to roll back at the schema level.

### Changed (infra)
- Bumped app version from 3.2.0 to 4.0.0
- Bumped Helm chart version to 0.4.0 / appVersion to 4.0.0

---

## [3.2.0] — 2026-08-13

### Overview
Custom domain cutover to gitdash.info, seven new features (scheduled sync, rate-limit visibility, runner utilization, partial-data honesty, anomaly-driven alerts with digest delivery, review bottleneck detection), and a second performance pass on top of 3.1.3's API-efficiency work — this one focused on client bundle size and render cost.

---

### Added

#### Custom domain
- Production now serves from `https://gitdash.info` (previously the `*.vercel.app` domain). `NEXT_PUBLIC_APP_URL` and the GitHub OAuth app's callback URL were updated to match.

#### Scheduled background sync
- New `GET /api/cron/sync`, triggered daily by Vercel Cron (`vercel.json`), re-syncs every repo that has ever been synced (tracked via `sync_cursors`) so Reports and Alerts stay current without manually clicking "Sync from GitHub".
- Protected by `CRON_SECRET` (Vercel's standard `Authorization: Bearer` cron auth pattern); runs under a service-level `GITHUB_TOKEN` since a cron run has no user session.
- Shared sync logic extracted into `src/lib/sync.ts`, used by both the cron route and the existing manual `POST /api/db/sync`.

#### Rate-limit budget widget
- Sidebar now shows live GitHub API quota (`GET /rate_limit`, which GitHub excludes from rate-limit accounting — checking it is free), with a warning state below 20% remaining.

#### Runner utilization
- New `GET /api/github/runner-stats` aggregates job counts, durations, and failure rates per runner from data the app already fetched but never surfaced (`job.runner_name` / `runner_group_name`). Shown in a new Team Analytics section, gated behind a feature flag.

#### Partial-data indicators
- Fan-out routes that fetch many PRs/commits per request now report `partial`, `fetched_*`, and `total_*` fields when some sub-requests were rate-limited or failed, and the UI shows an amber banner instead of silently returning an undercounted number. Applied to `bus-factor`, `open-pr-health`, `repo-contributors`, `contributor-profile`, and `repo-dora`.
- These routes' batch-of-N `Promise.allSettled` loops were also converted to the bounded worker-pool `pLimitSettled` (no more waiting for the slowest member of each batch before starting the next).

#### Anomaly-driven alerts + daily digest
- New alert metric `anomaly_count`: fires when more than a threshold number of runs deviate >2 standard deviations from the rolling baseline in the window — reuses the same statistical detector the workflow detail page already uses client-side (`src/lib/anomaly.ts`, now shared between client and server).
- New alert channel `digest`: instead of a real-time notification per event, matching alerts are bundled into one daily summary email, sent by the cron route after each sync pass (Vercel Hobby limits cron jobs to once/day, so digest delivery piggybacks on the sync cron rather than needing its own).

#### Review bottleneck detection
- New Team Analytics section flags reviewers carrying a disproportionate share of the review load ("Overloaded") and authors whose PRs are reviewed almost exclusively by one person ("Sole-Reviewer Risk") — built entirely from data `repo-contributors` already fetches, no additional GitHub API calls.

### Changed

#### Client bundle & render performance (Phase 2)
- Consolidated all 7 Recharts importers behind a single `src/components/charts/index.tsx` re-export — Turbopack previously emitted two duplicated ~388 KB chunks for the same library; the repo page's DORA drill-down and PR lifecycle sections (both collapsed by default) now load via `next/dynamic` instead of shipping in the initial bundle.
- `RepoRow` (home page repository table) is now `React.memo`'d — search-box keystrokes no longer re-render all visible rows.
- Fixed `RecentFailuresWidget`: its cache-read `useMemo` depended on the SWR cache object, whose identity never changes as entries are added — the widget could never show newly-loaded failures. Now driven by a tick counter bumped when each row's summary fetch settles.

### Known limitations
- The Vercel Cron-based scheduled sync only runs on the Vercel deployment. The Helm/Kubernetes deployment path does not yet have an equivalent CronJob — self-hosted users on k8s still sync manually or via the GitHub webhook.
- Digest delivery requires `RESEND_API_KEY` or `SMTP_HOST` to be configured (same as the existing `email` alert channel).

### Changed (infra)
- Bumped app version from 3.1.3 to 3.2.0
- Bumped Helm chart version to 0.3.0 / appVersion to 3.2.0

---

## [3.1.3] — 2026-03-13

### Overview
Reverse-proxy / Zscaler robustness: allow public paths (health probes, static assets) to bypass the HTTPS redirect, and enable outbound TLS through Zscaler inspection during development.

---

### Added

#### Run behind Zscaler
- Set `experimental.turbopackUseSystemTlsCerts: true` in `next.config.ts` so outbound requests (e.g. Google Fonts during dev) trust the system certificate store when Zscaler TLS inspection is active.

### Fixed

#### `ALWAYS_PUBLIC` check now runs before the HTTPS redirect
- Reordered `src/middleware.ts` so the `ALWAYS_PUBLIC` allowlist (`/_next`, `/favicon`, `/docs`, `/api/webhooks`, `/api/health`) is evaluated **before** the production HTTP→HTTPS redirect.
- Previously, kubelet probes and static assets — which carry no `x-forwarded-proto` header — could be redirected, breaking health checks and asset loading behind a reverse proxy.

### Changed
- Bumped app version from 3.1.2 to 3.1.3
- Bumped Helm chart version to 0.2.1 / appVersion to 3.1.3

---

## [3.1.2] — 2026-03-09

### Overview
Fix readiness/liveness probe failures caused by middleware redirecting unauthenticated kubelet health checks after the #3 middleware activation fix.

---

### Fixed

#### Readiness/liveness probes fail behind middleware (#4)
- Kubelet probe requests to `/api/auth/me` were redirected by the now-active middleware (no session cookie → 302 to `/setup` or `/login`)
- Created dedicated `/api/health` endpoint returning `{"status":"ok"}` with no auth required
- Added `/api/health` to middleware's `ALWAYS_PUBLIC` list so it bypasses auth checks
- Updated Helm chart probe paths from `/api/auth/me` to `/api/health`
- Reduced `initialDelaySeconds` (readiness: 10→5, liveness: 30→10) since the health endpoint is trivial

### Changed
- Bumped app version from 3.1.1 to 3.1.2
- Bumped Helm chart version to 0.2.0 / appVersion to 3.1.2

---

## [3.1.1] — 2026-03-09

### Overview
Critical fix for reverse-proxy deployments: redirects now use the public-facing origin instead of the container's internal address. Middleware was also not running due to wrong filename/export.

---

### Fixed

#### Redirects go to container address behind reverse proxy (#3)
- All `NextResponse.redirect(new URL("/path", req.url))` calls resolved to `https://0.0.0.0:3000` behind NGINX ingress because `req.url` uses the container's `HOSTNAME`
- New `src/lib/url.ts` exports `publicUrl()` which reconstructs the external origin from `x-forwarded-proto` + `x-forwarded-host` headers (set by NGINX/ALB), with fallback to `NEXT_PUBLIC_APP_URL`, then `req.url`
- All redirect calls in middleware and auth route handlers now use `publicUrl()`

#### Middleware was never active
- `src/proxy.ts` exported `proxy()` — Next.js requires `src/middleware.ts` exporting `middleware()`
- Renamed file and export so the auth middleware actually runs

#### Helm chart uses wrong ingress class
- Replaced ALB ingress annotations with NGINX ingress annotations
- Set `className: "internal-ingress-nginx"` (matches cluster's installed controller)
- Removed `certificateArn` value and ALB-specific template logic from `ingress.yaml`

### Changed
- Bumped version from 3.1.0 to 3.1.1

---

## [3.1.0] — 2026-03-08

### Overview
UI/UX overhaul: responsive mobile navigation, redesigned settings page, global footer, skeleton loading states, demo mode, test infrastructure, and a completely rewritten README with intro video and walkthrough demo.

---

### Added

#### Mobile-Responsive Navigation
- **Mobile hamburger menu** with slide-out drawer, backdrop blur overlay, and close button
- **Sticky mobile top bar** with GitDash branding
- Desktop sidebar now uses sticky positioning with proper full-height background — no more gap between nav and page content
- Sidebar user account section pinned to bottom of viewport

#### Global Footer
- Consistent footer on all pages (except `/docs` which has its own) showing version, "Open source on GitHub" and "Report an issue" links
- Version pulled dynamically from `NEXT_PUBLIC_APP_VERSION`

#### Settings Page — Complete Redesign
- Replaced narrow single-column layout with full-width responsive design
- **Account section**: horizontal card with avatar, name, mode badge, active status, and inline PAT management
- **Feature Flags**: responsive card grid (1/2/4 columns) replacing flat toggle list — cards are fully clickable with violet highlight when enabled
- **Enable all / Disable all** bulk toggle buttons
- Larger, more accessible "Change PAT" and "Clear & reset" buttons matching design system

#### Demo Mode
- New `/demo` page and `/api/demo` route for showcasing GitDash without a real GitHub token
- Demo data generator in `src/lib/demo.ts`

#### Skeleton Loading States
- Loading skeletons for all major pages: homepage, repo detail, workflow detail, cost analytics, docs
- `PageSkeleton` reusable component for consistent loading UX

#### New Components
- `MissionControl` — real-time system status overview
- `OnboardingChecklist` — guided first-run experience
- `MetricProvenance` — data source attribution for metrics
- `PageHeader` — standardized page header component
- Shell components: `PrimaryRail`, `WorkspacePanel`, `MobileNavDrawer`, `nav-config`

#### Test Infrastructure
- Vitest configured with `vitest.config.ts`
- Test scripts added: `npm run test`, `npm run test:watch`, `npm run test:coverage`
- Initial test suite: anomaly detection tests in `tests/anomaly.test.ts`
- Added `vitest` and `@vitest/coverage-v8` as dev dependencies

#### Infrastructure Libraries
- `src/lib/cache.ts` — client-side caching utilities
- `src/lib/concurrency.ts` — request concurrency control
- `src/lib/notifier.ts` — notification system

#### Walkthrough Videos & README
- Added intro video (`walkthrough-output/GitDash__GitHub_Actions.mp4`) and full demo walkthrough (`walkthrough-output/gitdash-walkthrough.webm`)
- README completely rewritten: video embeds, collapsible screenshot sections, cleaner structure with emoji section headers

---

### Improved

#### Layout & Sidebar
- Sidebar background now extends full page height (fixed `h-screen` gap issue)
- `flex-1` spacer ensures user account is always pinned to sidebar bottom
- AppShell uses `items-stretch` with separate outer wrapper for background vs sticky scroll behavior
- Docs page removed from full-page route exclusion (now renders within AppShell)

#### Cost Analytics
- Updated page layout and styling improvements

#### Repository Page
- Refined homepage repository list styling and layout

#### Database Layer
- Improved `src/lib/db.ts` with better error handling and query patterns

#### Org Overview API
- Enhanced `/api/github/org-overview` route with improved data aggregation

#### Alerts API
- Refined `/api/alerts/route.ts` with improved validation

---

### Changed
- Bumped version from 3.0.0 to 3.1.0
- `StatCard` component updated with refined styling
- Global CSS (`globals.css`) expanded with new utility styles and animations

---

## [3.0.0] — 2026-03-07

### Overview
Major release: Feature Flags system, DORA metrics on repository overview, PR lifecycle health, historical DB-backed reporting, alert rules engine, and comprehensive built-in documentation.

---

## [2.2.0] — 2026-03-01

### Overview
Automated Vercel deployment via GitHub Actions CI/CD, setup and login page improvements including PAT security transparency and author attribution.

---

### Added

#### Vercel Deployment Workflow
- New `.github/workflows/vercel.yml` — deploys to Vercel production automatically on every push to `main`, and can be triggered manually via `workflow_dispatch`
- Uses `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` GitHub secrets (no CLI login required)
- Build step runs `vercel build --prod` in CI before deploying the prebuilt output — consistent reproducible deploys

#### Setup Page — PAT Security Section
- New "How this application handles your PAT?" section below the token scopes list
- Plain-English explanation: encrypted session cookie, never stored or forwarded to third parties
- Links to the README PAT security policy anchor

#### Author & License Attribution
- Footer of setup page now shows: `MIT License · Made by Dinh Do Ba Thi`
- Footer of login page updated to match for consistency

---

## [2.1.0] — 2026-03-01

### Overview
Post-release polish: personal account billing support in Cost Analytics, fully-structured loading skeletons on every page, and a shimmer sweep animation replacing the invisible pulse effect.

---

### Added

#### Cost Analytics — Personal Account Billing
- **Personal Account** option added as the first entry in the Cost Analytics account dropdown
- Defaults to Personal Account on load — no org selection needed to see your own metered usage
- Calls `GET /users/{login}/settings/billing/usage/summary` (Enhanced Billing API) when Personal Account is selected
- Org entries remain available below a divider for switching to org billing
- Context banner now shows "Personal Account" label with a User icon (vs Building2 for orgs)

#### Shimmer Loading Animation
- New `@keyframes shimmer` + `.skeleton` CSS utility class in `globals.css`
- A bright highlight sweeps left→right across each placeholder shape (slate-800 → slate-700 → slate-800) at 1.6 s, matching the loading style used by GitHub, Linear, and similar apps
- Single utility: `class="skeleton rounded-*"` — border-radius controlled independently per shape

---

### Improved

#### Loading Skeletons — Audit Trail page
- Replaced 8 identical `h-16` blobs with a fully-structured skeleton:
  - 4 stat cards (icon + label + large value + sub-label)
  - Timeline card with header lines + 8 commit rows each showing avatar circle, varying-width message line, author · time · file-badge meta row, and SHA chip

#### Loading Skeletons — Security page
- Replaced 5 uniform `h-24` + 3 `h-16` blobs with a fully-structured skeleton:
  - Score ring card (large circle + 3 text lines) + 4 severity count cards in the summary strip
  - Section heading + 4 workflow file result rows with mini ring, file path, badge pills, check-mark row, and chevron

#### Loading Skeletons — All pages
- Fixed invisible pulse: all skeleton shapes were using `bg-slate-800` on a `bg-slate-900` background — near-zero contrast, making `animate-pulse` imperceptible
- Bumped all skeleton fill colours to `bg-slate-700` (and subsequently replaced with `.skeleton` shimmer)
- Migrated all pages from `animate-pulse bg-slate-700` to `.skeleton` class: homepage, repo detail, workflow detail, cost-analytics, org overview, team, audit trail, security, settings

---

### Fixed

#### Cost Analytics — 404 error clarity
- GitHub returns `404` (not `403`) when a PAT lacks org billing permission — the resource is hidden entirely
- Error block now clearly states "Your API key does not have enough permission" with the org name
- Explains the 404 behaviour, lists 4 actionable fix steps, and provides CTA buttons to create a fine-grained PAT and view org billing directly

---

## [2.0.0] — 2026-03-01

### Overview
Major release adding executive-level analytics, team productivity metrics, security scanning, resource optimization insights, audit trail, and a suite of UX quick-wins. All features are stateless — no database required.

---

### Added

#### Cost Analytics Dashboard (1.1)
- New `/cost-analytics` page with cost attribution per runner type (Ubuntu / macOS / Windows)
- Monthly burn rate and end-of-month cost projections
- Org selector to switch between personal and organization billing contexts
- Migrated from deprecated GitHub billing REST API to the new **Enhanced Billing API** (`GET /organizations/{org}/settings/billing/usage/summary`)
- Clear 403 error UI explaining fine-grained PAT requirement with actionable setup links
- New API route: `GET /api/github/billing/cost-analysis`

#### Org-Wide Repository Comparison (1.2)
- New `/org/[orgName]` dashboard with 4 stat cards: total repos, active repos, total runs, avg success rate
- Reliability heatmap — color-coded grid of all org repos (green ≥95 %, yellow 90–95 %, red <90 %)
- Top repositories table with Status / Health / Run History / Trend / Workflows columns
- New API route: `GET /api/github/org-overview`

#### DORA Four Keys Metrics (2.1)
- New **DORA** tab on the workflow detail page
- Calculates all four DORA keys from existing runs data (no new API calls):
  - **Deployment Frequency** — deploys per day / week
  - **Lead Time for Changes** — commit age → workflow completion (median + p95)
  - **Change Failure Rate** — % of deploy runs that concluded as `failure`
  - **Mean Time to Recovery (MTTR)** — time between first failed deploy and next successful one
- Elite / High / Medium / Low performance badges with industry benchmark reference table
- New library: `src/lib/dora.ts`

#### Team Velocity & Contributor Analytics (2.2)
- New `/repos/[owner]/[repo]/team` page
- Contributor leaderboard: runs, success rate, avg duration, busiest hour per actor
- Activity bar chart (runs per contributor, last 30 days)
- New API route: `GET /api/github/team-stats`
- **Team** nav button added to repo detail page header

#### Queue Wait Analysis (3.1)
- Queue Wait section added to the **Performance** tab on the workflow detail page
- Metrics: avg / p50 / p95 / max queue wait, percentage of runs delayed >2 min
- Queue wait heatmap by hour of day and day of week
- Estimated developer time wasted per week
- New library: `src/lib/queue-analysis.ts`

#### Workflow Optimization Recommendations (3.2)
- Dismissible **Optimization Tips** card on the workflow Overview tab
- Rule-based engine with 6 rules: macOS runner cost, no-cache detected, sequential jobs, long steps, missing timeout, `pull_request_target` security risk
- New library: `src/lib/optimization.ts`

#### Anomaly Detection (4.2)
- Statistical outlier detection using rolling 7-day baseline (mean ± 2 × stddev)
- **Anomaly** badge on affected run rows in the Runs tab
- Detects duration spikes, unusual queue wait, and conclusion-pattern shifts
- New library: `src/lib/anomaly.ts`

#### Audit Trail (6.1)
- New `/repos/[owner]/[repo]/audit` page
- Deployment approval tracking: triggered-by vs triggering-actor, conclusion, commit SHA + message
- Workflow file change history: lists commits to `.github/workflows/` with author, date, and message
- **Audit Trail** nav button (Shield icon) added to repo detail page header
- New API route: `GET /api/github/audit-log`

#### Security Metrics (6.2)
- New `/repos/[owner]/[repo]/security` page with 10 static-analysis rules (SEC-001 – SEC-010):
  - `pull_request_target` usage, unpinned action versions (`@main`/`@master`), missing `permissions:`, secrets in env, `continue-on-error: true`, missing `timeout-minutes`, hardcoded credentials pattern, `workflow_dispatch` input injection, self-hosted runner on public repo, deprecated Node.js runner versions
- Severity badges (critical / high / medium / low / info) with per-rule doc links
- Workflow-level findings with expandable detail and line references
- **Security** nav button (ShieldCheck icon) added to repo detail page header
- New API route: `GET /api/github/security-scan`

#### CSV Export Enhancement (Quick Win)
- Added `Run_Attempt` and `Est_Cost_USD` columns to the workflow runs CSV export
- Cost estimated client-side via `estimateRunCost()` from `src/lib/cost.ts`

#### Health Score Ring (Quick Win)
- `HealthScoreRing` SVG radial ring component in `src/components/WorkflowMetrics.tsx`
- Composite score (0–100): 60 % success rate + 30 % stability + 10 % activity bonus
- Color thresholds: green ≥80, yellow ≥60, orange ≥40, red <40
- Replaces flat `HealthBadge` in workflow rows on the repo detail page (homepage retains `HealthBadge`)

#### Recent Failures Widget (Quick Win)
- Banner on the homepage listing repos with `failure` or `cancelled` conclusions in the last 24 h
- Reads from the SWR in-memory cache — zero additional API calls
- Capped at 5 entries; each links directly to the repo detail page with relative time
- Dismissible with ✕ button

#### Keyboard Shortcuts Modal (Quick Win)
- Press `?` anywhere on the homepage to open the shortcuts reference modal
- Keyboard icon button added next to **Refresh** in the header
- Shortcuts: `/` focus search, `Escape` clear/close, `↑ ↓` navigate list, `Enter` open repo, `?` toggle modal
- Dismisses on `Escape`, backdrop click, or ✕ button

---

### Changed

- **Sidebar version badge** — upgraded from a small muted `v0.1.0` label to a prominent violet pill linking to the GitHub Releases page
- **Cost Analytics error handling** — 403 now shows an actionable amber block (not a generic 500) explaining fine-grained PAT requirement
- **Setup page** — added fine-grained PAT note for Cost Analytics (replaces old `admin:org` scope instruction)
- **Login page** — updated Cost Analytics scope note

---

### Fixed

- `ExternalLink` lucide icon was missing from the security page import — caused a TypeScript compile error
- Removed unused `detectRunnerOS` import from the workflow detail page (was imported alongside `estimateRunCost` but never referenced)
- `Date.now()` inside `useMemo` / `useRef` initial values — moved to module-level constants to satisfy the `react-hooks/purity` lint rule
- Audit Trail page: added **Back to repo** button (ArrowLeft icon) for easier navigation

---

### Security

- All new API routes follow the established pattern: session token retrieval → input validation via `src/lib/validation.ts` → `safeError()` for error responses → `Cache-Control: private` headers
- Security scan page: no `dangerouslySetInnerHTML`; all external links use `rel="noopener noreferrer"`
- No secrets, tokens, or PII are stored or logged anywhere in the new code

---

### Skipped (require infrastructure not yet available)

- **5.1 Historical Data Storage** — requires a database (PostgreSQL / SQLite)
- **4.1 Smart Alerts** — requires a database + external services (SendGrid, Slack webhook)

---

## [0.1.0] — Initial Release

- Workflow-level metrics (job / step performance, trigger patterns)
- Reliability tracking (MTTR, failure streaks, flaky detection)
- PAT + OAuth authentication with iron-session
- Fuzzy repo search, auto-refresh, keyboard navigation
