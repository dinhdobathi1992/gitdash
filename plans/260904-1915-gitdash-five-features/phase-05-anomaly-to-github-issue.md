---
phase: 5
title: "Anomaly To GitHub Issue"
status: pending
priority: P3
effort: "1.5d"
dependencies: [4]
---

<!-- Updated: Validation Session 1 - button moved to workflow-detail page, safeError replaced with status passthrough, rate limit added, per decision 7 / red-team Findings 7, 12, 13 -->

# Phase 5: Anomaly → GitHub Issue

## Overview

The workflow-detail page already detects anomalies and (optionally, when AI
is configured) explains them via `AnomalyExplanation.tsx`. Nothing writes
back — this phase adds a one-click "File as GitHub issue" action, closing
detect → (optionally explain) → act. No existing code path in the repo calls
`octokit.rest.issues.create` today — this is genuinely new write capability,
gated behind the `githubIssueFromAnomaly` flag added in Phase 4.

**Redesigned during validation:** the original draft targeted
`AnomalyExplanation.tsx` and required the button to work with AI off. That
component returns `null` whenever AI is unavailable/disabled
(`src/components/AnomalyExplanation.tsx:49`) and holds no raw anomaly-stats
props — the AI-off requirement was unimplementable in that component. The
button now lives on the **parent workflow-detail page**
(`src/app/repos/[owner]/[repo]/workflows/[workflow_id]/page.tsx`), which
already computes the outlier/anomaly stats regardless of AI state, so the
feature works identically whether or not `aiInsights` is on. This also
fixed two other red-team findings: `safeError` was hiding real GitHub error
statuses from the user, and the route had no rate limit despite being the
only write-capable route in the app.

## Requirements

- Functional: from the workflow-detail page's anomaly card (rendered
  whenever the client-side anomaly detection, `src/lib/anomaly.ts`, flags an
  outlier — independent of AI state), a button creates a GitHub issue in the
  current repo with a title and body derived from the anomaly metric and
  stats, enriched with the AI explanation when `AnomalyExplanation` is also
  rendering one for the same anomaly (best-effort merge, not a hard
  dependency).
- Functional: works identically with `aiInsights` on or off — verified by
  the manual test plan below covering both states explicitly.
- Functional: uses the **logged-in user's own session token**
  (`getTokenFromSession()`) — not a service token — so GitHub's own
  permission model applies naturally to the write.
- Functional: button and API route are inert (hidden client-side) unless
  `flags.githubIssueFromAnomaly` is `true` (Phase 4). Flags remain
  client-only in this codebase (confirmed: no existing route imports
  `feature-flags` — this is precedent, not a new gap); the real
  authorization boundary is GitHub's own permission check plus this
  phase's rate limit (see below), not the flag.
- Non-functional: **explicit user confirmation required** before the write
  — a two-step "Preview issue → Create" flow (editable title/body), not a
  single click straight to GitHub.
- Non-functional: **rate limited.** Reuses the existing `rateLimit` helper
  (`src/lib/ratelimit.ts`, already applied to every AI route and auth
  route) keyed on session identity — e.g. 5 issue-creations per hour. This
  is the app's only external-write route and the codebase's own convention
  is to rate-limit expensive/abusable routes; skipping it here would be the
  one exception.
