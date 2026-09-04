---
phase: 2
title: "Slack Digest Delivery"
status: pending
priority: P2
effort: "1d"
dependencies: []
---

<!-- Updated: Validation Session 1 - corrected false premise, added Slack allowlist, timeout, characterization test per decisions 4, 5 (see plan.md Validation Log) -->

# Phase 2: Slack Digest Delivery

## Overview

The Weekly Leadership Digest (`sendWeeklyLeadershipDigests`,
`src/lib/sync.ts:182-238`) only delivers via email. This phase adds a Slack
delivery path, reusing the existing `channel` column on `alert_rules`.

**Corrected during validation:** the original draft of this phase claimed
`src/app/api/alerts/route.ts:82-83` "hard-requires `destination` to be
validated as an email" — this is false; that line is a presence check only
(`if (metric === "leadership_digest" && !destination)`), no email format
validation exists anywhere in that route. The architecture below is
rewritten against the actual code. It also corrects a second false premise
("no existing rule has `channel` set for leadership_digest today" — false,
`channel` is `NOT NULL` and the route defaults it to `"browser"`) and adds a
security control (webhook allowlist) the original draft omitted entirely.

## Requirements

- Functional: a `leadership_digest` rule with `channel = "slack"` and
  `destination` = a Slack incoming-webhook URL delivers the weekly digest to
  that Slack channel instead of (never in addition to, to keep delivery
  logic simple) email.
- Functional: existing email-channel `leadership_digest` rules (including
  ones with `channel = "browser"`, the current default — see correction
  above) are completely unaffected.
- Security: **Slack destinations are restricted to `https://hooks.slack.com/
  services/*`** — enforced at delivery time in `notifier.ts`, not only at
  rule-creation time (existing rows in the DB bypass creation-time checks).
  This closes an SSRF/data-exfiltration path: without this, the weekly
  digest — full org scorecard narrative, repo names, contributor logins,
  health scores — could otherwise be POSTed to any URL an authenticated user
  supplies, including internal network addresses, on an unattended weekly
  schedule.
- Non-functional: Slack delivery failure (including a slow/hanging
  destination) must not stop other orgs' digests in the same cron run — add
  an explicit fetch timeout (`AbortSignal.timeout(5000)`, matching the
  existing pattern already used in `src/lib/ai.ts:388`) to both the new
  Slack digest delivery **and** the existing `deliverSlack`
  (`src/lib/notifier.ts:77-105`, which has no timeout today and shares the
  same unbounded-hang risk).

## Architecture

1. **Delivery-time allowlist** in `src/lib/notifier.ts`: a shared
   `isAllowedSlackWebhook(url: string): boolean` helper (`url.startsWith
   ("https://hooks.slack.com/services/")`), called by both `deliverSlack`
   and the new `deliverLeadershipDigestSlack` before any `fetch`. A
   rejected URL returns `{ok: false, error: "Destination is not an
   allowed Slack webhook URL"}` without making a network call.
2. Add `deliverLeadershipDigestSlack(webhookUrl, narrative)` to
   `src/lib/notifier.ts`, formatted as Slack `blocks` (mirrors the existing
   `mrkdwn` pattern in `deliverSlack`), truncating `highlights`/`concerns`
   to the top 10 with a "+N more" suffix to stay under Slack's payload
   limits. Uses `AbortSignal.timeout(5000)` on the `fetch` call.
3. Retrofit `AbortSignal.timeout(5000)` onto the existing `deliverSlack`
   call too (`src/lib/notifier.ts:94-99`) — same file, same fix, closes the
   pre-existing hang risk for per-metric alert rules while this phase is
   already touching this function.
4. In `sendWeeklyLeadershipDigests` (`src/lib/sync.ts`), branch delivery on
   `rule.channel`: `"slack"` → `deliverLeadershipDigestSlack`, every other
   value (including the current `"browser"` default) → existing
   `deliverLeadershipDigestEmail`, preserving current behavior exactly for
   every existing row.
5. **Rule-creation validation** in `src/app/api/alerts/route.ts`: add a new
   check — when `metric === "leadership_digest" && channel === "slack"`,
   validate `destination` against the same allowlist before accepting the
   rule (fail fast at creation, in addition to the delivery-time
   enforcement in step 1, which is the actual security boundary). This is
   purely additive — the existing presence-only check for every other
   `channel` value is untouched.
