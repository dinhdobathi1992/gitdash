# Phases 4–7 evidence — 2026-09-27 (RBAC)

Local only. Nothing committed or pushed. Browser tests in Chrome (Claude in Chrome) against
`http://127.0.0.1:3100` (dev server, org mode, local Docker Postgres). The PAT was pasted via the
macOS clipboard (piped from `.env`, cleared after each use) — never typed into a tool call.

Why 127.0.0.1: my production-mode checkpoint test on :3100 answered with the app's HTTPS `301`, which
browsers cache permanently for `localhost:3100`. `allowedDevOrigins: ["127.0.0.1"]` (next.config,
dev-only) + `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100` avoid it. To use `localhost` again, clear
"Cached images and files" for the last few hours in the browser.

## Phase 4 — identity, PAT login in org mode, allowed orgs, users table (v9)
| Check (Chrome unless noted) | Result |
|---|---|
| `/login` shows OAuth button + new PAT form | ✓ |
| PAT sign-in, `GITDASH_ALLOWED_ORGS=<personal-org>` | refused 403 — correct: GitHub itself refuses the membership check (`<personal-org>` forbids classic PATs with lifetime > 366 days). Reason now logged server-side |
| PAT sign-in, `GITDASH_ALLOWED_ORGS=<company-org>` | 200 → dashboard; `users` row `<admin-github-id> dinhdobathi1992` |
| `/api/auth/me` | identity from GitHub (numeric id) |
| cross-origin / missing-Origin POST to `/api/auth/setup` (curl) | 403 / 403 |
| `/setup` in org mode (curl) | 307 → `/login` |
| Local DB backup before v9 | `~/gitdash-backups/gitdash-local-20260927-0911-pre-v9.sql` |

## Phase 5 — permission core (`src/proxy.ts`, `src/lib/permissions.ts`)
Enforcement on, me not admin (`GITDASH_ADMIN_GITHUB_IDS=1`):
| Check | Result |
|---|---|
| No group: `/` | → `/pending` |
| No group: `/api/github/repos` | 403 `no_groups` |
| `/api/admin/users`, `/api/alerts` (pre-fix: admin-only) | 403 `forbidden` |
| Grant dev + dora (SQL), wait > 60s | `/` loads; `repos` 200; `repo-dora` 200; `billing` 403 `{flag: costAnalytics}`; `/cost-analytics` page → `/` |
| `/api/db/runs` hidden repo / own repo / foreign-org trends | 404 / 200 / 404 |
| Revoke dora, wait > 60s | `repo-dora` 403 |

## Phase 6 — admin API + UI (`/admin`)
Me as bootstrap admin, second user `test-user-b` seeded:
| Check | Result |
|---|---|
| Users tab | me with locked `admin` chip; `test-user-b` marked pending |
| Click `dev` for test-user-b | chip on, pending gone, toast "applies within 60s"; DB `555000111|dev` |
| Permissions tab: toggle DORA × dev | on; admin column locked; DB `dev|dora` |
| Audit tab | both changes with actor, before → after; one audit row each |
| Concurrent cross-demotion (real Postgres, Neon driver) | exactly one succeeds; 1 admin remains |

## Phase 7 — client flags, pending, nav, docs, helm (final end-to-end in Chrome)
| Scenario | Result |
|---|---|
| **A** admin (bootstrap), enforcement on | `/me` isAdmin, 14 flags; Settings "13 of 14 granted enabled" (write flag off by default); AI + Email cards; nav shows Admin + Cost |
| **B** non-admin, group dev, grant dora only | Settings "1 of 1 granted enabled" (DORA only); AI/Email cards hidden; nav has no Admin, no Cost; `/api/admin/users` 403; alerts readable (200); repo page makes 9 API calls, all 200 — `repo-dora` fetched, `open-pr-health` and `ai/insights` never requested; alerts page shows "Admins manage alert rules", no create form, no edit/delete buttons |
| **C** group removed | after the 60s cache: `/` → `/pending` (full-page, no nav, avatar, "Waiting for access"); group granted again with the tab untouched → tab moved itself to the dashboard |
| **D** enforcement off, ungrouped non-admin | today's access: 14 flags granted, Cost in nav, `repo-dora` 200; admin API still 403, no Admin nav |
| helm lint | standalone ✓; org + integer/comma ids ✓; org without ids ✗ (schema); login instead of id ✗ (schema); renders `GITDASH_*` + `DATABASE_URL` |

## Reviews
1. Phases 4–5: REQUEST_CHANGES, no bypass found (encoded paths, traversal, matcher, session reset, CSRF all held). Fixed: H1 (alerts readable with destinations redacted for non-admins — my call while Thi was away), H2 (boot-time config check + health 503), M1–M5, L2–L5, L7.
2. Final review (all phases): REQUEST_CHANGES → fixed:
   - **H-A** root layout is prerendered at build, so a server `mode` prop froze at build time → mode now comes from `/api/auth/me` (`AuthProvider.resolvedMode`); flags stay empty until it resolves.
   - **H-B** `/me` returned 401 on any failure → client reload loop during GitHub/DB outages. Now 401 only when GitHub rejects the token, 403 outside allowed orgs, 503 `authz_unavailable` otherwise.
   - **M1** non-admins saw every alert rule/event → filtered by the viewer's own GitHub visibility (repo/org/global; lookup failure hides the item), destinations redacted.
   - **M2** proxy touched the DB with enforcement off → only admin routes need it then.
   - **M3** helm `adminGithubIds` must be a quoted string; `rbacEnforce` rendered via `toString | quote`.
   - **M4** real-Postgres test refuses any DB not named `*_test`.
   - L1 READ COMMITTED on grant/group transactions · L2 github id bound (≤15 digits, safe int) · L4 health 503 message generic · L5 logout 303.
   - Not fixed (noted): L3 admin UI paging/debounce, L6, L8; **L7** cost-analytics page still fetches without checking `flags.costAnalytics` — the proxy already redirects the page and 403s the API, and the file is being rewritten by the concurrent UI agent.

## Post-fix re-verification (2026-09-27 ~09:50)
| Check | Result |
|---|---|
| `pnpm test` | 44 files, **531 passed**, 2 skipped |
| `tsc --noEmit`, `pnpm lint` | clean (excluding the concurrent UI agent's in-progress `src/app/page.tsx` / workflow page) |
| Chrome, admin (enforce on) | `/me` 200 admin, 14 flags; Admin + Cost in nav; `/api/admin/users` 200 |
| Chrome, non-admin `dev` + `dora` | `/me` groups `[dev]`, flags `[dora]`; nav without Admin/Cost; admin API 403; billing 403 |
| Alerts filter (2 seeded rules: own org + unreachable repo) | only own-org rule returned, `destination: null`; seed rows deleted afterwards |

## Found, not mine
`/alerts` page crashes (`v.toFixed is not a function`) as soon as any rule exists: `src/lib/alert-copy.ts:66` (untracked, UI-redesign agent) calls `.toFixed` on `threshold`, which Postgres `numeric` returns as a string. Fix: `const n = Number(v)` before formatting. Affects admins too; unrelated to RBAC.
