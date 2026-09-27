---
phase: 3
title: "Opt-in Postgres L2 cache (migration v8)"
status: completed
priority: P1
effort: "1d"
dependencies: [0, 2]
---

# Phase 3: Opt-in Postgres L2 cache

## Overview
Add a shared second cache layer (L2) in the existing Postgres. Replicas and instances then share hits for GitHub DTO routes. L2 is **opt-in per call**, and only in org mode with `DATABASE_URL` set.

## Requirements
- **Opt-in only** <!-- RT #1 -->: `withCache(key, ttl, factory, { shared: true })`. Only `/api/github/*` read routes pass `shared: true`. Settings caches (`ai-provider:settings` in `src/lib/ai.ts:155`, `email-provider:settings` in `src/lib/notifier.ts:146`), AI results, `perm:` and `whoami:` **never** use L2.
- **Lookup order:** L1 → in-flight → L2 (if shared) → factory. An L2 hit refills L1 with the remaining TTL.
- **Awaited write** <!-- RT #9 -->: the L2 write is awaited inside the in-flight promise, bounded by the same 300ms timeout. The in-flight entry is cleared only after the write. `cacheDelete*` also deletes the key from L2, awaited. A delete can therefore never be overtaken by a pending write from the same instance.
- **Upsert** <!-- RT #13 -->: `INSERT … ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`.
- **Jitter:** `expires_at = now + ttl × (1 + rand(0, 0.1))`. Instances then don't all expire at the same moment and refetch together.
- **Purge** <!-- RT #13 -->:
  - Delete expired rows on read (`DELETE … WHERE key = $1 AND expires_at < now()` when a miss finds an expired row).
  - Sampled purge on ~1% of writes (`DELETE FROM api_cache WHERE expires_at < now()`).
  - The cron `/api/cron/sync` also purges, **before** its `GITHUB_TOKEN` guard.
  - Helm has no cron, so the sampled purge is the primary mechanism.
- **Failure:** L2 reads and writes use `AbortController` with a 300ms deadline passed to the Neon fetch, and are treated as a miss or no-op on any error. A DB failure never fails the request.
- **Size:** skip L2 for JSON values over 512 KB (log once per key prefix).

## Architecture
- Migration v8 (see `plan.md`) in `src/lib/db.ts`, using `IF NOT EXISTS` and the advisory-locked `ensureSchema` from phase 0.
- New `src/lib/cache-l2.ts`: `l2Get`, `l2Set`, `l2Delete`, `l2DeleteByPrefix`, `l2Purge`, `isL2Enabled()` = `!!DATABASE_URL && !isStandaloneMode()`.
- `src/lib/cache.ts` calls into L2 only when `opts.shared`.

## Related Code Files
- Modify: `src/lib/db.ts` (v8), `src/lib/cache.ts`, `src/app/api/cron/sync/route.ts`
- Create: `src/lib/cache-l2.ts`
- Modify: the `/api/github/*` routes wrapped in phase 2 (add `shared: true`)
- Tests: `tests/cache-l2.test.ts` (PGlite via phase 0)

## Implementation Steps
0. **Back up the local DB** (`pg_dump` from the Docker Postgres to `~/gitdash-backups/`, outside the repo) before the first v8 run. Production is never touched in this delivery.
1. Add migration v8.
2. Implement `cache-l2.ts` with the abortable timeout.
3. Wire into `withCache`, `cacheSet` (when shared) and `cacheDelete*`.
4. Tests (PGlite):
   - Instance A computes the value; `__resetCacheForTests()`; instance B gets an L2 hit with the factory not called.
   - An expired row is a miss and gets deleted.
   - A throwing DB still runs the factory, with no error.
   - An oversize value is not written.
   - A **non-shared key (the `ai-provider:settings` pattern) never reaches `l2Set`.**
   - A delete after a write leaves no row.
5. Add the purge to the cron route, placed before the token guard.

## Success Criteria
- [x] Local run: two `next start` processes (ports 3100 and 3101; 3000 is used by another local project) share the Docker DB. Loading `org-overview` on 3101 right after 3100 shows an L2 hit and 0 GitHub calls in the `GITDASH_GH_LOG` output. **Checkpoint: stop here for Thi's review before phase 4.**
- [x] All L2 tests pass, including the secret-exclusion test.
- [x] Standalone mode never touches the DB (test).
- [x] `api_cache` holds only `/api/github/*` key prefixes (test by listing prefixes after a run).

## Risk Assessment
- Cached private-repo DTOs are now at rest in Postgres. They are token-scoped, TTL-bounded and purged, and this is documented in `README-SECURITY-ENHANCEMENTS.md`. Signal: a security review objects → restrict `shared` to org-level aggregate routes only.
- A Neon cold start makes the first L2 read slow. The 300ms abort treats it as a miss.
