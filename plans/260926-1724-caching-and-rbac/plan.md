---
title: "GitDash — API caching hardening + org-mode group permissions"
description: "Cut GitHub API spend (telemetry, header fixes, withCache coverage, opt-in Postgres L2), then replace browser-only feature flags with server-enforced, admin-granted group permissions in organization mode."
status: completed
priority: P1
effort: "9.5-11.5d"
tags: [gitdash, caching, rate-limit, rbac, auth, feature-flags, security]
blockedBy: []
blocks: []
created: 2026-09-27
---

# GitDash — API caching hardening + org-mode group permissions

## Overview

Source contract: `plans/reports/brainstorm-260927-0022-caching-and-rbac.md` (accepted). Red-teamed 2026-09-27 (see bottom).

Caching goes first; the permission lookup reuses the cache layer.

**Caching.** Every cache is a per-process `Map`: the ETag store in `src/lib/github.ts` and `withCache` in `src/lib/cache.ts`. Helm runs 2 replicas and Vercel runs many instances, so hits are not shared between them. Only **8 of 28** `/api/github/*` routes use `withCache`. **17** routes send `private, s-maxage=…`, which gives them no effective HTTP caching.

**Permissions.** Feature flags live only in `localStorage` (`src/lib/feature-flags.ts`), and no API route checks them. Org-mode OAuth accepts any GitHub account (`allow_signup: "true"`, no allowlist). This plan turns flags into server-enforced permissions that an admin grants per fixed group, keyed on the numeric GitHub id. It applies to organization mode only; standalone mode is unchanged.

## Delivery constraint — local only (Thi, 2026-09-27)

- **No git commit, no push, no PR, no Vercel deploy.** All changes stay as uncommitted edits in this worktree.
- **Run everything locally:** `pnpm dev`, `pnpm test`, plus Docker Postgres and the local Neon HTTP proxy. The only remote access is the **read-only** `vercel link` + `vercel env pull` in phase 0, plus normal GitHub API reads made by the app.
- **No writes to remote systems:** not to production Neon, not to Vercel env/settings, and not to GitHub. The `create-issue` path is tested with mocks only.
- Evidence that would have gone into a PR (proxy findings, test output, screenshots) goes to `plans/260926-1724-caching-and-rbac/reports/` and the daily note instead.

## Implementation decisions (2026-09-27, phases 0–3)

<!-- Updated: implementation — decisions taken during cook, confirmed by Thi where marked -->
| Topic | Decision |
|---|---|
| Refresh buttons (Thi) | Refresh/post-sync reloads bypass both caches: `requestFresh()` in `src/lib/swr.tsx` sends `?refresh=1` + `cache: "no-store"`; routes pass `refresh: wantsFresh(req)` to `withCache` |
| Partial results (Thi) | Cached for `PARTIAL_TTL_SECONDS` = 30s (not never, not full TTL) via `withCache` `ttlFor` / `partialAwareTtl()` |
| Browser cache for former `s-maxage` routes | `max-age=0` — they were never browser-cached before; copying `s-maxage` into `max-age` broke Refresh (review H1) |
| Route telemetry label | `labelGitHubRoute()` (AsyncLocalStorage) at the top of each handler, not a `getOctokit(token, { route })` parameter |
| L2 enablement | `isL2Enabled()` = `DATABASE_URL` set (any mode). Plan said org-mode only; standalone without a DB still never touches one. Needed to verify L2 locally in standalone mode |
| `cacheDelete*` and L2 | Stay L1-only (sync API unchanged). Shared entries are replaced by refresh or expire by TTL; no caller deletes shared keys |
| `NEON_LOCAL_FETCH_ENDPOINT` | Honoured whenever set, loopback hosts only (no `NODE_ENV` gate) so a local `next start` uses the Docker DB. Never set in real deployments |
| Local ports | GitDash on 3100 (second instance 3101); 3000 belongs to another local project |

## Decisions (accepted)

