---
phase: 1
title: "Fix PR Facts Sync"
status: pending
priority: P1
effort: "2.5d"
dependencies: []
---

<!-- Updated: Validation Session 1 - full redesign per decisions 1, 2, 3 (see plan.md Validation Log) -->

# Phase 1: Fix PR Facts Sync

## Overview

`pr_facts` (migration `pr_facts_table`, `src/lib/db.ts:219-240`) is read by 4 of
8 alert metrics but its only writer, `upsertPrFacts` (`src/lib/db.ts:396`), has
**zero callers**. The read path silently leaves `value` unset when the table
is empty, so these rules never fire and report no error.

**This phase was substantially redesigned during validation** after red-team
review found the original single-page, sampled-detail design would replace
"silently never fires" with either false alerts (throughput/abandon-rate
computed over a truncated sample) or a permanent alert storm
(`unreviewed_pr_age` has no time window and would fire immediately and
forever on old open PRs the moment the table is populated). The redesign
below makes per-PR detail mandatory, adds real pagination, adds a
backfill-mute so alert evaluation never runs against incomplete data, and
moves PR-facts sync to its own dedicated cron entry point so it can never
delay or block the existing daily/weekly digest delivery.

## Requirements

- Functional: after a full backfill, `pr_facts` contains rows for **every**
  PR in the repo (not a sampled subset) with `first_review_at`,
  `approved_at`, `review_count` always populated (never left NULL by a
  partial fetch) — these three fields are read directly by
  `review_response_p90` and `unreviewed_pr_age` and must be trustworthy.
- Functional: `unreviewed_pr_age` and the other 3 gated alert metrics must
  **not evaluate** for a repo until that repo's PR backfill is marked
  complete — populating the table must never itself trigger an alert storm.
- Functional: PR-facts sync runs on its **own** Vercel Cron schedule
  (`vercel.json`), separate from `/api/cron/sync` — it must be structurally
  impossible for a slow or rate-limited PR sync to delay `sendPendingDigests`
  or `sendWeeklyLeadershipDigests`.
- Non-functional: real pagination with an explicit page cap; the sync cursor
  only advances past PRs that were actually, successfully written — a
  truncated page must never cause permanent data loss.
- Non-functional: bounded API cost — the true cost is ~3 calls/PR
  (`listCommits` + `listReviews` + `pulls.get`), not the "~2x" originally
  estimated; the implementation must budget and log actual call counts per
  run so the real cost is visible, not assumed.
- Non-functional: migration and metric-SQL correctness must be verifiable by
  a test that actually executes SQL (see pglite harness below), not a test
  that mocks `@/lib/db`.

## Architecture

### New dedicated cron route

`src/app/api/cron/sync-pr-facts/route.ts` (new file, mirrors
`src/app/api/cron/sync/route.ts`'s auth pattern — `CRON_SECRET` bearer check,
`GITHUB_TOKEN` service identity) — added to `vercel.json`'s `crons` array on
its own schedule (e.g. nightly, offset from the existing sync/digest cron so
the two never overlap in a way that doubles GitHub API pressure). Its own
`maxDuration` budget, independent of `/api/cron/sync`.

**Manual sync (`/api/db/sync`) is explicitly out of scope for PR-facts** —
it continues to do exactly what it does today (run-sync only). This removes
the timeout risk that a synchronous PR fetch would have introduced into the
interactive "Sync from GitHub" button (red-team Finding 14), by construction
rather than by adding a deadline guard.

### Backfill state

