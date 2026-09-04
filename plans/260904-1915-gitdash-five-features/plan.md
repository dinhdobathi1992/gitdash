---
title: "GitDash — Five Value-Add Features"
description: "Fix the alert engine's PR-facts gap, add Slack digest delivery, metric export, a flag-gated rollout convention, and anomaly-to-GitHub-issue — each additive and independently revertible."
status: complete
priority: P2
effort: "6-7d"
tags: [gitdash, alerts, notifier, export, feature-flags, github-write]
blockedBy: []
blocks: []
created: 2026-09-04
---

# GitDash — Five Value-Add Features

## Overview

Five features recommended in `plans/reports/brainstorm-260904-1906-...` (see
also the earlier `plans/reports/brainstorm-260825-2221-gitdash-next-release.md`,
Finding 1), scoped into one plan at the user's request, with an explicit
non-breaking constraint on every phase.

**Non-breaking design rule applied everywhere below:**
- Every DB change is an additive, idempotent `CREATE TABLE IF NOT EXISTS` /
  `ADD COLUMN IF NOT EXISTS` migration appended to the existing
  `MIGRATIONS` array in `src/lib/db.ts` — never an `ALTER`/`DROP` on
  existing columns, never a rewrite of an existing migration.
- Every new user-facing capability that **writes** anywhere (GitHub, email,
  Slack) ships behind a feature flag defaulting **false**, using the
  existing `src/lib/feature-flags.ts` + `src/components/FeatureFlagsProvider.tsx`
  + Settings-page card infrastructure (already built, confirmed working —
  see Phase 4).
- Every new code path that can fail (AI, Slack, GitHub write, email) degrades
  silently to a no-op/log, mirroring the existing pattern already used in
  `sendWeeklyLeadershipDigests` (`src/lib/sync.ts:206-220`, AI summary
  failure never blocks digest send) and `syncRepo`'s alert-evaluation
  try/catch (`src/lib/sync.ts:106-113`).
- No existing route, exported function signature, table column, or component
  prop is renamed, removed, or given new required parameters.
- Per user's DB rule: any phase touching Neon runs `pg_dump`-based backup
  guidance in its own file before migration (see Phase 1).

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Alert engine's `pr_facts` table actually gets written — 4/8 alert metrics stop silently never firing | P1 |
| 2 | Weekly Leadership Digest delivers to Slack, not just email | P2 |
| 3 | DORA / cost / org-health metrics exportable as CSV/JSON | P2 |
| 4 | Establish "new capability → flag defaults false" as a written, followed convention | P2 |
| 5 | One-click "file as GitHub issue" from an anomaly explanation | P3 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Fix PR Facts Sync](./phase-01-fix-pr-facts-sync.md) | Complete |
| 2 | [Phase 2: Slack Digest Delivery](./phase-02-slack-digest-delivery.md) | Complete |
| 3 | [Phase 3: Metrics CSV/JSON Export](./phase-03-metrics-csv-json-export.md) | Complete |
| 4 | [Phase 4: Flag-Gated Rollout Convention](./phase-04-flag-gated-rollout-convention.md) | Complete |
| 5 | [Phase 5: Anomaly → GitHub Issue](./phase-05-anomaly-to-github-issue.md) | Complete |

**Dependency:** Phase 5 depends on Phase 4 (needs the flag registered before
the write-capable UI ships). Phases 1-3 are independent of each other and of
4/5 — can execute or ship in any order, including only some of them.

## Non-Goals

- No new provider (GitLab/Bitbucket) work — out of scope, already rejected in
  the prior brainstorm.
- No rewrite of `iron-session` auth or the visualization layer.
- No new persistent audit-log table for Phase 5 — the created GitHub issue
  itself is the audit trail (KISS; avoids an extra migration for a feature
  that's easy to verify by checking the target repo's issue list).
- No per-org server-side flag storage for Phase 4 — the existing per-browser
  localStorage flag system is reused as-is (see Phase 4 rationale).
- No multi-provider webhook support in Phase 2 (Discord, Teams, generic) —
  Slack only, hard-allowlisted (see Phase 2 rationale, added during
  validation after the SSRF finding).

<!-- Updated: Validation Session 1 -->
**Note:** Phase 1 was redesigned during validation to own a new, dedicated
Vercel Cron entry point (`/api/cron/sync-pr-facts`). This is new scope beyond
the original single-migration framing but was an explicit, deliberate
decision made during validation (see Validation Log) — not scope creep.

## Success Criteria

- [ ] All 5 phases pass `pnpm run lint && pnpm exec tsc --noEmit && pnpm test` with zero regressions in existing 20 test files
- [ ] Every new DB migration is additive and idempotent; a pglite-backed test (Phase 1) proves `ensureSchema()` replay is a real no-op against actual SQL, not a mocked short-circuit
- [ ] Every new write-capable feature (Slack digest, GitHub issue creation) is behind a flag defaulting `false`, and write-capable flags are excluded from Settings' bulk Enable/Disable-all (Phase 4)
- [ ] No existing API route response shape changes (verified by re-running existing route tests unmodified)
- [ ] Manual smoke test: full sync → alert evaluation → digest send cycle still completes for a repo with zero PRs (empty-input edge case)
- [ ] PR-facts backfill for a repo does not fire any of the 4 gated alert metrics until backfill is marked complete (Phase 1)
- [ ] Slack digest destinations are rejected unless they match `https://hooks.slack.com/services/*` (Phase 2)

## Validation Log

### Session 1 — 2026-09-04