- Non-functional: **real GitHub errors are surfaced, not swallowed.** The
  route maps Octokit's `status` explicitly for 401/403/404/410/422 to a
  curated public message per status (e.g. 403 → "You don't have permission
  to create issues in this repository"); `safeError`'s generic 500 handling
  is used only for genuinely unexpected errors, not for the octokit calls
  in this route's primary path.
- Non-functional: the created issue is the audit trail (see plan
  Non-Goals — no new DB table). The API response includes the created
  issue's URL, shown to the user immediately.

## Architecture

New route `POST /api/github/create-issue`:
- Body: `{ owner, repo, title, body }`, fully client-composed (the client
  already has the anomaly stats and, when available, the AI explanation —
  no server-side re-assembly needed for this write-only route).
- Auth: `getTokenFromSession()`, 401 if absent.
- Rate limit: `rateLimit(getRateLimitKey(...), { limit: 5, windowMs: 3600_000
  })` (or the closest existing helper signature — match
  `src/lib/ratelimit.ts`'s actual API) before any GitHub call; 429 on
  exceeded.
- Validation: `validateOwner`/`validateRepo` (existing); new title (≤256
  chars) / body (≤10000 chars) length caps.
- Calls `octokit.rest.issues.create({ owner, repo, title, body })`.
- **Error mapping (replaces bare `safeError`):**
  ```
  try {
    const result = await octokit.rest.issues.create({ owner, repo, title, body });
    return NextResponse.json({ ok: true, issue_url: result.data.html_url, issue_number: result.data.number });
  } catch (e) {
    const status = (e as { status?: number }).status;
    const knownMessages: Record<number, string> = {
      401: "GitHub authentication expired — please sign in again",
      403: "You don't have permission to create issues in this repository",
      404: "Repository not found or not accessible with your token",
      410: "Issues are disabled for this repository",
      422: "GitHub rejected the issue content — check title/body length and repository settings",
    };
    if (status && knownMessages[status]) {
      return NextResponse.json({ ok: false, error: knownMessages[status] }, { status });
    }
    return safeError(e, "Failed to create issue"); // genuinely unexpected — 500, generic message, logged
  }
  ```

Client: extend the workflow-detail page's anomaly card (not
`AnomalyExplanation.tsx`) with a gated (behind `flags.githubIssueFromAnomaly`)
"File as issue" button → confirmation modal (editable title/body, pre-filled
from the anomaly stats already computed on that page, plus
`content.explanation` when `AnomalyExplanation` has one available for the
same metric) → POST, with the submit button disabled immediately on click
(prevents the double-submit duplicate-issue path) → success state showing
the returned issue URL as a link, or the mapped error message on failure.

## Related Code Files

- Create: `src/app/api/github/create-issue/route.ts`
- Modify: `src/app/repos/[owner]/[repo]/workflows/[workflow_id]/page.tsx` —
  add gated button + confirmation modal + success/error state to the
  anomaly card (not `AnomalyExplanation.tsx`)
- Modify: `src/lib/validation.ts` — add title/body length validators if not
  already generic enough to reuse
- No changes to `src/components/AnomalyExplanation.tsx` — it continues to
  render (or not) exactly as it does today; this phase only reads its
  `content.explanation` when present, from the parent page
- Test: `tests/api-github-create-issue.test.ts` (new) — auth required, rate
  limit enforced (6th request in a window rejected), validation limits,
  each mapped error status returns its curated message, unmapped errors
  fall through to `safeError`

## Implementation Steps

1. Write `POST /api/github/create-issue` route: auth check, rate limit,
   validation, `octokit.rest.issues.create`, explicit status-mapped error
   handling (fallback to `safeError` only for unmapped statuses).
2. Write route tests: missing token → 401; 6th request within the window →
   429; oversized title/body → 400; each of 401/403/404/410/422 from a
   mocked octokit throw → its curated message + matching status; an
   unmapped error → generic `safeError` response, no stack trace leak.
3. Add the gated button + confirmation modal + success/error state to the
   workflow-detail page's anomaly card, pre-filling from the page's own
   anomaly stats (always available) plus `AnomalyExplanation`'s
   `content.explanation` when present (best-effort, never blocking).
4. Disable the confirmation modal's submit button on click to prevent
   double-submit duplicates.
5. Manual verification, flag ON, **AI off** (`aiInsights` flag false or no
   provider configured): trigger an anomaly on a real test repo, confirm
   the button renders and files an issue with stats-only content.
6. Manual verification, flag ON, **AI on**: confirm the issue body includes
   the AI explanation when available.
7. Manual verification, flag OFF (default): confirm the button does not
   render in either AI state.
8. Manual verification: attempt to exceed the rate limit, confirm 429 with
   a clear message; attempt against a repo without write access, confirm
   the mapped 403 message (not a generic failure).
9. `pnpm run lint && pnpm exec tsc --noEmit && pnpm test`.

## Success Criteria

- [ ] Button hidden by default (flag defaults `false` per Phase 4) and
      unaffected by Settings' bulk toggle (Phase 4's `writes` exclusion)
- [ ] Button renders and works identically with `aiInsights` on or off —
      verified manually in both states
- [ ] Confirmation modal shows editable title/body before any GitHub write
      — no single-click-to-GitHub path exists
- [ ] Created issue appears in the target repo with correct content,
      verified manually against the returned URL
- [ ] Route requires session auth (401 test-verified) and enforces the rate
      limit (429 test-verified)
- [ ] Oversized title/body rejected with 400 before reaching GitHub
      (test-verified)
- [ ] Each mapped GitHub error status (401/403/404/410/422) returns its
      curated message and matching HTTP status, not a generic 500
      (test-verified)
- [ ] `pnpm run lint && pnpm exec tsc --noEmit && pnpm test` all green

## Risk Assessment

- **Risk:** this remains the only phase performing a real external write
  with hard-to-undo consequences.
  **Mitigation:** mandatory confirmation step, flag-gated default-off
  (now genuinely isolated from bulk-toggle per Phase 4), rate-limited,
  disabled-on-submit to prevent double-submit duplicates, uses the user's
  own token so GitHub's permission model is the real backstop.
  **Signal it broke:** unexpected issues appearing in a user's repo, or a
  bug report about duplicate issue creation.
  **Response:** the flag default-off plus per-Phase-4 bulk-toggle exclusion
  limits blast radius to users who individually opted in; the rate limit
  bounds the worst case even for a bypassed/scripted caller.
- **Risk:** flag remains client-only (documented precedent, not a new gap)
  — a user could call the route directly even with the flag off.
  **Mitigation:** explicitly accepted, matching the existing security model
  for all 13 other flags; the rate limit (new in this phase) is the actual
  abuse-prevention control for a direct/scripted caller, not the flag.
  **Signal it broke:** N/A — documented, accepted design, now backed by a
  rate limit that didn't exist in the original draft.
- **Risk:** merging AI explanation content into the issue body when
  `AnomalyExplanation` has one, while the button lives on the parent page,
  requires the two components to share anomaly-identity state (same
  metric/workflow) without new required props on `AnomalyExplanation`.
  **Mitigation:** the parent page already knows which metric/workflow is
  being viewed (it's what it passes as props to `AnomalyExplanation` today)
  — read `content.explanation` via existing component state/callback rather
  than adding new required props, keeping the "no existing prop changes"
  rule intact.
  **Signal it broke:** implementation finds no clean way to read
  `AnomalyExplanation`'s already-fetched content without prop changes.
  **Response:** accept a required prop addition to `AnomalyExplanation` as
  a fallback (it would be additive/optional, not breaking existing
  callers) rather than block the phase on this.
