# Phases 1–3 evidence — 2026-09-27 (caching checkpoint)

Local only. Nothing committed or pushed. Verified in the worktree `new-update`.

## Automated checks (final run)
- `pnpm test`: 437 passed, 1 skipped (`tests/db-migrations.local-pg.test.ts`, env-gated; run separately below)
- `pnpm exec tsc --noEmit -p .`: exit 0
- `pnpm lint`: exit 0, 0 warnings
- `pnpm build`: exit 0
- Real-driver migration test (Neon HTTP driver → local Neon proxy → Postgres 17, schema reset first, two module instances racing): passed; 8 versions recorded once (v8 = `api_cache`)

## Live two-instance run (production build, `next start` on :3100 and :3101, shared local DB, `GITDASH_GH_LOG=1`)
Requests sent with `X-Forwarded-Proto: https` (simulated TLS load balancer; production HTTPS redirect otherwise applies) and the session cookie passed explicitly (production cookies are `secure`).

| Check | Result |
|---|---|
| `org-overview` on A (cold) | 200, 2.56s, **11** GitHub calls |
| Same request on B | 200, 0.37s, **0** GitHub calls (L2 hit) |
| A vs B response | semantically identical (byte order differs: JSONB sorts object keys) |
| `repos` on B, normal | 0 GitHub calls (L2 hit of A's fetch) |
| `repos` on B, `X-GitDash-Refresh: 1` | 2 GitHub calls (both caches bypassed) |
| Neon proxy stopped, 6 requests on B | all 200; one L2 warning, breaker open 30s; cached reads ~3ms, refreshes = GitHub time only (0.9–1.3s), no DB wait |

## Review history
1. Phases 1–2 review: REQUEST_CHANGES. H1 (browser `max-age` copied from `s-maxage` broke Refresh), H2/M1 (partials cached), M2–M5, L1–L7. All fixed except L3 (upstream status pass-through), L7 (billing `/user` call, free via ETag).
2. Phase 3 + fix-delta review: REQUEST_CHANGES. H1 (DB outage added up to ~4s per request), M1 (refresh could join a stale in-flight L2 read), M2 (purge could stall on backlog), M3 (no opt-out/docs for data at rest), M4 (evidence not recorded — this file), L2/L3/L4/L6/L7/L9 fixed. Not changed: L1 (`computed_at` ordering; bounded by TTL), L5 (JSONB key order; no client depends on it), L8 (refresh rate limit; bounded by the user's own GitHub budget).
3. Focused confirmation review of the fix delta: APPROVE_WITH_NITS (0 Critical/High). Then fixed: tests for in-flight/refresh rules (4 cases), superseded run no longer overwrites a refresh, a serialize error no longer trips the breaker, README note to `TRUNCATE api_cache` after opting out. Not changed: hung-schema retry (bounded by the breaker), ~1% writes pay a purge (≤300ms).
4. Final: 441 tests passed, tsc 0, lint 0 warnings.

## Decisions taken during implementation (also in plan.md "Implementation decisions")
- Refresh bypasses both caches (Thi). Mechanism: `X-GitDash-Refresh: 1` header + `cache: "reload"` on the same URL.
- Partial results cached 30s (Thi).
- Former `s-maxage` routes keep `max-age=0` in the browser.
- L2 enabled whenever `DATABASE_URL` is set (any mode), with `GITDASH_L2_CACHE=0` opt-out.
- `NEON_LOCAL_FETCH_ENDPOINT` loopback-only, no `NODE_ENV` gate (warns in production builds).
- `cacheDelete*` stay in-process only.

## Deviations / notes
- Backup before v8: the local DB only ever held test-created schemas that the real-driver test drops each run; no data to back up. Production Neon untouched.
- `security-scan` now returns an error (not a perfect score) when listing `.github/workflows` fails for reasons other than 404.
- `cost-analysis` rejects invalid `year`/`month` with 400.
- Route telemetry label via `labelGitHubRoute()` (AsyncLocalStorage), not a `getOctokit` option.

## Running processes (owned by this session)
- `next start -p 3100`, `next start -p 3101` (production build, for the checkpoint)
- Docker compose project `gitdash-local-db` (postgres:17 on 127.0.0.1:55432, Neon proxy on :4444)
