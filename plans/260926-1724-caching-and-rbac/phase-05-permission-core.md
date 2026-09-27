---
phase: 5
title: "Permission core: resolver, registry, proxy enforcement"
status: completed
priority: P1
effort: "2d"
dependencies: [4]
---

# Phase 5: Permission core

## Overview
This phase resolves each user's groups and granted flags on the server. It classifies every route in one registry and enforces access centrally in the Next 16 proxy. Unclassified routes are denied by default. Enforcement is gated by `GITDASH_RBAC_ENFORCE` and applies in org mode only.

## Requirements
- **`resolveAccess(githubId)`** returns `{ groups, flags: Set<FlagKey>, isAdmin }`.
  - Groups are the user's `user_groups` rows, plus `admin` when the id is in `GITDASH_ADMIN_GITHUB_IDS`.
  - Flags: admins get all 14. Everyone else gets the union of `group_flags` for their groups.
  - Result is cached in memory as `perm:<id>` for 60s. Never in L2.
- **Failure policy** <!-- RT #5 -->:
  - A second in-process map keeps the last successful whoami and access result per id or token, for up to 10 minutes.
  - If the DB or GitHub fails, reuse that result. If there is none, return **503 `{code:"authz_unavailable"}`**.
  - Never redirect to `/login` on infra errors. Never allow a user whose groups are unknown.
- **Registry**: map `(pathPattern, method)` to one of `public | auth | base | flag:<key> | admin`.
  - `auth`: logged in, no group needed.
  - An API route missing from the registry is denied with 403. A page missing from it counts as `base`.
  - Public paths match on whole segments: `path === p || path.startsWith(p + "/")`. <!-- RT #14 -->
- **`decide(cls, access, enforce)`** is shared by the proxy and handler re-checks. <!-- RT #14 -->
  - `admin` routes are always enforced.
  - With `enforce=false`, everything else is allowed, so today's behaviour is kept.
  - With `enforce=true`, the full rules apply.
- **Proxy responses**:
  - Pages: no token → `/login`; no groups → `/pending`; forbidden → `/`.
  - APIs: 401 or 403 with JSON `{code:"no_groups"|"forbidden"|"unregistered"|"authz_unavailable", flag?}`.
- **Origin check** <!-- RT #12 -->: non-GET/HEAD requests to `/api/*`, except `/api/webhooks` and `/api/cron`, are rejected with 403 when `Origin` is missing or doesn't match the app origin.
- **Matcher** <!-- RT #14 -->: keep excluding static file extensions for non-API paths only. Every `/api/*` path goes through the proxy.
- **Handler re-check**: `create-issue`, all `settings/*`, `alerts` writes, `/api/db/sync` and all `/api/admin/*` call `requireAccess(req, cls)`. It runs the same whoami → resolve → `decide()` sequence.
- **Repo-scoped DB data** <!-- RT #8 -->: `/api/db/runs` and `/api/db/trends` first confirm the requester can see `owner/repo`, using a cached `repos.get` with the user's own token (`withCache`, not shared, 300s). A 404 or 403 from GitHub → 404.
- `users.last_seen_at` is updated at most once per 10 minutes per user.
- Standalone mode skips all of the above; behaviour is identical to today.

