---
phase: 4
title: "Identity, org-mode PAT login, allowed orgs, RBAC tables (migration v9)"
status: completed
priority: P1
effort: "1.5d"
dependencies: [0, 3]
---

# Phase 4: Identity, org-mode PAT login, allowed orgs, RBAC tables

## Overview
A user's identity is the numeric GitHub id of **the token actually in use**. Org mode accepts a PAT alongside OAuth. Logins can be restricted to members of the allowed orgs. Every allowed login is recorded in `users`. Migration v9 creates all four RBAC tables.

## Requirements
- **One credential per session** <!-- RT #2 -->:
  - Both login paths (`/api/auth/callback`, `/api/auth/setup`) call `session.destroy()` first. They then write a fresh session with exactly one of `accessToken` (OAuth) or `pat` (PAT), plus `user` (display only).
  - `getTokenFromSession()` in org mode returns `accessToken ?? pat`. After this change only one of them can be set.
- **Identity via whoami** <!-- RT #2, #6 -->:
  - `whoami(token)` = `GET /user` → `{ id, login, avatar_url }`, cached L1 only as `whoami:<digest>` for **60s** (never L2).
  - Allowed-orgs membership is included in the same cached result.
  - Identity is always taken from `whoami`, never from the cookie. Legacy cookies without a stored id need no migration.
- **Allowed orgs:** `GITDASH_ALLOWED_ORGS` (comma list).
  - At login and inside `whoami`, call `orgs.getMembershipForAuthenticatedUser({ org })` for each org. Allowed if any returns `state: "active"`.
  - A 403 or 404 counts as not a member. The login error says: "Account is not a member of an allowed organization, or the token lacks read:org / Members:read".
  - Unset → no restriction and a boot warning.
  - Non-members never get a `users` row.
- **PAT in org mode:** `/api/auth/setup` accepts org mode. It keeps the IP rate limit.
- **Login CSRF** <!-- RT #2 -->: `setup` requires `Content-Type: application/json` and an `Origin` equal to the app origin (`publicUrl`); otherwise 403.
- **Users table:** on an allowed org-mode login (both paths), upsert `users(github_id, login, avatar_url, last_seen_at)`.
- **Pending pruning** <!-- RT #15 -->: users with no groups and `last_seen_at` older than 30 days are deleted by the cron route and by sampled cleanup. The audit log keeps history.
- **Startup validation** <!-- RT #4, #5 -->: in org mode, fail loudly (the same pattern as `SESSION_SECRET` in `src/lib/session.ts`) when:
  - `DATABASE_URL` is missing, or
  - `GITDASH_ADMIN_GITHUB_IDS` doesn't parse to ≥1 positive integer.
- Standalone: unchanged, except the session regeneration on login.

## Architecture
- Migration v9 creates `users`, `user_groups`, `group_flags` and `permission_audit` (DDL in `plan.md`, `IF NOT EXISTS`, advisory-locked).
- New `src/lib/identity.ts`: `whoami(token)`, `checkAllowedOrgs(octokit)`, `parseAdminIds()`, `assertOrgModeConfig()`.
- `src/lib/url.ts` `publicUrl` supplies the origin for the Origin check.
- The login page gets a PAT form. It reuses markup from `src/app/setup/page.tsx`, extracted into `src/components/PatForm.tsx`.
- In org mode, `/api/auth/setup` becomes public in `middleware.ts` (renamed to `proxy.ts` in phase 5). The `/setup` page still redirects to `/login`.

## Related Code Files
- Modify: `src/lib/session.ts`, `src/app/api/auth/{callback,setup,me}/route.ts`, `src/middleware.ts`, `src/app/login/page.tsx`, `src/app/setup/page.tsx`, `src/lib/db.ts` (v9, `upsertUser`, `pruneStalePendingUsers`), `src/app/api/cron/sync/route.ts`
- Create: `src/lib/identity.ts`, `src/components/PatForm.tsx`
- Tests: `tests/auth-identity.test.ts`

## Implementation Steps
0. **Back up the local DB** (`pg_dump` from the Docker Postgres to `~/gitdash-backups/`) before the first v9 run.
1. Add migration v9, `upsertUser` and the prune helpers.
2. `identity.ts`, with tests for:
   - `whoami` caching (60s).
   - Allowed-org decisions: active, pending, 404, 403, unset.
   - Admin id parsing: `"123, 456"` ok; `"thi"` fails; `""` fails.
3. Session regeneration in both login paths. Origin and Content-Type checks on `setup`.
4. Allowed-orgs gate in both login paths, before `upsertUser`.
5. PAT form on `/login`.
6. `assertOrgModeConfig()` called from the module scope used by the proxy and by `/api/auth/*`.
7. Tests:
   - OAuth then PAT on the same browser for accounts A then B → session holds only B's PAT, and whoami resolves B.
   - OAuth and PAT for the same account → one `users` row.
   - A non-member → rejected, no row.
   - A cross-origin POST to `setup` → 403.

## Success Criteria
- [x] Token and identity always belong to the same account (test).
- [x] Legacy cookies keep working (identity from whoami).
- [x] Allowed-orgs gate enforced at login and within 60s after an org membership is removed.
- [x] Standalone tests pass unchanged.

## Risk Assessment
- The allowed-orgs check needs the `read:org` scope. OAuth already requests it (`src/app/api/auth/login/route.ts`). PAT users must grant it; docs cover this in phase 7. Signal: valid members rejected → the error text names the missing scope.
- The rate limiter is per-instance (`src/lib/ratelimit.ts`). Accepted risk, documented. Allowed-orgs removes most of the abuse value.
