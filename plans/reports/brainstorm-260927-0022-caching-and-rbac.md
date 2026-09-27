---
type: brainstorm
date: 2026-09-27
status: accepted
branch: dinhdobathi1992/new-update
---

# Brainstorm — GitHub API caching + group-based feature permissions

## Summary
Two phases. (1) Cut GitHub API spend: fill in-process cache gaps, fix broken Cache-Control headers, add rate-limit telemetry, then add a Postgres-backed shared cache layer (L2) so replicas share hits. (2) Org-mode RBAC: users (OAuth or PAT login) resolve by numeric GitHub id to fixed groups; admin grants existing feature flags per group; server enforces. Standalone mode unchanged.

## Evidence (current state)
- All caches in-process `Map`s: ETag store `src/lib/github.ts`, `withCache` `src/lib/cache.ts`, limiter `src/lib/ratelimit.ts`. Not shared across helm `replicaCount: 2` / Vercel instances.
- `withCache` used by 11/29 `/api/github/*` routes. Uncached heavy ones: contributor-profile (7 calls), open-pr-health (4), billing (3), job-stats, repo-contributors, etc.
- ~12 routes send `private, s-maxage=…` → `private` excludes shared caches, `s-maxage` only applies to shared caches → no effective HTTP caching.
- Cache keys already scoped per token hash (correct; must stay).
- Org callback `src/app/api/auth/callback/route.ts` already resolves user via `users.getAuthenticated()`; session stores `login` but not numeric `id`.
- Org OAuth uses `allow_signup: "true"`, no allowlist → any GitHub account can log in today.
- Feature flags `src/lib/feature-flags.ts` are localStorage-only (14 keys); API routes are not gated server-side.

## Contract

### Outcome
1. Per-route/per-token GitHub rate-limit usage visible in logs; uncached heavy routes cached; Cache-Control headers correct.
2. Postgres L2 cache shared across replicas behind `withCache` (and ETag store), falling through to GitHub on DB error.
3. Org mode login via OAuth **or** PAT; both keyed on numeric GitHub id.
4. Fixed groups: `devops`, `security`, `dev`, `pm`, `admin`. User may belong to several; effective flags = union.
5. Admin UI: group × flag matrix; user list with group assignment; audit log of grants/revokes/assignments.
6. Server-enforced: flagged API routes return 403 when not granted. Users with no group see only an "Access pending" page (no base dashboard).
7. Users may turn OFF granted flags (existing localStorage prefs); cannot turn ON ungranted ones.
8. Bootstrap admin from `GITDASH_ADMIN_GITHUB_IDS`.

### Constraints
- Org mode only; requires `DATABASE_URL`. Standalone: no DB, no RBAC, flags stay personal.
- Versioned migration in `src/lib/db.ts` (next = v8). Back up DB before migrating.
- PAT/OAuth token stays in iron-session cookie; never stored in DB.
- Groups not stored in the 7-day cookie; resolved server-side with ≤60s cache.
- Identity = numeric GitHub `id` (logins are renameable).
- pnpm; no new infra (no Redis).

### Non-goals
- RBAC in standalone mode.
- Custom/admin-created groups (fixed this iteration).
- GitHub Teams sync, per-repo ACLs, SSO/OIDC.
- Restricting what a user's own token can do on GitHub — RBAC gates GitDash surfaces, not GitHub access.

### Acceptance criteria
- Logs show `x-ratelimit-remaining` per route; repeat `org-overview` load across 2 instances → L2 hit, 0 extra GitHub calls.
- Every `/api/*` route is either flag-mapped or explicitly marked base/public — unit test fails otherwise.
- `dev` user without `costAnalytics`: `curl /api/github/billing` → 403.
- New user first login → row auto-created, pending page shown, appears in admin user list.
- Grant/revoke takes effect ≤60s; each change written to audit log (actor, target, change, timestamp).
- Same person via OAuth and via PAT resolves to same groups.
- Standalone mode behavior unchanged (existing tests pass).

## Options considered
- Caching: A fill gaps (chosen, phase 1) → B Postgres L2 (chosen, phase 2) ; C Redis (rejected: new infra, no evidence Postgres is too slow).
- Role source: DB (chosen) vs GitHub Teams vs hybrid.
- Login: A org OAuth+PAT (chosen) ; B OAuth only (fails under org OAuth app restrictions) ; C merge modes (breaking env/helm churn).

## Proposed data model (v8)
- `users(github_id PK, login, avatar_url, first_seen_at, last_seen_at)`
- `user_groups(github_id FK, group_name CHECK in fixed set, PK both)`
- `group_flags(group_name, flag_key, PK both)`
- `permission_audit(id, actor_github_id, action, target, details jsonb, created_at)`

## Flag → route mapping (to verify in plan)
dora→repo-dora · prLifecycle→open-pr-health · busFactor→bus-factor · securityScan→security-scan · costAnalytics→billing, billing/cost-analysis · runnerUtilization→runner-stats · healthScorecard→org-health-scorecard · workloadRisk→team-workload-risk · aiInsights/anomalyDetection→api/ai/* · githubIssueFromAnomaly→create-issue · performanceTab/reliabilityTab/reviewBottleneck → confirm in scout. Unflagged routes (repos, runs, workflows, org-overview, …) = base (any grouped user).

## Unresolved questions
- Exact mapping for performanceTab / reliabilityTab / reviewBottleneck / anomalyDetection (shared routes like job-stats may need sub-feature gating rather than route gating).
- `admin` group: implicitly all flags, or also subject to the matrix? (Assume all flags.)