| Topic | Decision |
|---|---|
| Role source | GitDash Postgres, org mode only. Org mode now **requires** `DATABASE_URL`: the app fails loudly at startup without it |
| Groups | Fixed: `devops`, `security`, `dev`, `pm`, `admin`. A user can be in several groups and gets the union of their flags |
| Identity | Numeric GitHub `id` from `GET /user` using **the token actually in use** (the `whoami` lookup, cached 60s in memory). Never taken from the cookie's `login` or its stored id |
| Login (org mode) | GitHub OAuth **or** PAT. Every login regenerates the session so it holds exactly one credential. The token stays in the iron-session cookie and never goes to the DB |
| Login scope | `GITDASH_ALLOWED_ORGS` (comma list). Only active members of these orgs can log in; membership is re-checked with `whoami`. If unset: no restriction, plus a warning at boot |
| Ungrouped user | Sees nothing: `/pending` page, and the API returns 403 `no_groups` (when enforcement is on) |
| Rollout | `GITDASH_RBAC_ENFORCE` defaults to **off**. When off, users are recorded, the admin UI works, and everyone keeps today's access. The admin turns it on after assigning groups |
| Flags | The 14 existing `FeatureFlags` keys become permissions, granted per group by an admin. Users may turn **off** granted flags (localStorage), never turn on ungranted ones. No pre-seeded grants |
| `admin` group | Gets all flags plus `/admin` implicitly. Its matrix column is locked on |
| Bootstrap | `GITDASH_ADMIN_GITHUB_IDS` (numeric ids). Must parse to ≥1 positive integer when org mode is enabled, or the app fails at startup. These admins cannot be removed in the UI |
| Audit | Every grant, revoke and membership change is written in the **same SQL statement** as the change |
| Enforcement point | Central `proxy.ts` (Next 16 replacement for `middleware.ts`, Node runtime). Route registry, deny by default. Write and admin routes re-check in the handler through the same `decide()` |
| Failure policy | If the DB or GitHub is unavailable, reuse the last known identity and permissions for up to 10 min. With nothing to reuse, return **503 `authz_unavailable`**. Never redirect to `/login`, never fail open |
| Revocation contract | New requests see the change within **≤60s** (TTL only; proxy and handlers don't share memory). Browser-cached responses on flagged routes live ≤60s |
| L2 cache | Opt-in per call (`{ shared: true }`), used only by `/api/github/*` DTO routes. Never used for settings or secrets |
| ETag store | Stays in-process. A DB round trip per GitHub GET would cost more than the 304 saves (confirmed by Thi) |

## Phases

| # | Phase | Priority | Effort | Depends on | Status |
|---|-------|----------|--------|------------|--------|
| 0 | [Local env from Vercel + test harness + safe migrations](./phase-00-test-harness.md) | P1 | 1d | — | Pending |
| 1 | [Rate-limit telemetry + Cache-Control fix](./phase-01-telemetry-and-headers.md) | P1 | 0.5d | — | Pending |
| 2 | [withCache coverage for uncached routes](./phase-02-withcache-coverage.md) | P1 | 1d | 1 | Pending |
| 3 | [Opt-in Postgres L2 cache (migration v8)](./phase-03-postgres-l2-cache.md) | P1 | 1d | 0, 2 | Pending |
| 4 | [Identity, org-mode PAT login, allowed orgs, RBAC tables (migration v9)](./phase-04-identity-and-pat-login.md) | P1 | 1.5d | 0, 3 | Pending |
| 5 | [Permission core: resolver, registry, proxy enforcement](./phase-05-permission-core.md) | P1 | 2d | 4 | Pending |
| 6 | [Admin API + UI (users, matrix, audit)](./phase-06-admin-api-and-ui.md) | P1 | 1.5d | 5 | Pending |
| 7 | [Client flags = granted ∩ prefs, pending page, docs, helm](./phase-07-client-flags-pending-docs.md) | P1 | 1.5d | 5 | Pending |

**Start with phase 0, Part A.** It pulls Environment Variables from the Vercel project `<vercel-team>/gitdash` (`<vercel-project-id>`) into a git-ignored `.env`, so the app runs locally with real configuration. Locally the DB is a **local Docker Postgres fronted by a local Neon HTTP proxy**. `neonConfig.fetchEndpoint` points at `localhost` in dev only, so the production Neon driver code path runs unchanged. The production `DATABASE_URL` pulled from Vercel is removed from `.env`, so nothing can write to it by accident. PGlite is used only for unit tests <!-- Updated: Validation Session 1 - local DB = Docker Postgres + Neon HTTP proxy -->. Secret values are never printed.

After Part A, phase 0 Part B and phase 1 are independent.

**Execution checkpoint:** run phases 0–3 (env, harness, caching), then **stop for Thi's review** of the local caching results before starting the RBAC phases 4–7. <!-- Updated: Validation Session 1 - checkpoint after phase 3 --> Phases 6 and 7 are independent after 5. **Phases 4–7 ship in one release**, with `GITDASH_RBAC_ENFORCE=false`.

## Data model (migrations in `src/lib/db.ts`)

All DDL uses `IF NOT EXISTS`. `ensureSchema()` runs each migration inside `pg_advisory_xact_lock` in one `db.transaction([...])` (phase 0).

```sql
-- v8 (phase 3): shared cache
CREATE TABLE IF NOT EXISTS api_cache (key TEXT PRIMARY KEY, value JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at);

-- v9 (phase 4): permissions
CREATE TABLE IF NOT EXISTS users (github_id BIGINT PRIMARY KEY, login VARCHAR(100) NOT NULL, avatar_url TEXT,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(), last_seen_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS user_groups (github_id BIGINT REFERENCES users ON DELETE CASCADE,
  group_name VARCHAR(20) CHECK (group_name IN ('devops','security','dev','pm','admin')),
  PRIMARY KEY (github_id, group_name));
CREATE TABLE IF NOT EXISTS group_flags (group_name VARCHAR(20) CHECK (group_name IN ('devops','security','dev','pm')),
  flag_key VARCHAR(50) NOT NULL, PRIMARY KEY (group_name, flag_key));
CREATE TABLE IF NOT EXISTS permission_audit (id BIGSERIAL PRIMARY KEY, actor_github_id BIGINT NOT NULL,
  action VARCHAR(40) NOT NULL, target TEXT NOT NULL, details JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_perm_audit_created ON permission_audit(created_at DESC);
```

In this delivery v8/v9 run **only against the local Docker Postgres** (back it up with `pg_dump` to `~/gitdash-backups/`, outside the repo, before each migration run). Production Neon is never migrated. Before any future deploy (out of scope here), back up production (Neon branch or `pg_dump`) and apply the migrations.

## Request flow (org mode, after phase 5)

```
request → proxy.ts (Node runtime)
  ├─ public route (segment match) ─────────────────→ next()
  ├─ non-GET with foreign Origin ──────────────────→ 403
  ├─ unseal cookie → token? no ─────────────────────→ /login (page) | 401 (api)
  ├─ whoami(token) [L1 60s: id, login, allowed-org membership]
  │     401 → clear cookie → /login | 401
  │     not in allowed orgs → /login?error=org | 403
  │     5xx/timeout → last-known ≤10 min, else 503 authz_unavailable
  ├─ resolveAccess(id) [L1 60s → DB; DB error → last-known ≤10 min, else 503]
  │     groups = user_groups ∪ {admin if id ∈ GITDASH_ADMIN_GITHUB_IDS}
  │     flags  = admin ? ALL : ∪ group_flags(groups)
  ├─ decide(classify(path, method), access, ENFORCE)
  │     admin routes: always enforced
  │     ENFORCE=false: everything else → allow (today's behaviour)
  │     no groups → /pending | 403 no_groups
  │     UNREGISTERED api → 403 (deny by default)
  │     not permitted → /  | 403 {code:"forbidden", flag}
  └─ next() → handler (writes/admin re-run decide()) → withCache (L1 → L2 if shared → GitHub)
```

## Success Criteria

- [ ] GitHub calls (GET and write) log route label and rate-limit remaining when `GITDASH_GH_LOG=1`. A low-budget warning is always on.
- [ ] Static test: no `Cache-Control` in `src/app/api/**` (except `demo`) lacks `Vary: Cookie`, and none uses `s-maxage`. Polled routes have browser TTL ≤ their polling interval.
- [ ] Every `/api/github/*` read route uses `withCache`. The only allowlisted exceptions are `create-issue` and `rate-limit`.
- [ ] Repeat `org-overview` across 2 instances sharing one DB: the second serves from L2 with 0 GitHub calls. Proven by unit test (L1 reset) **and** by a local run of two `next start` processes on ports 3100 and 3101 against the Docker DB. The AI/email settings keys never reach `api_cache` (test).
- [ ] Concurrent `ensureSchema()` twice and a half-applied migration both recover (test).
- [ ] The same person via OAuth and via PAT resolves to the same `github_id` and groups. A session can never pair one account's token with another account's identity (test).
- [ ] Legacy cookies without a stored id keep working after deploy.
- [ ] A non-member of `GITDASH_ALLOWED_ORGS` cannot log in and creates no `users` row.
- [ ] Registry test fails if any `src/app/api/**/route.ts` exported method is unclassified, or if the proxy matcher skips it.
- [ ] With `ENFORCE=true`: a `dev` user without `costAnalytics` gets 403 from `curl /api/github/billing`, and an ungrouped user sees only `/pending`.
- [ ] With `ENFORCE=false`: all current users keep today's access, and admins can use `/admin`.
- [ ] DB down → 503 `authz_unavailable` (or last-known access). Never a redirect to `/login`, never allowing an ungrouped user through.
- [ ] Grant or revoke visible to new requests within ≤60s. Each change has exactly one audit row written atomically. Two admins removing each other cannot leave zero DB admins.
- [ ] Startup fails in org mode when `DATABASE_URL` is missing or `GITDASH_ADMIN_GITHUB_IDS` doesn't parse.
- [ ] Standalone mode: existing tests pass, no DB required, flags behave as today.
- [ ] `pnpm lint`, `pnpm test`, `pnpm build`, `helm lint helm/gitdash` green.

## Risks (cross-phase)

| Risk | Signal | Response |
|---|---|---|
| Proxy bundle can't import `db.ts`, `cache.ts` or `crypto` | Build error or runtime error in proxy | Phase 5 step 1 verifies against `node_modules/next/dist/docs/`. If blocked, fall back to `requireAccess()` in every non-public handler (same `decide()`), with the registry test as the guard |
| Proxy bypass class of bug | Next security advisory | Handler re-check on writes and admin routes. Keep Next patched |
| Cached GitHub DTOs at rest in Postgres | — | Opt-in routes only, token-scoped keys, TTL plus delete-on-read and sampled purge. Documented in `README-SECURITY-ENHANCEMENTS.md` |
| Rate limiter is per-instance (`src/lib/ratelimit.ts`) | Brute-force on PAT setup across replicas | Accepted. Mitigated by allowed-orgs, the generic error, and the group requirement. Documented |
| Stale grants for ≤60s (TTL) and ≤10 min during an outage | — | This is the documented contract |

## Open questions

None. Resolved in red-team: the route classes (phase 5 table) and the UI-only flags (`reliabilityTab`, `anomalyDetection` and `reviewBottleneck` are gated in the UI only; their data comes from routes open to every grouped user).

## Red Team Review

### Session — 2026-09-27
**Findings:** 15 after dedup of 39 raw (15 accepted, 0 rejected; two sub-suggestions rejected: pre-seeding grants with today's defaults, which contradicts Thi's "admin decides", and building L2 only after telemetry proves the need, which contradicts the accepted contract)
**Severity breakdown:** 5 Critical, 6 High, 4 Medium
**Decisions from Thi:** apply all accepted; `GITDASH_RBAC_ENFORCE` off by default; `GITDASH_ALLOWED_ORGS` yes; ETag store stays per-instance.

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | L2 would store decrypted AI/email provider keys (`src/lib/ai.ts:155`, `src/lib/notifier.ts:146`) | Critical | Accept | Phase 3 (opt-in `shared`) |
| 2 | Session token/identity mismatch; legacy-cookie lockout; login CSRF on setup | Critical | Accept | Phases 4, 5 |
| 3 | Non-idempotent, unlocked migrations race across replicas (`src/lib/db.ts:333-367`) | Critical | Accept | Phase 0, plan data model |
| 4 | Deploy-day lockout / phase ordering / bad bootstrap env | Critical | Accept (modified: enforce flag, no seeding) | Phases 4, 5, 7 |
| 5 | Undefined behaviour with DB or GitHub down; org mode without DB | Critical | Accept | Phase 5 |
| 6 | Revocation claims false (separate proxy memory, browser max-age, whoami 900s, `/me` 10 min dedupe `src/lib/swr.tsx:37`) | High | Accept | Phases 1, 4, 5, 7 |
| 7 | Header change freezes live run polling (`runs` 120s, `run-details` 600s) | High | Accept | Phases 1, 2 |
| 8 | Base routes leak beyond GitHub access (`/api/db/runs`, alert `destination`) | High | Accept | Phase 5 |
| 9 | Fire-and-forget L2 write races delete; partial/failed results cached | High | Accept | Phases 2, 3 |
| 10 | PGlite harness not wired to `db.ts` | High | Accept | Phase 0 (new) |
| 11 | Admin-only classes break Settings/Reports for non-admins; unclassified `/test` routes; `/api/demo` scope drift | High | Accept | Phases 5, 7 |
| 12 | Admin invariants race (TOCTOU); no CSRF on mutations | Medium | Accept | Phases 5, 6 |
| 13 | L2 growth: no helm cron, purge after token guard, junk-param keys, no upsert, synchronized expiry | Medium | Accept | Phases 2, 3 |
| 14 | Deny-by-default holes (matcher extension exclusion, `startsWith`); duplicated permission logic | Medium | Accept | Phase 5 |
| 15 | Wrong counts/lists; telemetry misses writes and route; nav grep wrong; `FetchError` drops `code`; pending-user spam | Medium | Accept | Phases 1, 4, 6, 7 |

### Whole-Plan Consistency Sweep
Decision delta applied across all files:
- The v8/v9 split is now v8 = `api_cache` (phase 3) and v9 = RBAC tables (phase 4). Phase 5 no longer claims schema work.
- Identity comes from `whoami`, never from the session id. The phase 4 "re-hydrate in /me" step is removed.
- "Immediate local invalidation" is removed everywhere. The only guarantee is the ≤60s TTL.
- `whoami` TTL changed 900s → 60s, L1 only.
- L2 is opt-in, not global.
- The five `src/lib/permissions/*` files became one `src/lib/permissions.ts`.
- Counts corrected to 8/28 and 17.
- Enforcement is gated by `GITDASH_RBAC_ENFORCE`.
- `sql.transaction()` was never uncertain (it exists, `src/lib/db.ts:375`). The CTE is now the primary design for admin mutations.

Searched for stale terms: `900`, `re-hydrate`, `invalidates immediately`, `permissions/`, `11 of 29`, `~12`, `allow_signup`. No contradictions remain.

## Validation Log

### Session 1 — 2026-09-27
**Trigger:** `/ak:plan validate --html` after the red team and the local-only constraint.
**Questions asked:** 4

#### Verification Results
- Claims checked: 14. These are the ones added after the red team, which had already verified the rest.
- Verified: 13 | Failed: 1 | Unverified: 0
- Tier: Standard (limited by the red-team guard to post-red-team claims)
- Verified:
  - `vercel link --project`, `vercel env pull --environment` (CLI 59.11.2)
  - Every file named in phases 5–7 exists: `AuthProvider` fetches `/api/auth/me` (`src/components/AuthProvider.tsx:25`), plus `Sidebar`, `nav-config`, `CommandPalette`, `AiProviderCard`, `EmailSettingsCard`, `src/lib/url.ts` and the alerts/reports pages
  - 10 files make raw `fetch("/api…")` calls
  - `.env*` and `.vercel` are git-ignored
  - Docker 27.4 and Homebrew Postgres are available
- Failed: the local-DB design "file-backed PGlite for `pnpm dev`". PGlite allows only one open instance per data directory. The proxy and the route handlers each load their own copy of `db.ts`, so two instances would open the same directory. Replaced (Q1).

#### Questions & Answers
1. **Local DB for `pnpm dev`** → Docker Postgres + local Neon HTTP proxy. PGlite is for unit tests only. *Rationale:* exercises the production Neon driver path, safe with multiple processes, and allows a real two-instance L2 test.
2. **Vercel env source** → Production, read-only. The DB URL is stripped.
3. **Local org-mode login** → PAT only. No dev OAuth app is created on GitHub. OAuth is covered by mocked tests.
4. **Pacing** → Checkpoint after phase 3 for Thi's review before the RBAC phases 4–7.

#### Propagation
- `phase-00`: Part A DB steps (docker compose, proxy, PAT/standalone login), env source, Part B dev-mode `neonConfig.fetchEndpoint`.
- `phase-03`: backup target, two-instance local run, checkpoint.
- `phase-04`: backup target.
- `plan.md`: local-only section, success criterion, execution checkpoint.

### Whole-Plan Consistency Sweep
- Files reread: plan.md and phase-00 through phase-07.
- Decision deltas checked: 4.
- Stale references searched: `pglite://`, `.data/`, `Neon dev branch`, `--environment=development`, `simulated instances`, `in the PR`. All reconciled.
- Unresolved contradictions: 0.
