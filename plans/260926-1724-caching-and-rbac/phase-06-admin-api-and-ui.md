---
phase: 6
title: "Admin API + UI (users, permission matrix, audit log)"
status: completed
priority: P1
effort: "1.5d"
dependencies: [5]
---

# Phase 6: Admin API + UI

## Overview
One admin page to assign users to groups, grant flags per group, and review an audit trail. Each change and its audit row are written by one SQL statement, and the admin guards run inside that statement.

## Requirements
- **API** (`admin` class, plus an in-handler `requireAccess`, plus the proxy Origin check):
  - `GET /api/admin/users?q=&group=&cursor=`: users with their groups, `first_seen_at`, `last_seen_at` and `isBootstrapAdmin`. Pending users (no groups) come first. Keyset pagination.
  - `PUT /api/admin/users/[githubId]/groups` with body `{ groups: Group[] }`: replaces the user's membership. Returns 400 when removing `admin` from a bootstrap admin, or when the change would leave zero DB admins and no bootstrap admins.
  - `GET /api/admin/permissions`: returns `{ groups, flags: FlagMeta[], grants: Record<Group, FlagKey[]>, enforce: boolean }`.
  - `PUT /api/admin/permissions` with body `{ group, flag, granted }`: toggles one cell. `group = admin` is rejected.
  - `GET /api/admin/audit?cursor=&limit=50`: newest first, keyset pagination on `id`.
- **Atomic mutations** <!-- RT #12 -->. Each mutation is **one CTE statement**:
  - The data change uses `RETURNING` to capture before and after.
  - The `permission_audit` insert reads from that `RETURNING` output.
  - The admin-count guard sits in the `WHERE` clause, e.g. `… WHERE NOT (group_name = 'admin' AND (SELECT count(*) FROM user_groups WHERE group_name='admin') <= 1 AND <no bootstrap admins>)`.
  - Zero affected rows means the guard blocked the change, and the API returns 409.
  - No read-then-write across statements.
- **Audit** `action` values: `group_grant`, `group_revoke`, `user_groups_set`. `details` holds `{ before, after }`. `actor_github_id` comes from `whoami`, not the cookie.
- **Validation:** inputs are checked against `GROUPS` and `FLAG_KEYS`. Unknown values return 400.
- **UI `/admin`** (admin class), three tabs:
  - **Users:** search box and a table with avatar, login, groups as toggle chips, last seen, and a "pending" badge. Pending users are listed first. Bootstrap admins show a lock icon.
  - **Permissions:** matrix with flags as rows and groups as columns. The `admin` column is locked on. Write-capable flags (`githubIssueFromAnomaly`) are marked. A banner shows "Enforcement OFF — changes take effect when `GITDASH_RBAC_ENFORCE=true`" while enforcement is off.
  - **Audit:** table of time, actor, action, target and before→after, with "Load more".
- **Nav:** an "Admin" entry appears only when `/api/auth/me` returns `isAdmin`. Add it in `src/components/Sidebar.tsx`, `src/components/shell/nav-config.ts` and `src/components/CommandPalette.tsx`. <!-- RT #15 -->
- Mutations show a toast: "Applies to new requests within 60s".

## Architecture
- Route handlers live under `src/app/api/admin/**`.
- DB helpers in `src/lib/db.ts` (`listUsers`, `setUserGroups`, `listGrants`, `setGrant`, `listAudit`) own the CTE and its audit row, so a route cannot skip auditing.
- The UI is a client page using SWR with an optimistic toggle that rolls back on error. It follows the settings page's card and toggle styles.

## Related Code Files
- Create: `src/app/api/admin/users/route.ts`, `src/app/api/admin/users/[githubId]/groups/route.ts`, `src/app/api/admin/permissions/route.ts`, `src/app/api/admin/audit/route.ts`
- Create: `src/app/admin/page.tsx`, and components under `src/components/admin/` if the page grows past ~300 lines
- Modify: `src/lib/db.ts`, `src/components/Sidebar.tsx`, `src/components/shell/nav-config.ts`, `src/components/CommandPalette.tsx`
- Tests: `tests/api-admin.test.ts` (PGlite via phase 0)

## Implementation Steps
1. Write the CTE helpers and their tests:
   - Each mutation writes exactly one audit row, with correct before and after.
   - A blocked guard writes no audit row.
2. Concurrency test: two admins remove each other in parallel (`Promise.all`). At least one admin remains.
3. API routes, validation and `requireAccess`. Tests: a non-admin gets 403, and a cross-origin PUT gets 403.
4. UI tabs and nav entries.
5. Manual end-to-end on `pnpm dev` in org mode with a local `DATABASE_URL`:
   - The bootstrap admin grants `dev` → `dora`.
   - `ENFORCE` is set to true.
   - A second user logging in with a PAT moves from `/pending` to the dashboard within 60s.
   - Save a screenshot to `reports/`.

## Success Criteria
- [x] All admin API tests pass, including the concurrency test.
- [x] The manual end-to-end flow works, with a screenshot in `reports/`.
- [x] The Audit tab shows every change with before and after.

## Risk Assessment
- The CTE statements are complex. Mitigation: one helper per mutation, and each helper is covered by the PGlite tests.
- Admin self-lockout is prevented by the guards in the SQL statement, and bootstrap admins from the env var cannot be removed.

## Note from the UI redesign (2026-09-27)
<!-- Updated: design contract implementation — design/DESIGN-CONTRACT.md §9 puts admin UI in Settings -->
The redesign (`design/`) places the admin surfaces in **Settings**: `/settings?section=access` (group × feature matrix + waiting-for-access queue), `?section=members`, `?section=audit`. They call this phase's `/api/admin/*` endpoints via `src/components/settings/admin-api.ts`. `/admin` still exists and duplicates them; decide whether to keep it or point the "Admin" nav item at Settings.
