---
phase: 7
title: "Client flags = granted ∩ prefs, pending page, docs, helm"
status: completed
priority: P1
effort: "1.5d"
dependencies: [5]
---

# Phase 7: Client flags, pending page, docs, helm

## Overview
Make the UI match the server grants. Users see and toggle only the flags they've been granted, and ungrouped users land on a pending page. Hide admin-only controls from everyone else. Document the new org-mode setup.

## Requirements
- **`/api/auth/me`** returns `{ user, mode, groups, grantedFlags, isAdmin, enforce }`. Identity comes from `whoami`.
  - Standalone: `grantedFlags` = all flags, `groups = []`, `isAdmin = false`.
  - Org mode with `enforce=false`: `grantedFlags` = all flags.
- **SWR for `/me`** <!-- RT #6 -->: `dedupingInterval` ≤ 60s and `revalidateOnFocus: true` for this key (override the global setting in `src/lib/swr.tsx`). Revalidate `/me` after any 403 `forbidden`.
- **Effective flags in `FeatureFlagsProvider`:** a flag is on only when it is granted **and** the user's own preference is on. Preferences stay in the existing localStorage store.
  - In org mode, treat every flag as off until `/me` resolves. This avoids flashing ungranted UI and wasted API calls.
- **Settings → Feature Flags**
  - Granted flags toggle as they do today. Ungranted flags are hidden in org mode.
  - The counter reads "N of M granted enabled".
  - Enable-all and Disable-all act on granted flags only. `githubIssueFromAnomaly` stays excluded from bulk toggles.
- **Admin-only controls hidden for non-admins** <!-- RT #11 -->:
  - `AiProviderCard` and `EmailSettingsCard` on the settings page.
  - The sync button on `src/app/reports/page.tsx`, and the sync and alert-rule controls on the alerts page.
  - The alerts page shows "Admins manage alert rules" for non-admins.
- **UI-only flags:** `reliabilityTab`, `anomalyDetection` and `reviewBottleneck` are gated by the effective flag alone.
- **`/pending` page:** avatar and login, the text "Your account has no GitDash access yet. Ask an admin to add you to a group.", and a logout button. No other nav. Polls `/me` every 15s and redirects to `/` once the user has groups.
- **403 handling** <!-- RT #15 -->:
  - Extend `FetchError` in `src/lib/swr.tsx` with a `code` field parsed from the JSON body.
  - `no_groups` → `/pending`. `forbidden` → the existing error card with the text "Not granted". `authz_unavailable` → an error card reading "Permissions temporarily unavailable — retrying".
  - Apply the same handling to raw `fetch("/api…")` call sites: find them with `grep -rn 'fetch("/api' src` and route them through a shared helper.
- **Docs:**
  - `src/app/docs/page.tsx` and `README.md`: org mode requires `DATABASE_URL`; `GITDASH_ADMIN_GITHUB_IDS`; `GITDASH_RBAC_ENFORCE` and the rollout steps (deploy off → assign groups → enable); `GITDASH_ALLOWED_ORGS` and its required scopes (classic `read:org`, fine-grained "Members: read"); PAT login in org mode (recommend fine-grained, read-only); the groups and flags model; the pending flow; the ≤60s revocation contract; the L2 cache; `GITDASH_GH_LOG`.
  - `README-SECURITY-ENHANCEMENTS.md`: cached DTOs at rest, the scope of the permission model, the per-instance rate limiter.
  - `CHANGELOG.md`: a **breaking** entry because org mode now requires `DATABASE_URL`. Bump the version following the repo's convention.
- **Helm:** add `GITDASH_ADMIN_GITHUB_IDS`, `GITDASH_RBAC_ENFORCE` (default `"false"`) and `GITDASH_ALLOWED_ORGS` to `values.yaml`, `values.schema.json` and the deployment env. The schema requires `DATABASE_URL` and the admin ids when `mode=organization`.

## Architecture
- `src/components/AuthProvider.tsx` already fetches `/me`. Extend its context with `groups`, `grantedFlags`, `isAdmin` and `enforce`, and have `FeatureFlagsProvider` read from it instead of fetching again.
- `getServerSnapshot` stays pure: all flags off in org mode, `DEFAULT_FLAGS` in standalone. The server layout passes the mode as a prop.

## Related Code Files
- Modify: `src/app/api/auth/me/route.ts`, `src/components/{AuthProvider,FeatureFlagsProvider,AiProviderCard,EmailSettingsCard}.tsx`, `src/lib/feature-flags.ts`, `src/lib/swr.tsx`, `src/app/settings/page.tsx`, `src/app/reports/page.tsx`, `src/app/alerts/page.tsx`, the pages that use UI-only flags, and the raw-fetch call sites found by the grep
- Create: `src/app/pending/page.tsx`
- Modify: `src/app/docs/page.tsx`, `README.md`, `README-SECURITY-ENHANCEMENTS.md`, `CHANGELOG.md`, `package.json` (version), `helm/gitdash/{values.yaml,values.schema.json,templates/deployment.yaml}`
- Tests: extend `tests/settings-flag-bulk-toggle.test.ts`; add `tests/feature-flags-effective.test.ts` and `tests/fetch-error-code.test.ts`

## Implementation Steps
1. Extend `/me` and the SWR override.
2. Intersection logic in the provider, with tests covering both "granted but preference off" and "preference on but not granted".
3. Settings page filtering and bulk actions; hide admin-only cards and controls.
4. Pending page and polling. `FetchError.code` and the shared fetch helper.
5. Docs, helm and the changelog.

## Success Criteria
- [x] An ungranted flag never renders and never triggers its API call (provider test plus one page test).
- [x] A user can disable a granted flag, and the setting persists across reloads.
- [x] An ungrouped user sees only `/pending`, which moves to `/` within ~60s of a grant.
- [x] A non-admin's Settings, Reports and Alerts pages show no 403 error cards.
- [x] The standalone settings page is identical to today.
- [x] `pnpm lint && pnpm test && pnpm build` green; `helm lint helm/gitdash` green.

## Risk Assessment
- A hydration mismatch can occur if the server and client snapshots differ. Mitigation: the org-mode server snapshot is all flags off, and the client resolves after `/me`.
- Flags a user already disabled in localStorage stay disabled after the upgrade. This is intended, because preferences narrow grants.