### Route classification
| Class | Routes |
|---|---|
| public | `/_next`, `/favicon`, `/docs`, `/api/webhooks`, `/api/health`, `/api/cron`, `/login`, `/api/auth/login`, `/api/auth/callback`, `/api/auth/setup` (unchanged from today, plus `setup` in org mode) |
| auth | `/pending`, `/api/auth/me`, `/api/auth/logout` |
| base | `/api/github/`: `repos, orgs, org-repos, org-overview, repo-overview, repo-summary, workflows, runs, run-details, deployments, issues, audit-log, contributor-profile, team-stats, repo-contributors, security-alerts, rate-limit`. Also `/api/db/runs`, `/api/db/trends` (repo-checked), `/api/ai/status`, `/api/demo`, `/demo` (auth required, same as today) |
| flag:dora | `/api/github/repo-dora` |
| flag:prLifecycle | `/api/github/open-pr-health` |
| flag:performanceTab | `/api/github/job-stats` |
| flag:busFactor | `/api/github/bus-factor` |
| flag:securityScan | `/api/github/security-scan`, page `/repos/*/*/security` |
| flag:costAnalytics | `/api/github/billing`, `/api/github/billing/cost-analysis`, page `/cost-analytics` |
| flag:runnerUtilization | `/api/github/runner-stats` |
| flag:healthScorecard | `/api/github/org-health-scorecard`, page `/org/*/health` |
| flag:workloadRisk | `/api/github/team-workload-risk` |
| flag:aiInsights | `/api/ai/insights`, `/api/ai/root-cause`, `/api/ai/anomaly-explanation` |
| flag:githubIssueFromAnomaly | `/api/github/create-issue` |
| admin | `/admin`, `/api/admin/*`, `/api/settings/ai`, `/api/settings/email`, `/api/settings/email/test`, `/api/alerts` (all methods, because `destination` holds webhook secrets <!-- RT #8 -->), `/api/alerts/test`, `/api/db/sync` <!-- RT #11 --> |
| UI-only | `reliabilityTab`, `anomalyDetection`, `reviewBottleneck`: gated only on the client (phase 7) |

## Architecture
- Single module `src/lib/permissions.ts` <!-- RT #14 -->. It holds `GROUPS`, `FLAG_KEYS` (derived from `Object.keys(DEFAULT_FLAGS)` in `src/lib/feature-flags.ts`), `REGISTRY`, `classify()`, `resolveAccess()`, `decide()` and `requireAccess()`.
- `src/proxy.ts` replaces `src/middleware.ts`. It keeps the HTTPS redirect and the standalone branch verbatim.

## Related Code Files
- Create: `src/lib/permissions.ts`
- Rename and modify: `src/middleware.ts` → `src/proxy.ts`
- Modify: `src/lib/db.ts` (`getUserGroups`, `getGroupFlags`, `touchLastSeen`)
- Modify: `src/app/api/github/create-issue/route.ts`, `src/app/api/settings/{ai,email}/route.ts`, `src/app/api/settings/email/test/route.ts`, `src/app/api/alerts/route.ts`, `src/app/api/alerts/test/route.ts`, `src/app/api/db/{sync,runs,trends}/route.ts`
- Tests: `tests/permissions.test.ts`, `tests/proxy-access.test.ts`

## Implementation Steps
1. Read the proxy docs in `node_modules/next/dist/docs/` for 16.3: file and export name, Node runtime, matcher, and whether the proxy can import `db.ts`, `cache.ts` and `crypto`. Record the findings in `reports/proxy-findings.md`. If an import is blocked, move enforcement to `requireAccess()` in every non-public handler, keeping the same `decide()`.
2. Implement `permissions.ts` and unit-test `classify()` for every table row, including the segment-match cases (`/docsX` is not public).
3. **Registry completeness test:**
   - Glob `src/app/api/**/route.ts` and read each exported HTTP method.
   - Assert every `(path, method)` is registered.
   - Assert every path matches the proxy `matcher`, including an `/api/.../x.svg` probe.
4. `resolveAccess()` tests on PGlite (phase 0):
   - A user with no groups gets nothing.
   - `dev` + `security` gets the union.
   - An env admin with no rows gets all flags.
   - A DB throw returns the last-known result, else `authz_unavailable`.
5. Build the proxy flow as in the `plan.md` diagram.
6. Add the handler re-checks and the repo-access check on `/api/db/*`.
7. Integration tests with `ENFORCE=true`:
   - `dev` without `costAnalytics` → 403 on billing.
   - Ungrouped → 403 `no_groups` on the API and `/pending` on `/`.
   - Unregistered route → 403.
   - Cross-origin POST → 403.
   - DB down with no cache → 503.
   - `pm` requests `/api/db/runs` for a repo their token can't see → 404.
   - Non-admin GET on `/api/alerts` → 403.
8. Integration test with `ENFORCE=false`: a grouped or ungrouped user reaches base and flag routes, and `/api/admin/*` still requires admin.
9. Standalone test: 200 everywhere, as today.

## Success Criteria
- [x] Registry and matcher completeness test is green, and fails when a dummy route is added.
- [x] 403/404/503 matrix tests are green for both `ENFORCE` values.
- [x] Revoke visible to new requests within 60s (TTL test with fake timers).
- [x] Standalone suite unchanged and green.

## Risk Assessment
- A proxy DB lookup adds latency. The 60s in-memory cache means about 1 DB read per user per minute per instance. Signal: p95 rises by more than 50ms → optimise the query. Raising the TTL above 60s breaks the contract and needs Thi's approval.
- A page missing from the registry defaults to `base`. That exposes only the UI shell, because all pages are client components and their data APIs still return 403.