6. **`CreateRuleForm` restructure** (`src/app/alerts/page.tsx`) — confirmed
   during validation that this form intentionally hides the
   threshold/window/channel block for `leadership_digest`
   (`{!isLeadershipDigest && (...)}`, `:272-320`) and force-sets `setChannel
   ("email")` on metric switch (`:239-242`). Splitting the channel selector
   out so it renders for `leadership_digest` (while threshold/window stay
   hidden) requires touching this shared form, used by all 11 alert
   metrics. **Before changing it**, write a characterization test capturing
   current behavior (form renders correctly for at least 2 non-digest
   metrics and for `leadership_digest` with the forced-email default), so
   the restructure has a regression guard it doesn't have today.

## Related Code Files

- Modify: `src/lib/notifier.ts` — add `isAllowedSlackWebhook`,
  `deliverLeadershipDigestSlack`, retrofit timeout onto `deliverSlack`
- Modify: `src/lib/sync.ts` — branch `sendWeeklyLeadershipDigests` on
  `rule.channel`
- Modify: `src/app/api/alerts/route.ts` — add Slack-destination allowlist
  check for `leadership_digest` + `channel === "slack"` (additive only)
- Modify: `src/app/alerts/page.tsx` — `CreateRuleForm`, split the
  `isLeadershipDigest` conditional so channel renders while
  threshold/window stay hidden; remove/adjust the forced `setChannel
  ("email")` to only apply as the *initial* default, not an override
- Test: `tests/notifier.test.ts` (existing file) — add cases for
  `deliverLeadershipDigestSlack` (success, non-allowlisted URL rejected
  before any fetch, timeout behavior), retrofit test for `deliverSlack`'s
  new timeout
- Test: `tests/alerts-create-rule-form.test.tsx` (new) — characterization
  test for current `CreateRuleForm` behavior, written **before** step 6's
  restructure

## Implementation Steps

1. Add `isAllowedSlackWebhook` and retrofit `AbortSignal.timeout(5000)` onto
   `deliverSlack`; add a test proving a non-`hooks.slack.com` URL is
   rejected without a network call.
2. Add `deliverLeadershipDigestSlack` with the same allowlist + timeout +
   truncation; test success/failure/rejection/timeout cases.
3. Add the creation-time allowlist check to `api/alerts/route.ts` (additive
   branch only, existing checks untouched).
4. Branch `sendWeeklyLeadershipDigests` in `sync.ts` on `rule.channel`.
5. Write the `CreateRuleForm` characterization test **before** touching the
   component.
6. Restructure `CreateRuleForm` to expose the channel selector for
   `leadership_digest` rules; re-run the characterization test.
7. `pnpm run lint && pnpm exec tsc --noEmit && pnpm test`.
8. Manual verification: create a `leadership_digest` rule with `channel:
   "slack"` and a real Slack webhook URL, trigger
   `sendWeeklyLeadershipDigests` manually, confirm delivery; attempt to
   create one with a non-Slack URL, confirm rejection at creation; confirm
   existing email/browser-channel rules still send unchanged.

## Success Criteria

- [ ] Non-`hooks.slack.com` destinations are rejected both at rule
      creation and at delivery time (test-verified)
- [ ] Existing email/browser-channel `leadership_digest` rules unaffected —
      characterization test passes before and after the form restructure
- [ ] Slack delivery failure or hang for one org doesn't stop other orgs'
      digests (timeout-bounded, existing per-org try/catch preserved)
- [ ] `deliverSlack` (existing per-metric alerts) also gains the timeout fix
- [ ] `pnpm run lint && pnpm exec tsc --noEmit && pnpm test` all green

## Risk Assessment

- **Risk:** the allowlist is Slack-specific and permanently forecloses any
  other webhook-based integration (Discord, Teams, generic webhook) without
  a further code change.
  **Mitigation:** explicitly accepted — this phase's scope is Slack only;
  the allowlist is a named security boundary, not an oversight, and widening
  it later is a deliberate, reviewable change rather than an open door.
  **Signal it broke:** a user requests a non-Slack webhook destination.
  **Response:** scope a follow-up phase with its own allowlist entry, never
  loosen to "any URL."
- **Risk:** restructuring `CreateRuleForm` for `leadership_digest` could
  regress the UX for one of the other 10 metrics sharing the same form.
  **Mitigation:** characterization test written first, specifically
  covering at least 2 non-digest metrics' current rendering.
  **Signal it broke:** characterization test fails after the restructure.
  **Response:** the test is the tripwire by construction — fix the
  restructure until it passes again, do not weaken the test.
