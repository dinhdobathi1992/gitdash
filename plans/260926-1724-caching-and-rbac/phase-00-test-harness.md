---
phase: 0
title: "Local env from Vercel + test harness + safe migrations"
status: completed
priority: P1
effort: "1d"
dependencies: []
---

# Phase 0: Local environment, test harness, safe migrations

<!-- Red Team #3, #10 -->

## Overview
First, run the app locally with the same configuration as the deployed Vercel project. Then make `src/lib/db.ts` testable against a real Postgres engine, and make migrations safe to run from many replicas at once. Every later phase relies on all three.

## Part A — Local environment from Vercel (do first)

**Source:** Vercel team `<vercel-team>`, project `gitdash` (`<vercel-project-id>`), https://vercel.com/<vercel-team>/gitdash

### Requirements
- Pull the project's Environment Variables into a local `.env`. It is already git-ignored: `.gitignore:34` ignores `.env*`, and `.vercel` is ignored too.
- **Never print secret values** in the terminal, logs, reports or notes. Report only variable **names**, and whether each is set or empty.
- **Never let a local run point at the production database.** Migrations v8/v9 and the admin tests write to the DB. Locally, `DATABASE_URL` is a **local Docker Postgres fronted by a local Neon HTTP proxy**. `neonConfig.fetchEndpoint` points at `localhost` in dev only, so the production Neon driver code path runs unchanged. The production `DATABASE_URL` pulled from Vercel is removed from `.env`, so nothing can write to it by accident. PGlite is used only for unit tests <!-- Updated: Validation Session 1 - local DB = Docker Postgres + Neon HTTP proxy -->.
- The pull will bring in the production `DATABASE_URL`. Replace it with the local Docker Postgres URL before the first `pnpm dev` (step 5).
- Vercel variables marked **Sensitive** come back empty from `vercel env pull`. List any empty names and get Thi to supply those values.
- Local org-mode login uses **PAT only** (phase 4 form). No dev OAuth app is created, and the OAuth path is covered by mocked tests. Until phase 4 lands, verify locally in standalone mode (`MODE` unset) with a PAT on `/setup`. <!-- Updated: Validation Session 1 - local login = PAT only -->

### Steps
1. `pnpm install`. `node_modules` is missing in this worktree.
2. Link the local directory to the Vercel project. This is read-only on the Vercel side; it only writes the git-ignored `.vercel/`:
   `vercel link --yes --scope <vercel-team> --project gitdash`
   Check that `.vercel/project.json` has `projectId = <vercel-project-id>`.
3. List which environments hold variables, names only: `vercel env ls`. Pull from **Production**, read-only (Thi's decision). Nothing is written to Vercel. <!-- Updated: Validation Session 1 - env source = production -->
4. Pull the variables: `vercel env pull .env --environment=production`. Then list the names with values blanked:
   `sed -E 's/=.*/=<set>/' .env`
   Flag every empty value.
5. **Database guard:**
   - Compare the host of `DATABASE_URL` against the production Neon host, without printing the URL, e.g. `grep -c "<prod-host-fragment>" .env`.
   - Remove the production `DATABASE_URL` and any `PG*`/`POSTGRES_*` lines from `.env`.
   - Start the local DB: a local-only, uncommitted `docker-compose.local-db.yml` with two services, `postgres:17` (volume `gitdash-pgdata`) and the local Neon HTTP proxy (`ghcr.io/timowilhelm/local-neon-http-proxy`, pinned by digest after the first pull). Wire them up per Neon's "local development with the serverless driver" guide.
   - Set the local `DATABASE_URL` for the proxy (e.g. `postgres://postgres:postgres@db.localtest.me:5432/main`).
   - Check the prod host is gone: the prod host fragment count in `.env` is `0`.
6. Set the local-only overrides in `.env`:
   - `APP_URL`/public URL → `http://localhost:3000`
   - `MODE` → whatever is being tested
   - `GITDASH_RBAC_ENFORCE=false`
   - `GITDASH_ADMIN_GITHUB_IDS` → Thi's numeric id
7. `pnpm dev`. Then check that `curl -s localhost:3000/api/health` returns ok, and that one authenticated page loads with the `/setup` PAT in standalone mode, or the org login in org mode.
8. Record the result in the daily note: the variable **names** pulled, which ones were overridden, and the local DB container name. No values.

### Success criteria
- [x] `.env` exists, is git-ignored (`git check-ignore .env` prints the path), and holds every variable name from the Vercel environment that was pulled.
- [x] Local `DATABASE_URL` targets the Docker Postgres through the local Neon proxy, `.env` holds no production DB host, and `ensureSchema()` succeeds against it.
- [x] `pnpm dev` serves the app locally, `/api/health` responds ok, and the dashboard loads with real GitHub data.
- [x] No secret value appears in any log, report or note. Nothing is committed or pushed.

## Part B — Test harness and safe migrations

## Requirements
- Functional: **dev-mode local DB.** When `NEON_LOCAL_FETCH_ENDPOINT` is set and `NODE_ENV !== "production"`, `getDb()` sets `neonConfig.fetchEndpoint` (plus `useSecureWebSocket = false`, `poolQueryViaFetch = true` as the Neon local guide requires) before creating the client. Production ignores the variable. PGlite stays test-only.
- Functional: `db.ts` exposes `__setDbClientForTests(client)`. The client must support what `neon()` provides: tagged templates, `.query(sql, params)`, and `.transaction([...])`.
- Functional: a PGlite adapter in `tests/setup/pglite.ts` implements that interface. The harness DDL is generated by running `MIGRATIONS` through `ensureSchema()` instead of the hand-copied list, so it cannot drift.
- Functional: `ensureSchema()` applies each unapplied migration as one `db.transaction([ SELECT pg_advisory_xact_lock(<const>), ...up, INSERT schema_migrations ... ON CONFLICT DO NOTHING ])`. All migration DDL uses `IF NOT EXISTS`.
- Functional: `src/lib/cache.ts` exports `__resetCacheForTests()`, which clears `store` and `inflight`. It simulates a fresh instance.
- Non-functional: no production behaviour change beyond the transactional migration. Existing tests stay green.

## Architecture
The `getDb()` return type stays the same. The test client is swapped in behind it. Advisory locks and transactions both work in PGlite.

## Related Code Files
- Modify: `src/lib/db.ts` (`getDb`, `ensureSchema`), `src/lib/cache.ts`
- Modify: `tests/setup/pglite.ts`, `tests/sync-pr-facts.test.ts` (use generated DDL)
- Create: `tests/db-migrations.test.ts`

## Implementation Steps
1. Confirm Part A is done (deps installed, `.env` in place).
2. Add a client injection point and the PGlite adapter (tagged template → parameterized `query`).
3. Rewrite `ensureSchema` to be transactional and advisory-locked.
4. Tests:
   - Two concurrent `ensureSchema()` calls both succeed.
   - Pre-create one v9 table, then run `ensureSchema()`; it succeeds.
   - A migration that throws midway leaves no `schema_migrations` row and no partial tables.
5. Switch `sync-pr-facts.test.ts` to the generated schema.

## Success Criteria
- [x] Migration concurrency and partial-failure tests pass.
- [x] `pnpm test` green.

## Risk Assessment
- Neon HTTP `transaction()` runs its statements as one non-interactive batch. That is fine here, because the migration body has no read-then-decide step.
- If PGlite's SQL dialect differs from Neon, an adapter test may pass while Neon fails. Mitigated: migrations also run against the local Docker Postgres through the real Neon driver (Part A). A Neon-branch run is still listed in `reports/` as a pre-deploy check.
