# Phase 0 evidence — 2026-09-27

## Part A — local env from Vercel
- `vercel link --yes --scope <vercel-team> --project gitdash` → `.vercel/project.json` projectId matches `<vercel-project-id>`. Link also created `.env.local` (VERCEL_OIDC_TOKEN only).
- Development env has **no** variables; pulled **Production** read-only: `vercel env pull .env --environment=production`.
- Removed 18 DB vars (DATABASE_URL*, PG*, POSTGRES_*, NEON_*, VITE_NEON_AUTH_URL) and Vercel system vars (VERCEL_*, TURBO_*, NX_DAEMON). Verified: 0 `neon.tech`, 0 `postgres://` remote, 0 DB keys from prod.
- Kept (names only): BAILIAN_API_KEY, BAILIAN_MODEL, CRON_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, RESEND_API_KEY, RESEND_FROM, SESSION_SECRET.
- Local overrides: NEXT_PUBLIC_APP_URL=http://localhost:3100, MODE=standalone (prod is organization; org-mode local login needs phase 4 PAT login), GITDASH_RBAC_ENFORCE=false, DATABASE_URL → local Docker, NEON_LOCAL_FETCH_ENDPOINT → localhost:4444.
- Port 3000 is held by another local project (aws-secret-manager-web-service); GitDash uses **3100** (second instance 3101).
- `pnpm dev --port 3100`: /api/health 200; PAT login (gh CLI token, piped, never printed) 200; /api/github/repos 200 with 196 repos; dashboard 200. Session cookie deleted after.
- Not in prod env: GITHUB_TOKEN (cron sync fallback) — noted, not needed for this delivery.

## Part B — harness + safe migrations
- `ensureSchema()`: bootstrap + each migration in one `db.transaction` with `pg_advisory_xact_lock`; bootstrap lock skipped when `schema_migrations` exists.
- PGlite neon-compatible adapter; test DDL generated from exported `MIGRATIONS`.
- Real-driver test (`tests/db-migrations.local-pg.test.ts`, schema reset first): two module instances racing on an empty Postgres via the Neon HTTP driver → both succeed, 7 versions recorded once.
- Rollback test: migration failing part-way leaves no table and no version row.
- `pnpm test`: 385 passed, 1 skipped (local-pg, env-gated). `tsc --noEmit` 0. `pnpm lint` 0.
- Code review: APPROVE_WITH_NITS; all Medium + Low 1/2/5 fixed.

## Deviations from plan
- `useSecureWebSocket` / `poolQueryViaFetch` not set: app uses neon() HTTP only (documented in db.ts).
- Migration-recovery test deletes the v1 version row (no v9 exists yet); same recovery path.
