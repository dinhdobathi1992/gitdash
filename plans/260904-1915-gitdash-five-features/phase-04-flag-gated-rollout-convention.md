---
phase: 4
title: "Flag-Gated Rollout Convention"
status: pending
priority: P2
effort: "0.5d"
dependencies: []
---

<!-- Updated: Validation Session 1 - added `writes` marker + bulk-toggle exclusion, decision 6 / red-team Finding 11 -->

# Phase 4: Flag-Gated Rollout Convention

## Overview

The flag infrastructure already exists and works: `src/lib/feature-flags.ts`
(`DEFAULT_FLAGS`, `useSyncExternalStore`-backed store), the provider
(`src/components/FeatureFlagsProvider.tsx`), and a full Settings-page card
grid UI (`src/app/settings/page.tsx:127-330`, `FLAG_DEFS` +
`FeatureCard`) with per-flag toggle, "enable all"/"disable all" — this is not
missing infrastructure. The actual gap (Finding 5 of the prior brainstorm) is
that **every existing flag defaults `true`**, so nothing ships gradually.
This phase does the minimum to fix that going forward: register the flag
Phase 5 needs, defaulting `false`, and document the convention so it's
followed for the next capability too — not a rebuild of working
infrastructure.

**Corrected during validation:** the original draft claimed this change has
"zero interaction" with existing flag behavior. Red-team review found that's
false — `FLAG_DEFS` is the iteration source for the existing "Enable all" /
"Disable all" bulk buttons (`settings/page.tsx:307,313`), so registering a
write-capable flag there means one click on "Enable all" silently arms
GitHub-issue-creation for a user who only meant to see more dashboard
panels. This phase now also adds a `writes` marker so bulk actions can
exclude write-capable flags — the convention isn't complete without it.

## Requirements

- Functional: add `githubIssueFromAnomaly: boolean` to `FeatureFlags`
  (`src/lib/feature-flags.ts`) and `DEFAULT_FLAGS`, set to `false`.
- Functional: add a `writes?: boolean` field to the `FlagDef` type
  (`src/app/settings/page.tsx:128`) and set it `true` on the
  `githubIssueFromAnomaly` entry.
- Functional: the "Enable all" / "Disable all" bulk handlers
  (`settings/page.tsx:307,313`) filter to `FLAG_DEFS.filter(d => !d.writes)`
  before applying — write-capable flags are never touched by a bulk action,
  only by their own individual toggle.
- Functional: add a matching `FlagDef` entry to `FLAG_DEFS`
  (`src/app/settings/page.tsx:135`) so it's visible and individually
  toggleable in the existing Settings UI — reuse `FeatureCard`, but the
  card's copy/description makes clear this flag grants a write capability
  (not merely a display toggle), distinct from the other 13.
- Documentation: add a one-line convention comment directly above
  `DEFAULT_FLAGS` in `feature-flags.ts` stating new entries default `false`
  until proven, and that any write-capable flag must set `writes: true` on
  its `FlagDef` so it's excluded from bulk actions.
- Non-functional: **zero changes** to any of the 13 existing flags' default
  values or to bulk-toggle behavior for them — this phase only adds one new
  flag and one new bulk-handler filter; nothing about current user
  experience changes for anyone who never opts into Phase 5's feature.

## Architecture

No new files, no new components, no new storage mechanism. This is a 3-line
change to an existing type + object + array, exercising infrastructure that
already ships in production (Settings page, localStorage sync,
`useSyncExternalStore`). Server-side/per-org flag storage is explicitly out
of scope (see plan-level Non-Goals) — the existing per-browser localStorage
model is what Phase 5 gates on, same as every other flag today.

## Related Code Files

- Modify: `src/lib/feature-flags.ts` — add `githubIssueFromAnomaly` to
  `FeatureFlags` type and `DEFAULT_FLAGS` (`false`); add convention comment
- Modify: `src/app/settings/page.tsx` — add `writes?: boolean` to `FlagDef`
  type; add `FlagDef` entry to `FLAG_DEFS` with `writes: true`; filter both
  bulk-toggle handlers to exclude `writes: true` entries
- Test: `tests/settings-flag-bulk-toggle.test.ts` (new, or colocated
  component test) — "Enable all" does not flip a `writes: true` flag;
  "Disable all" does not flip it either (it must only ever change via its
  own individual toggle)

## Implementation Steps

1. Add `githubIssueFromAnomaly: false` to `DEFAULT_FLAGS` and the
   `FeatureFlags` type in `feature-flags.ts`, with the convention comment.
2. Add `writes?: boolean` to the `FlagDef` type in `settings/page.tsx`.
3. Add the corresponding `FlagDef` (label, description noting it grants a
   write capability, `affects`, `writes: true`) to `FLAG_DEFS`, following
   the shape of neighboring entries (e.g. `workloadRisk` at line 147).
4. Update the "Enable all"/"Disable all" `onClick` handlers to filter out
   `writes: true` entries before iterating.
5. Write the bulk-toggle exclusion test.
6. Manually verify in the Settings page: new flag card renders, toggles
   individually, persists across reload (localStorage), defaults off for a
   fresh browser profile, and is **not** affected by "Enable all"/"Disable
   all".
7. `pnpm run lint && pnpm exec tsc --noEmit && pnpm test`.

## Success Criteria

- [ ] `githubIssueFromAnomaly` flag exists, defaults `false`
- [ ] Visible and individually toggleable in Settings page
- [ ] "Enable all"/"Disable all" do not affect `writes: true` flags
      (test-verified)
- [ ] All 13 existing flags' default values (`true`) and bulk-toggle
      behavior completely unchanged
- [ ] `pnpm run lint && pnpm exec tsc --noEmit && pnpm test` all green

## Risk Assessment

- **Risk:** the bulk-handler filter is easy to get backwards (excluding the
  wrong set) and would fail silently — a UI toggle bug, not a crash.
  **Mitigation:** dedicated test asserting `writes: true` flags are
  unaffected by both bulk buttons; manual verification step explicitly
  checks this before considering the phase done.
  **Signal it broke:** "Enable all" flips `githubIssueFromAnomaly` to true
  in manual testing or the bulk-toggle test fails.
  **Response:** trivial fix — this phase's footprint is a handful of lines;
  correct the filter predicate.
- **Risk:** near zero for the 13 existing flags — additive type field +
  array entry + a filter that by construction only changes behavior for
  entries marked `writes: true` (none exist yet besides the new one).
  **Mitigation:** diff review confirms no existing `DEFAULT_FLAGS` value or
  `FLAG_DEFS` entry is touched.
  **Signal it broke:** any existing flag's default or bulk-toggle behavior
  changes unexpectedly in the diff.
  **Response:** trivial revert.
