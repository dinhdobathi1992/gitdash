---
phase: 1
title: "Rate-limit telemetry + Cache-Control fix"
status: completed
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: Rate-limit telemetry + Cache-Control fix

## Overview
Show how much of the GitHub rate-limit budget each route uses. Fix response headers so browsers cache per-user responses for the right amount of time, without leaking one user's response to another user on a shared browser.

## Requirements
- Telemetry <!-- RT #15 --> <!-- Updated: implementation — route label via labelGitHubRoute() (AsyncLocalStorage) instead of a getOctokit option; see plan.md Implementation decisions -->:
  - Each GitHub-calling handler calls `labelGitHubRoute("<route>")` first; the Octokit hook reads the label via AsyncLocalStorage.
  - The request hook logs `route`, method, URL path, status, `x-ratelimit-remaining`, `x-ratelimit-resource` for **every** request, including GET, write and 304. Logging only happens when `GITDASH_GH_LOG=1`.
  - Telemetry runs before the existing non-GET early return in the hook.
  - The low-budget `console.warn` (remaining < 10% of limit) is always on, and fires once per token and rate-limit resource per reset window.
- Headers <!-- RT #6, #7, #15 -->:
  - Every `Cache-Control` in `src/app/api/**` except `demo` goes through `privateCacheHeaders(browserTtl, swr)`, which returns `{ "Cache-Control": "private, max-age=…, stale-while-revalidate=…", Vary: "Cookie" }`.
  - Browser TTL is chosen per route. It is **not** copied from the old `s-maxage` or server TTL:
    - Polled routes `runs` and `run-details`: `max-age ≤ 15`.
    - Flag-gated routes: `max-age ≤ 60`, so a revoke is visible within the ≤60s contract.
    - Others: keep their current value.
- Non-functional: logs carry only the token digest (`tokenKey`), never the token.

## Architecture
- Telemetry goes in the `octokit.hook.wrap("request", …)` in `getOctokit()` (`src/lib/github.ts`). Headers are read from the response, and from 304 errors, which also carry them.
- The Octokit instance cache key stays the token digest. The route label is passed per call through `options.request` metadata, so the instance-per-token cache is unchanged.
- Warning dedup: `Map<tokenKey, resetEpoch>`.
- New helper `src/lib/http-cache.ts` holds the header policy in one place.

## Related Code Files
- Modify: `src/lib/github.ts`
- Create: `src/lib/http-cache.ts`
- Modify: every `src/app/api/**/route.ts` that sets `Cache-Control` (17 `s-maxage` routes + 16 `private, max-age` routes, including `ai/*`, `contributor-profile`, `deployments`, `issues`, `security-alerts`, `rate-limit`, `ai/status`)
- Create: `tests/http-cache.test.ts` (unit + static scan), `tests/github-telemetry.test.ts`

## Implementation Steps
1. Read `node_modules/next/dist/docs/` notes on route-handler caching (Next 16.3).
2. Add `privateCacheHeaders()` with unit tests.
3. Replace every `Cache-Control` literal under `src/app/api/**` (except `demo`). Set the browser TTL per the requirements above.
4. Static test:
   - Scan `src/app/api/**/route.ts` and fail on any `Cache-Control` literal outside the helper.
   - Fail on any `s-maxage` (except `demo`).
   - Assert that the `runs` and `run-details` browser TTL is ≤ 15.
5. Add the `route` option to `getOctokit`. Thread it through the existing call sites mechanically: default to `"unknown"` and fill in the known routes.
6. Telemetry tests:
   - Remaining 100 of 5000 → exactly one warning; a second call → no warning.
   - A POST is logged.

## Success Criteria
- [x] Static header test passes.
- [x] Live polling on the workflow-detail page shows in-progress updates within 30s (manual, `pnpm dev`).
- [x] Telemetry tests pass. `pnpm test`, `pnpm lint` green.

## Risk Assessment
- `Vary: Cookie` reduces browser cache reuse after the cookie is resealed (it is resealed only on login). Acceptable.
- Threading the route label through the code touches many call sites. Mitigation: the parameter is optional with a default, so it is not a breaking change.
