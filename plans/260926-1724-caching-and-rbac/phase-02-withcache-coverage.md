---
phase: 2
title: "withCache coverage for uncached routes"
status: completed
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: withCache coverage for uncached routes

## Overview
Route every read-only GitHub fan-out through `withCache`. Repeat loads and concurrent requests should then cost zero GitHub calls, or at most one set of calls.

## Requirements
- Wrap the GitHub-reading body of each uncached read route in `withCache(key, ttl, factory, opts)`.
- **Keys** <!-- RT #13 -->: `<route>:${hashKey(token)}:<validated, allowlisted params>`, following `src/app/api/github/org-overview/route.ts:49-56`:
  - Validate and cap each parameter.
  - Unknown parameters are ignored and never part of the key.
- **TTL:** the server TTL keeps each route's `CACHE_TTL`. `runs` and `run-details` use a server TTL ≤ 15s, so in-progress runs refresh.
- **No caching of degraded results** <!-- RT #9 -->:
  - Extend `withCache` with an `opts.shouldCache?: (v) => boolean`.
  - Results flagged `partial: true` (e.g. `contributor-profile` on rate limit) are returned but not stored.
  - AI routes pass `shouldCache: v => "ok" in v`, replacing the store-then-`cacheDelete` pattern at `src/app/api/ai/{insights,root-cause,anomaly-explanation}/route.ts`.
- **Not cached:** `create-issue` (write), `rate-limit` (must be live).

## Architecture
The only change to `withCache` is a new optional `opts` argument (`shouldCache`; `shared` is added in phase 3). Existing callers are unaffected.

## Related Code Files
- Modify: `src/lib/cache.ts` (`opts.shouldCache`)
- Modify (routes without `withCache`): `src/app/api/github/{audit-log,billing,billing/cost-analysis,contributor-profile,job-stats,open-pr-health,org-repos,orgs,repo-contributors,repo-dora,repo-overview,repo-summary,repos,run-details,runs,security-scan,team-stats,workflows}/route.ts`
- Modify: `src/app/api/ai/{insights,root-cause,anomaly-explanation}/route.ts` (use `shouldCache`)
- Tests: `tests/cache.test.ts` (shouldCache), `tests/cache-coverage.test.ts` (new)

## Implementation Steps
1. Add `shouldCache` to `withCache`, with tests: rejected → not stored; `shouldCache` false → returned, not stored; concurrent callers still coalesce.
2. For each route: define its allowlisted params, build the key, wrap the GitHub section.
3. Switch the AI routes to `shouldCache`. Remove the post-hoc `cacheDelete`.
4. Double-call test on a representative route using a mocked Octokit: expect one GitHub request.
5. Junk-parameter test: `?x=1` and `?x=2` resolve to the same key.
6. Static test: `src/app/api/github/**/route.ts` files without `withCache` must equal the allowlist `["create-issue", "rate-limit"]`.

## Success Criteria
- [x] Coverage, double-call and junk-param tests pass.
- [x] Partial results are cached for 30s only (`PARTIAL_TTL_SECONDS`; Thi's decision replaced "never"). <!-- Updated: implementation -->
- [x] Workflow-detail live polling still updates: `runs`/`run-details` send `max-age=15` with no SWR and use a 15s server TTL (verified via response headers; not clicked through in a browser). <!-- Updated: implementation -->

## Risk Assessment
- If a key misses a parameter that actually changes the output, the route serves wrong data. Mitigation: each route's allowlist is derived from the `searchParams.get` calls in its code, and the implementer checks each one during review.
- Memory stays bounded by `MAX_ENTRIES = 2000`.