New column on `sync_cursors`: `pr_backfill_complete BOOLEAN NOT NULL DEFAULT
FALSE` (additive, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). Set `TRUE`
only after a repo's first full paginated PR fetch completes without hitting
the page cap. `evaluateAlertRulesForRepo`'s 4 `pr_facts`-backed metrics
(`src/lib/db.ts:840-931`) gain a precondition: skip evaluation entirely (not
"evaluate to null" — skip, same as today's "rule not evaluated" state) when
`pr_backfill_complete` is `false` for that repo.

### Fetch design

`fetchAndUpsertPrFacts(octokit, owner, repoName)`:
1. Paginate `octokit.rest.pulls.list({state: "all", sort: "updated",
   direction: "desc", per_page: 100})` up to a page cap (e.g. 10 pages =
   1,000 PRs) or until a page returns fewer than `per_page` results.
2. For **every** PR in scope (not a `DETAIL_LIMIT`-bounded subset), fetch
   `listReviews` (for `first_review_at`/`approved_at`) and `pulls.get` (for
   `additions`/`deletions`) via `pLimitSettled` at bounded concurrency
   (`CONCURRENCY = 5`, lower than `github-dora.ts`'s 10, since this fetch
   runs unattended and cost visibility matters more than latency here).
3. Only advance `pr_sync_cursor` to the `updated_at` of the **oldest
   successfully-processed** PR in the batch, and only mark
   `pr_backfill_complete = TRUE` if the page loop terminated by exhaustion
   (not by hitting the page cap) — a repo that hits the cap stays
   `pr_backfill_complete = false` and is retried (from where it left off)
   on the next scheduled run, rather than silently treated as done.
4. Detail-fetch failures (`pLimitSettled` rejections) are logged with a
   count; a PR whose detail fetch failed is **not** upserted this run (it
   stays queued for the next run via the cursor) rather than being written
   with partial/NULL fields — this removes the NULL-overwrite risk
   (red-team Finding 8) by construction: a row is only ever written with all
   fields populated.

### Cursor column semantics

`pr_sync_cursor` is written via `UPDATE sync_cursors SET pr_sync_cursor =
$2, pr_backfill_complete = $3 WHERE repo = $1` — **no `INSERT`/upsert**.
This guarantees PR-facts sync can never create a `sync_cursors` row (and
therefore can never enroll a repo into either cron's tracked-repo list) —
only `updateSyncCursor` (the existing run-sync path) creates rows. The new
dedicated cron iterates `listSyncedRepos()` (the same existing "tracked"
list) — a repo only gets PR-facts synced once it already has Actions-run
history, which is an acceptable scope boundary stated explicitly here rather
than left implicit.

### Test verification — pglite harness

Add `@electric-sql/pglite` (or equivalent embedded-Postgres package) as a
dev dependency. New `tests/setup/pglite.ts` provides a real, disposable
Postgres instance per test file so `ensureSchema()`, the new migration, and
the four metric SQL queries in `src/lib/db.ts:840-931` execute for real —
not against a mocked `@/lib/db`. This is new test infrastructure, scoped
explicitly here rather than assumed to exist.

**Before running any migration against a real (non-test) database**, back
up first per project rule:
`pg_dump "$DATABASE_URL" > ~/.gitdash-backups/backup-pre-pr-facts-$(date +%Y%m%d).sql`
— **outside the repo working tree**, not into the repo root (red-team
Finding: a repo-root dump risks being committed and exposing sealed
provider API keys / contributor PII via `git add -A`). Confirm with the
user before running against a shared/production `DATABASE_URL`.

## Related Code Files

- Create: `src/app/api/cron/sync-pr-facts/route.ts`
- Create: `tests/setup/pglite.ts`
- Modify: `vercel.json` — add the new cron schedule entry
- Modify: `src/lib/sync.ts` — add `fetchAndUpsertPrFacts` (paginated,
  mandatory-detail version, not called from `syncRepo`)
- Modify: `src/lib/db.ts` — add `pr_sync_cursor` + `pr_backfill_complete`
  migration (additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on
  `sync_cursors`); add `getPrSyncCursor`/`updatePrSyncCursor` (UPDATE-only,
  no INSERT); add the `pr_backfill_complete` precondition to
  `evaluateAlertRulesForRepo`'s 4 gated metrics
  (`src/lib/db.ts:840-931`)
- Modify: `package.json` — add pglite (or equivalent) dev dependency
- Test: `tests/sync-pr-facts.test.ts` (new, pglite-backed) — pagination
  behavior (cursor only advances past successfully-processed PRs, page-cap
  handling), backfill-mute (4 metrics skip evaluation pre-completion, fire
  correctly post-completion), no-NULL-overwrite guarantee, migration replay
  idempotency against a real schema

## Implementation Steps

1. Add `@electric-sql/pglite` dev dependency; write `tests/setup/pglite.ts`.
2. Add the `pr_sync_cursor`/`pr_backfill_complete` migration to `MIGRATIONS`
   in `src/lib/db.ts`; add `getPrSyncCursor`/`updatePrSyncCursor` (UPDATE-only).
3. Write `fetchAndUpsertPrFacts` in `src/lib/sync.ts`: paginated `pulls.list`,
   mandatory per-PR detail via `pLimitSettled(CONCURRENCY=5)`, cursor
   advances only past successfully-processed rows, `pr_backfill_complete`
   set only on clean exhaustion.
4. Add the `pr_backfill_complete` precondition to the 4 gated metrics in
   `evaluateAlertRulesForRepo`.
5. Create `src/app/api/cron/sync-pr-facts/route.ts` (own auth, own
   `maxDuration`, own `GITHUB_TOKEN` service identity, iterates
   `listSyncedRepos()`); add its cron schedule to `vercel.json`.
6. Write `tests/sync-pr-facts.test.ts` against the pglite harness: real
   migration replay, real metric SQL execution pre/post backfill-complete,
   pagination/cursor edge cases, no-NULL-overwrite guarantee.
7. Manual verification: run the new cron route manually (or via `curl` with
   the `CRON_SECRET` header) against a real low-traffic repo; confirm
   `pr_facts` row count matches the repo's actual PR count, `sync_cursors.
   pr_backfill_complete` flips to `true`, and an alert rule on one of the 4
   metrics evaluates to a real value only after that flip.
8. `pnpm run lint && pnpm exec tsc --noEmit && pnpm test`.

## Success Criteria

- [ ] `pr_facts` populated with every PR for a repo, all detail fields
      non-NULL (verified by pglite-backed test)
- [ ] The 4 gated alert metrics skip evaluation entirely until
      `pr_backfill_complete = true`, and evaluate correctly after — verified
      by pglite-backed test, not a mock
- [ ] A truncated page (hits the cap) leaves `pr_backfill_complete = false`
      and resumes correctly on the next run — verified by test
- [ ] `/api/db/sync` and `syncRepo` are completely unmodified by this phase
      — PR-facts sync lives entirely in its own new route/function
- [ ] `/api/cron/sync` (existing digest delivery) is unaffected — verified
      by confirming no import/call from `sync-pr-facts` code into the
      existing cron route
- [ ] Migration is additive/idempotent — pglite test proves `ensureSchema()`
      replay is a real no-op against actual SQL
- [ ] `pnpm run lint && pnpm exec tsc --noEmit && pnpm test` all green

## Risk Assessment

- **Risk:** true per-PR-detail cost (~3 calls/PR) on a large repo's first
  backfill could still take a long time even in a dedicated cron with its
  own budget.
  **Mitigation:** page cap + resumable cursor means a large repo backfills
  incrementally across multiple scheduled runs rather than needing to
  complete in one invocation; `pr_backfill_complete` only flips once fully
  caught up, so alert evaluation correctly waits.
  **Signal it broke:** a repo's `pr_backfill_complete` never flips to true
  after many runs. **Response:** investigate whether the repo's PR volume
  exceeds the page cap × run frequency; raise the cap or run frequency.
- **Risk:** dedicated cron doubles the number of scheduled GitHub API
  consumers against the same service `GITHUB_TOKEN` rate-limit bucket.
  **Mitigation:** schedule offset from `/api/cron/sync`; lower concurrency
  (5 vs 10) specifically for this unattended path.
  **Signal it broke:** 403/429 rate-limit errors increase measurably.
  **Response:** widen the schedule interval or lower the page cap per run.
- **Risk:** pglite may not perfectly replicate Neon/Postgres behavior for
  every SQL construct used (e.g. specific percentile functions).
  **Mitigation:** this is accepted as materially better than the current
  zero coverage; any pglite/Neon divergence found in manual verification
  (step 7) gets fixed as a follow-up, not a blocker to shipping this phase.
  **Signal it broke:** manual verification against real Neon disagrees with
  pglite test results. **Response:** file the specific divergence, adjust
  the test or the query.