**Verification Results** (reused from the same-day Red Team Review's Full-tier evidence — Fact Checker, Flow Tracer, Scope Auditor across all 3 hostile reviewers, ~60+ claims sampled with file:line citations, rather than re-running a fresh verification pass):
- Verified: ~55 claims (file paths, symbols, functions, schema columns, existing helpers all exist as cited)
- Failed: 2 explicit fact failures (Phase 2's claimed email-validation check at `api/alerts/route.ts:82-83` does not exist — presence check only; route count stated as 47, actual 48) plus systemic design contradictions in Phases 1, 2, 5 (not simple fact errors — see Red Team Findings below)
- Tier: Full (5 phases)

**Red Team disposition:** 15 findings accepted (see `### Red Team Findings` below), surfaced in the same session immediately prior to this validation. Rather than apply them as a separate mechanical patch pass, the design forks they raised were resolved through this validation interview and propagated to phase files together in one pass (avoids two separate edit/consistency-sweep cycles).

**Questions asked:** 7 (within configured 3-8 range)

| # | Topic | Decision |
|---|---|---|
| 1 | Phase 1 redesign scope | **Full redesign**: mandatory per-PR detail fetch (not sampled), real pagination with page cap, backfill-mute before alert eval |
| 2 | Cron timeout risk | **Separate cron route**: PR-facts sync gets its own Vercel Cron entry, fully decoupled from run-sync + digest delivery |
| 3 | DB test verification | **Add pglite harness**: embedded Postgres dev dependency so migration replay and metric SQL run for real in vitest |
| 4 | Slack destination security | **Hard allowlist**: `https://hooks.slack.com/services/*` only, enforced at delivery time |
| 5 | Phase 2 form restructure effort | **Proceed with characterization test first**: capture current `CreateRuleForm`/alerts-route behavior before changing it |
| 6 | Flag bulk-toggle blast radius | **Exclude write-capable flags from bulk toggle**: add `writes: true` marker to `FlagDef`, bulk Enable/Disable-all skip them |
| 7 | Phase 5 AI-off requirement | **Move button to parent workflow page**: works regardless of `aiInsights` flag state, since that page holds the raw stats `AnomalyExplanation` doesn't |

### Red Team Findings

**Session — 2026-09-04**
**Findings:** 15 (15 accepted, 0 rejected) — see full red-team transcript in conversation; not persisted as a separate report file per repo's report-cap guidance, summarized here instead.
**Severity breakdown:** 7 Critical, 7 High, 1 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---|---|---|---|
| 1 | Slack webhook destination has no host validation (SSRF) | Critical | Accept | Phase 2 |
| 2 | Requirements/Architecture contradiction on per-PR detail | Critical | Accept | Phase 1 |
| 3 | No pagination → permanent silent PR gaps | Critical | Accept | Phase 1 |
| 4 | `unreviewed_pr_age` unbounded → alert storm on backfill | Critical | Accept | Phase 1 |
| 5 | API cost underestimated 10-60x → cron timeout kills digests | Critical | Accept | Phase 1 |
| 6 | No DB test harness exists — SQL claims unfalsifiable | Critical | Accept | Phase 1 |
| 7 | Phase 5 AI-off fallback unreachable in targeted component | Critical | Accept | Phase 5 |
| 8 | Partial upsert overwrites review data with NULL | High | Accept | Phase 1 |
| 9 | Phase 2 premise about existing email validation is false | High | Accept | Phase 2 |
| 10 | Phase 2 underestimates `CreateRuleForm` restructure effort | High | Accept | Phase 2 |
| 11 | "Enable all" arms the GitHub-write flag | High | Accept | Phase 4 |
| 12 | `safeError` swallows real GitHub error status | High | Accept | Phase 5 |
| 13 | Write route has no rate limit | High | Accept | Phase 5 |
| 14 | `/api/db/sync` had no `maxDuration` (resolved by removing PR-fetch from that route entirely — see decision 2) | High | Accept | Phase 1 |
| 15 | CSV export vulnerable to formula injection | Medium | Accept | Phase 3 |

### Phase Propagation

- Phase 1: rewritten — mandatory per-PR detail, real pagination, backfill-mute, dedicated cron route (`/api/cron/sync-pr-facts`), pglite test harness, UPDATE-only cursor (no repo enrollment), backup dump directed outside repo tree
- Phase 2: rewritten — corrected validation premise, Slack allowlist + delivery-time enforcement, fetch timeout, characterization test step, `CreateRuleForm` restructure named explicitly, effort re-estimated 0.5d → 1d
- Phase 3: updated — CSV formula-injection escaping added to requirements and success criteria
- Phase 4: updated — `writes` marker on `FlagDef`, bulk toggle exclusion
- Phase 5: rewritten — button moved to workflow-detail page, `safeError` replaced with explicit GitHub-status passthrough, rate limit added, dependency retargeted

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01 through phase-05 (all 6 files)
- Decision deltas checked: 7 validation decisions + 15 red-team findings = 22
- Reconciled stale references: Phase 1's "reuse github-dora.ts pattern unmodified" language, Phase 2's false email-validation premise, Phase 5's `AnomalyExplanation`-targeting language, Phase 4's "3-line change, zero interaction" claim, plan-level Non-Goals (added: no separate audit-log DB table still holds; added note that Phase 1 now owns its own cron entry point, which is new scope beyond the original "no new provider" non-goal but was explicitly decided in this session)
- Unresolved contradictions: 0

**Recommendation:** proceed to implementation. Every finding that survived adjudication has a concrete, decided fix propagated into its phase file below.
