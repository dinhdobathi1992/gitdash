/**
 * Neon PostgreSQL client + versioned schema migrations.
 *
 * Uses @neondatabase/serverless tagged-template API.
 * Schema is applied via explicit versioned migrations tracked in schema_migrations.
 */

import { neon, neonConfig } from "@neondatabase/serverless";
import { buildPayload, dispatchAlert, METRIC_LABELS as _METRIC_LABELS } from "./notifier";
import { detectAnomalies } from "./anomaly";
import type { WhPrRow, WhCommitRow } from "./working-habits";

// ── Client ────────────────────────────────────────────────────────────────────

export type DbClient = ReturnType<typeof neon>;

let _client: DbClient | null = null;

/**
 * Local development only: route the Neon HTTP driver to a local Neon HTTP
 * proxy (Docker Postgres + local-neon-http-proxy) instead of Neon's cloud
 * endpoint, so `pnpm dev` and a local `next start` exercise the same driver
 * code as production without touching a remote database. Never set in a real
 * deployment; the loopback-only check below is the safety boundary.
 *
 * HTTP driver only: the app never uses Pool/WebSocket, so the Neon local-dev
 * settings for those (useSecureWebSocket, poolQueryViaFetch) are not needed.
 * Only loopback hosts are accepted, because the driver sends the full
 * connection string (including the password) to this endpoint.
 */
function applyLocalNeonEndpoint(): void {
  const endpoint = process.env.NEON_LOCAL_FETCH_ENDPOINT;
  if (!endpoint) return;
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    throw new Error("NEON_LOCAL_FETCH_ENDPOINT is not a valid URL");
  }
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error("NEON_LOCAL_FETCH_ENDPOINT must point at localhost or 127.0.0.1");
  }
  if (process.env.NODE_ENV === "production") {
    // Expected for a local `next start`; anywhere else it means production
    // traffic is going to a loopback proxy (e.g. a sidecar) — make it visible.
    console.warn(`[db] NEON_LOCAL_FETCH_ENDPOINT is active in a production build (${host})`);
  }
  neonConfig.fetchEndpoint = endpoint;
}

export function getDb(): DbClient {
  if (!_client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    applyLocalNeonEndpoint();
    _client = neon(url);
  }
  return _client;
}

/**
 * Test hook: swap in a client that mimics the neon() interface (tagged
 * template, `.query`, `.transaction`) — e.g. the PGlite adapter in
 * tests/setup/pglite.ts. Passing null restores the real driver. Also resets
 * the schema-applied flag so each injected database is migrated afresh.
 */
export function __setDbClientForTests(client: DbClient | null): void {
  _client = client;
  schemaEnsured = false;
  schemaPromise = null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DbWorkflowRun {
  id: number;
  repo: string;
  workflow_id: number | null;
  workflow_name: string | null;
  run_number: number | null;
  status: string | null;
  conclusion: string | null;
  event: string | null;
  head_branch: string | null;
  head_sha: string | null;
  actor: string | null;
  created_at: string;
  updated_at: string | null;
  duration_ms: number | null;
  queue_wait_ms: number | null;
  run_attempt: number;
  synced_at: string;
}

export interface DbDailyTrend {
  date: string;
  total: number;
  success: number;
  failure: number;
  avg_duration_ms: number | null;
  avg_queue_ms: number | null;
}

export interface DbQuarterSummary {
  quarter: string;
  year: number;
  quarter_num: number;
  total: number;
  success: number;
  failure: number;
  success_rate: number;
  avg_duration_ms: number | null;
}

export interface DbAlertRule {
  id: number;
  scope: string;
  metric: string;
  threshold: number;
  window_hours: number;
  channel: string;
  destination: string | null;
  enabled: boolean;
  created_at: string;
  // v2 additions
  muted_until: string | null;
  owner_note: string | null;
}

export interface DbAlertEvent {
  id: number;
  rule_id: number | null;
  scope: string;
  metric: string;
  value: number | null;
  fired_at: string;
  details: Record<string, unknown> | null;
  // v2 provenance fields
  source: string | null;
  window_hours: number | null;
  sample_size: number | null;
  computed_at: string | null;
  delivery_status: string | null;
  // v4 addition
  digest_sent_at: string | null;
}

export interface PendingDigestEvent extends DbAlertEvent {
  destination: string | null;
}

export interface DbPrFact {
  id: number;
  repo: string;
  pr_number: number;
  author: string | null;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  first_review_at: string | null;
  approved_at: string | null;
  additions: number | null;
  deletions: number | null;
  review_count: number | null;
  state: string | null;
  synced_at: string;
  commit_count: number | null;
  changed_files: number | null;
  commits_synced_at: string | null;
}

export interface RunUpsertRow {
  id: number;
  repo: string;
  workflow_id: number | null;
  workflow_name: string | null;
  run_number: number | null;
  status: string | null;
  conclusion: string | null;
  event: string | null;
  head_branch: string | null;
  head_sha: string | null;
  actor: string | null;
  created_at: string;
  updated_at: string | null;
  duration_ms: number | null;
  queue_wait_ms: number | null;
  run_attempt: number;
}

export interface PrFactUpsertRow {
  repo: string;
  pr_number: number;
  author: string | null;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  first_review_at: string | null;
  approved_at: string | null;
  additions: number | null;
  deletions: number | null;
  review_count: number | null;
  state: string | null;
  /** All commits in the PR, merges included (REST `pulls.get`). */
  commit_count: number | null;
  changed_files: number | null;
}

// ── Versioned migrations ───────────────────────────────────────────────────────

/**
 * Each migration has a unique integer version. Migrations are idempotent and
 * applied in ascending order. Once applied, they are recorded in schema_migrations.
 *
 * ensureSchema() runs each migration inside one transaction, so every statement
 * must be transaction-safe and idempotent: use IF NOT EXISTS, and never
 * CREATE INDEX CONCURRENTLY, VACUUM, ALTER TYPE ... ADD VALUE, or anything else
 * that cannot run inside a transaction block.
 */
export const MIGRATIONS: Array<{ version: number; name: string; up: string[] }> = [
  {
    version: 1,
    name: "initial_schema",
    up: [
      `CREATE TABLE IF NOT EXISTS workflow_runs (
        id              BIGINT PRIMARY KEY,
        repo            VARCHAR(300) NOT NULL,
        workflow_id     BIGINT,
        workflow_name   VARCHAR(300),
        run_number      INT,
        status          VARCHAR(50),
        conclusion      VARCHAR(50),
        event           VARCHAR(100),
        head_branch     VARCHAR(300),
        head_sha        VARCHAR(40),
        actor           VARCHAR(100),
        created_at      TIMESTAMPTZ NOT NULL,
        updated_at      TIMESTAMPTZ,
        duration_ms     INT,
        queue_wait_ms   INT,
        run_attempt     INT DEFAULT 1,
        synced_at       TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_wr_repo_created ON workflow_runs(repo, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_wr_workflow ON workflow_runs(workflow_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_wr_conclusion ON workflow_runs(repo, conclusion, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS sync_cursors (
        repo            VARCHAR(300) PRIMARY KEY,
        last_run_id     BIGINT,
        last_synced_at  TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS alert_rules (
        id              SERIAL PRIMARY KEY,
        scope           VARCHAR(300) NOT NULL,
        metric          VARCHAR(50) NOT NULL,
        threshold       NUMERIC NOT NULL,
        window_hours    INT NOT NULL DEFAULT 24,
        channel         VARCHAR(50) NOT NULL,
        destination     TEXT,
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ar_scope ON alert_rules(scope)`,
      `CREATE TABLE IF NOT EXISTS alert_events (
        id              SERIAL PRIMARY KEY,
        rule_id         INT REFERENCES alert_rules(id) ON DELETE CASCADE,
        scope           VARCHAR(300) NOT NULL,
        metric          VARCHAR(50) NOT NULL,
        value           NUMERIC,
        fired_at        TIMESTAMPTZ DEFAULT NOW(),
        details         JSONB
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ae_scope_fired ON alert_events(scope, fired_at DESC)`,
    ],
  },
  {
    version: 2,
    name: "pr_facts_table",
    up: [
      `CREATE TABLE IF NOT EXISTS pr_facts (
        id              BIGSERIAL PRIMARY KEY,
        repo            VARCHAR(300) NOT NULL,
        pr_number       INT NOT NULL,
        author          VARCHAR(100),
        created_at      TIMESTAMPTZ NOT NULL,
        merged_at       TIMESTAMPTZ,
        closed_at       TIMESTAMPTZ,
        first_review_at TIMESTAMPTZ,
        approved_at     TIMESTAMPTZ,
        additions       INT,
        deletions       INT,
        review_count    INT,
        state           VARCHAR(20),
        synced_at       TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (repo, pr_number)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_prf_repo_merged ON pr_facts(repo, merged_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_prf_repo_created ON pr_facts(repo, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_prf_author ON pr_facts(repo, author, merged_at DESC)`,
    ],
  },
  {
    version: 3,
    name: "alert_provenance_and_delivery",
    up: [
      // Add provenance metadata to alert_events
      `ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS source VARCHAR(50)`,
      `ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS window_hours INT`,
      `ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS sample_size INT`,
      `ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS computed_at TIMESTAMPTZ`,
      `ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) DEFAULT 'pending'`,
      // Add mute and ownership fields to alert_rules
      `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ`,
      `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS owner_note TEXT`,
    ],
  },
  {
    version: 4,
    name: "alert_digest",
    up: [
      // Marks when an event was folded into a digest email — NULL means it's
      // still pending. Supports the "digest" delivery channel (daily summary
      // instead of a real-time notification per event).
      `ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS digest_sent_at TIMESTAMPTZ`,
      `CREATE INDEX IF NOT EXISTS idx_ae_digest_pending ON alert_events(digest_sent_at) WHERE digest_sent_at IS NULL`,
    ],
  },
  {
    version: 5,
    name: "email_settings",
    up: [
      // Instance-wide email delivery config, editable from Settings instead of
      // requiring an env var and a redeploy.
      //
      // Singleton by construction: `id` is pinned to 1 by a CHECK, so an UPSERT
      // on the primary key is the whole write path and no code can accidentally
      // create a second competing row.
      //
      // api_key_sealed holds an AES-256-GCM value from src/lib/secret-box.ts —
      // never plaintext, because this column ends up in every backup.
      // updated_by records the GitHub login that last changed it: the table is
      // instance-global (like alert_rules) so any authenticated user can edit
      // it, and attribution is what makes that acceptable.
      `CREATE TABLE IF NOT EXISTS email_settings (
        id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        enabled         BOOLEAN NOT NULL DEFAULT FALSE,
        provider        VARCHAR(20) NOT NULL DEFAULT 'resend',
        api_key_sealed  TEXT,
        api_key_hint    VARCHAR(20),
        from_address    TEXT,
        updated_by      VARCHAR(120),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )`,
    ],
  },
  {
    version: 6,
    name: "ai_settings",
    up: [
      // Per-instance AI provider override, editable from Settings in
      // ORGANIZATION mode only. Standalone deployments deliberately keep using
      // the environment defaults so they work out of the box with no setup.
      //
      // Singleton by the same CHECK (id = 1) construction as email_settings.
      // api_key_sealed is AES-256-GCM from src/lib/secret-box.ts — this column
      // reaches every backup, so it is never plaintext.
      `CREATE TABLE IF NOT EXISTS ai_settings (
        id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        enabled         BOOLEAN NOT NULL DEFAULT FALSE,
        provider        VARCHAR(20) NOT NULL DEFAULT 'bailian',
        model           VARCHAR(120),
        base_url        TEXT,
        api_key_sealed  TEXT,
        api_key_hint    VARCHAR(20),
        updated_by      VARCHAR(120),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )`,
    ],
  },
  {
    version: 7,
    name: "pr_facts_sync_cursor",
    up: [
      `ALTER TABLE sync_cursors ADD COLUMN IF NOT EXISTS pr_sync_cursor TIMESTAMPTZ`,
      `ALTER TABLE sync_cursors ADD COLUMN IF NOT EXISTS pr_backfill_complete BOOLEAN NOT NULL DEFAULT FALSE`,
    ],
  },
  {
    // Shared second-level cache (src/lib/cache-l2.ts) so replicas share
    // GitHub DTO hits. Keys are token-scoped; rows expire and are purged.
    version: 8,
    name: "api_cache",
    up: [
      `CREATE TABLE IF NOT EXISTS api_cache (
        key         TEXT PRIMARY KEY,
        value       JSONB NOT NULL,
        expires_at  TIMESTAMPTZ NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at)`,
    ],
  },
  {
    // Organization-mode access control: GitHub users (by numeric id), their
    // fixed groups, per-group feature-flag grants, and an audit trail.
    version: 9,
    name: "rbac",
    up: [
      `CREATE TABLE IF NOT EXISTS users (
        github_id     BIGINT PRIMARY KEY,
        login         VARCHAR(100) NOT NULL,
        avatar_url    TEXT,
        first_seen_at TIMESTAMPTZ DEFAULT NOW(),
        last_seen_at  TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS user_groups (
        github_id   BIGINT REFERENCES users ON DELETE CASCADE,
        group_name  VARCHAR(20) CHECK (group_name IN ('devops','security','dev','pm','admin')),
        PRIMARY KEY (github_id, group_name)
      )`,
      `CREATE TABLE IF NOT EXISTS group_flags (
        group_name  VARCHAR(20) CHECK (group_name IN ('devops','security','dev','pm')),
        flag_key    VARCHAR(50) NOT NULL,
        PRIMARY KEY (group_name, flag_key)
      )`,
      `CREATE TABLE IF NOT EXISTS permission_audit (
        id               BIGSERIAL PRIMARY KEY,
        actor_github_id  BIGINT NOT NULL,
        action           VARCHAR(40) NOT NULL,
        target           TEXT NOT NULL,
        details          JSONB,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_perm_audit_created ON permission_audit(created_at DESC)`,
    ],
  },
  {
    // Working habits: commit and PR size per engineer. Commits are measured
    // inside each merged PR (a squash merge would otherwise show one giant
    // commit on main). commit_count/changed_files are owned by the REST PR
    // sync; the commit sync only fills commit_count when it is still NULL.
    version: 10,
    name: "working_habits",
    up: [
      `ALTER TABLE pr_facts ADD COLUMN IF NOT EXISTS commit_count INT`,
      `ALTER TABLE pr_facts ADD COLUMN IF NOT EXISTS changed_files INT`,
      `ALTER TABLE pr_facts ADD COLUMN IF NOT EXISTS commits_synced_at TIMESTAMPTZ`,
      `CREATE INDEX IF NOT EXISTS idx_prf_commits_pending ON pr_facts(repo, merged_at)
        WHERE merged_at IS NOT NULL AND commits_synced_at IS NULL`,
      `CREATE TABLE IF NOT EXISTS pr_commit_facts (
        repo          VARCHAR(300) NOT NULL,
        sha           VARCHAR(40)  NOT NULL,
        pr_number     INT NOT NULL,
        author        VARCHAR(100),
        author_linked BOOLEAN NOT NULL,
        files         INT,
        additions     INT NOT NULL,
        deletions     INT NOT NULL,
        is_merge      BOOLEAN NOT NULL,
        committed_at  TIMESTAMPTZ,
        PRIMARY KEY (repo, sha)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_pcf_pr ON pr_commit_facts(repo, pr_number)`,
      `CREATE INDEX IF NOT EXISTS idx_pcf_author ON pr_commit_facts(repo, author)`,
      `CREATE TABLE IF NOT EXISTS working_habits_settings (
        id               INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        max_commit_files INT NOT NULL DEFAULT 10,
        max_commit_lines INT NOT NULL DEFAULT 200,
        max_pr_commits   INT NOT NULL DEFAULT 20,
        updated_by       VARCHAR(100),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      )`,
    ],
  },
  {
    // PR-facts sync resume. pr_backfill_page = next page to read while a
    // backfill is incomplete, so a run cut short continues there instead of
    // restarting at page 1. pr_sync_cursor becomes a high-water mark: the
    // newest PR updated_at at the start of the last full pass; later runs
    // only fetch details for PRs updated after it. Repos already complete
    // held the OLDEST updated_at under the previous meaning (which made every
    // run rescan everything); moving it to two days ago re-reads only recent
    // changes on the first run.
    version: 11,
    name: "pr_sync_resume",
    up: [
      `ALTER TABLE sync_cursors ADD COLUMN IF NOT EXISTS pr_backfill_page INT`,
      `UPDATE sync_cursors SET pr_sync_cursor = NOW() - INTERVAL '2 days' WHERE pr_backfill_complete = TRUE`,
    ],
  },
  {
    // Team insights v2. identity_links: GitHub logins that belong to one
    // person (alias -> primary, always one hop: a primary is never an alias).
    // identity_distinct: pairs an admin said are different people, so they are
    // never suggested again. Both change numbers only, never access.
    // team_settings: the org workday (time zone + hours) that decides what
    // counts as an after-hours or weekend commit.
    version: 12,
    name: "team_insights_v2",
    up: [
      `CREATE TABLE IF NOT EXISTS identity_links (
        alias_login   VARCHAR(100) PRIMARY KEY,
        primary_login VARCHAR(100) NOT NULL,
        created_by    VARCHAR(100),
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        CHECK (alias_login <> primary_login),
        CHECK (alias_login = lower(alias_login) AND primary_login = lower(primary_login))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_identity_links_primary ON identity_links(primary_login)`,
      `CREATE TABLE IF NOT EXISTS identity_distinct (
        login_a    VARCHAR(100) NOT NULL,
        login_b    VARCHAR(100) NOT NULL,
        created_by VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (login_a, login_b),
        CHECK (login_a < login_b COLLATE "C"),
        CHECK (login_a = lower(login_a) AND login_b = lower(login_b))
      )`,
      `CREATE TABLE IF NOT EXISTS team_settings (
        id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        timezone      VARCHAR(64) NOT NULL DEFAULT 'Asia/Saigon',
        workday_start SMALLINT NOT NULL DEFAULT 8 CHECK (workday_start BETWEEN 0 AND 23),
        workday_end   SMALLINT NOT NULL DEFAULT 19 CHECK (workday_end BETWEEN 1 AND 24 AND workday_end > workday_start),
        updated_by    VARCHAR(100),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )`,
    ],
  },
  {
    // MCP OAuth grants (src/lib/mcp/oauth/grants.ts). Rows hold ids only:
    // tokens, including the GitHub token, live solely inside sealed tokens.
    // current_refresh is generated at consent and carried in the code;
    // redeemed_at stays null until the code is exchanged. mcp_used_jti makes
    // authorization codes single-use.
    version: 13,
    name: "mcp_grants",
    up: [
      `CREATE TABLE IF NOT EXISTS mcp_grants (
        grant_id          UUID PRIMARY KEY,
        github_id         BIGINT NOT NULL,
        client_id         TEXT   NOT NULL,
        client_name       TEXT   NOT NULL,
        redirect_host     TEXT   NOT NULL,
        current_refresh   UUID   NOT NULL,
        previous_refresh  UUID,
        rotated_at        TIMESTAMPTZ,
        redeemed_at       TIMESTAMPTZ,
        absolute_expiry   TIMESTAMPTZ NOT NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at      TIMESTAMPTZ,
        revoked_at        TIMESTAMPTZ,
        revoked_reason    TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_mcp_grants_user ON mcp_grants(github_id) WHERE revoked_at IS NULL`,
      `CREATE TABLE IF NOT EXISTS mcp_used_jti (jti UUID PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_mcp_used_jti_exp ON mcp_used_jti(expires_at)`,
    ],
  },
];

let schemaEnsured = false;

/**
 * Arbitrary constant key for pg_advisory_xact_lock. Every instance that runs
 * migrations takes this lock inside its migration transaction, so replicas
 * starting together serialize instead of racing on the same DDL.
 */
const MIGRATION_LOCK_KEY = 718_204_551;

const BOOTSTRAP_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INT PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    applied_at  TIMESTAMPTZ DEFAULT NOW()
  )`;

let schemaPromise: Promise<void> | null = null;

/**
 * Apply pending migrations once per process. Concurrent callers share one
 * run; a failed run is forgotten so the next caller retries.
 */
export function ensureSchema(): Promise<void> {
  if (schemaEnsured) return Promise.resolve();
  schemaPromise ??= runMigrations().catch((err) => {
    schemaPromise = null;
    throw err;
  });
  return schemaPromise;
}

async function runMigrations(): Promise<void> {
  const db = getDb();

  // Bootstrap the tracking table under the same lock — concurrent
  // CREATE TABLE IF NOT EXISTS can still collide on the pg_type row. Skip the
  // lock when the table already exists, so warm cold-starts don't queue behind
  // another replica's in-progress migration just to confirm it.
  const [{ exists }] = await db`
    SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists
  ` as { exists: boolean }[];
  if (!exists) {
    await db.transaction([
      db`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`,
      db.query(BOOTSTRAP_SQL),
    ]);
  }

  const applied = await db`SELECT version FROM schema_migrations ORDER BY version` as { version: number }[];
  const appliedSet = new Set(applied.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (appliedSet.has(migration.version)) continue;

    // One transaction per migration: lock, DDL, record. A failure part-way
    // rolls back both the DDL and the version row, so a half-applied
    // migration can never be recorded as done. If another instance applied it
    // while we waited on the lock, the IF NOT EXISTS DDL and ON CONFLICT
    // insert are no-ops.
    //
    // db.query() executes a raw SQL string. Do NOT use db.unsafe() here —
    // in the @neondatabase/serverless HTTP driver it returns a non-thenable
    // UnsafeRawSql fragment (for interpolation), so it would silently execute
    // nothing while the migration is still recorded.
    await db.transaction([
      db`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`,
      ...migration.up.map((sql) => db.query(sql)),
      db`
        INSERT INTO schema_migrations (version, name) VALUES (${migration.version}, ${migration.name})
        ON CONFLICT (version) DO NOTHING
      `,
    ]);
  }

  schemaEnsured = true;
}

// ── Run upsert ────────────────────────────────────────────────────────────────

export async function upsertRuns(rows: RunUpsertRow[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const db = getDb();
  await db.transaction(
    rows.map(
      (r) => db`
        INSERT INTO workflow_runs
          (id, repo, workflow_id, workflow_name, run_number, status, conclusion,
           event, head_branch, head_sha, actor, created_at, updated_at,
           duration_ms, queue_wait_ms, run_attempt)
        VALUES (
          ${r.id}, ${r.repo}, ${r.workflow_id}, ${r.workflow_name}, ${r.run_number},
          ${r.status}, ${r.conclusion}, ${r.event}, ${r.head_branch}, ${r.head_sha},
          ${r.actor}, ${r.created_at}, ${r.updated_at}, ${r.duration_ms},
          ${r.queue_wait_ms}, ${r.run_attempt}
        )
        ON CONFLICT (id) DO UPDATE SET
          status        = EXCLUDED.status,
          conclusion    = EXCLUDED.conclusion,
          updated_at    = EXCLUDED.updated_at,
          duration_ms   = EXCLUDED.duration_ms,
          queue_wait_ms = EXCLUDED.queue_wait_ms,
          run_attempt   = EXCLUDED.run_attempt,
          synced_at     = NOW()
      `
    )
  );
  return rows.length;
}

// ── PR facts upsert ───────────────────────────────────────────────────────────

export async function upsertPrFacts(rows: PrFactUpsertRow[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const db = getDb();
  await db.transaction(
    rows.map(
      (r) => db`
        INSERT INTO pr_facts
          (repo, pr_number, author, created_at, merged_at, closed_at,
           first_review_at, approved_at, additions, deletions, review_count, state,
           commit_count, changed_files)
        VALUES (
          ${r.repo}, ${r.pr_number}, ${r.author}, ${r.created_at}, ${r.merged_at},
          ${r.closed_at}, ${r.first_review_at}, ${r.approved_at}, ${r.additions},
          ${r.deletions}, ${r.review_count}, ${r.state}, ${r.commit_count}, ${r.changed_files}
        )
        ON CONFLICT (repo, pr_number) DO UPDATE SET
          author          = EXCLUDED.author,
          merged_at       = EXCLUDED.merged_at,
          closed_at       = EXCLUDED.closed_at,
          first_review_at = EXCLUDED.first_review_at,
          approved_at     = EXCLUDED.approved_at,
          additions       = EXCLUDED.additions,
          deletions       = EXCLUDED.deletions,
          review_count    = EXCLUDED.review_count,
          state           = EXCLUDED.state,
          commit_count    = COALESCE(EXCLUDED.commit_count, pr_facts.commit_count),
          changed_files   = COALESCE(EXCLUDED.changed_files, pr_facts.changed_files),
          synced_at       = NOW()
      `
    )
  );
  return rows.length;
}

export async function getPrFacts(repo: string, limit = 200): Promise<DbPrFact[]> {
  await ensureSchema();
  return await getDb()`
    SELECT * FROM pr_facts WHERE repo = ${repo} ORDER BY created_at DESC LIMIT ${limit}
  ` as DbPrFact[];
}

export async function getPrFactCount(repo: string): Promise<number> {
  await ensureSchema();
  const rows = await getDb()`
    SELECT COUNT(*)::int AS cnt FROM pr_facts WHERE repo = ${repo}
  ` as { cnt: number }[];
  return rows[0]?.cnt ?? 0;
}

// ── PR commit facts (working habits) ─────────────────────────────────────────

export interface PrCommitFactRow {
  repo: string;
  sha: string;
  pr_number: number;
  /** Linked GitHub login, else the PR author. */
  author: string | null;
  /** False when the commit was credited to the PR author (email not linked to GitHub). */
  author_linked: boolean;
  /** Null when GitHub cannot compute it (very large commits). */
  files: number | null;
  additions: number;
  deletions: number;
  is_merge: boolean;
  committed_at: string | null;
}

export interface PrNeedingCommitSync {
  pr_number: number;
  author: string | null;
  merged_at: string;
}

/**
 * Merged PRs in the window whose commits have not been stored yet, oldest
 * merge first. Order matters: a commit shared by stacked PRs is claimed by
 * the first PR stored (ON CONFLICT DO NOTHING), i.e. the PR that introduced it.
 */
export async function listPrsNeedingCommitSync(
  repo: string,
  since: Date,
  limit = 200,
): Promise<PrNeedingCommitSync[]> {
  await ensureSchema();
  return await getDb()`
    SELECT pr_number, author, merged_at FROM pr_facts
    WHERE repo = ${repo} AND merged_at IS NOT NULL AND commits_synced_at IS NULL
      AND merged_at >= ${since.toISOString()}
    ORDER BY merged_at ASC, pr_number ASC
    LIMIT ${limit}
  ` as PrNeedingCommitSync[];
}

/** Multi-row insert; a (repo, sha) already stored keeps its first PR. */
export async function upsertPrCommitFacts(rows: PrCommitFactRow[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const col = <K extends keyof PrCommitFactRow>(k: K) => rows.map((r) => r[k]);
  const result = await getDb()`
    INSERT INTO pr_commit_facts
      (repo, sha, pr_number, author, author_linked, files, additions, deletions, is_merge, committed_at)
    SELECT * FROM unnest(
      ${col("repo")}::varchar[], ${col("sha")}::varchar[], ${col("pr_number")}::int[],
      ${col("author")}::varchar[], ${col("author_linked")}::boolean[], ${col("files")}::int[],
      ${col("additions")}::int[], ${col("deletions")}::int[], ${col("is_merge")}::boolean[],
      ${col("committed_at")}::timestamptz[]
    )
    ON CONFLICT (repo, sha) DO NOTHING
    RETURNING sha
  ` as { sha: string }[];
  return result.length;
}

/**
 * Mark PRs' commits as stored, in one statement. commit_count belongs to the
 * REST PR sync; GraphQL's totalCount only fills it for rows synced before
 * that column existed.
 */
export async function markPrCommitsSynced(
  repo: string,
  prs: { pr_number: number; total_count: number }[],
): Promise<void> {
  if (!prs.length) return;
  await ensureSchema();
  await getDb()`
    UPDATE pr_facts AS p
    SET commits_synced_at = NOW(), commit_count = COALESCE(p.commit_count, s.total_count)
    FROM unnest(${prs.map((x) => x.pr_number)}::int[], ${prs.map((x) => x.total_count)}::int[])
      AS s(pr_number, total_count)
    WHERE p.repo = ${repo} AND p.pr_number = s.pr_number
  `;
}

/**
 * Merged PRs of `repos` with merged_at in [from, to), and the non-merge
 * commits inside them. `logins` narrows the commits (case-insensitive) — one
 * person, or a person and their linked aliases; PRs are always returned for
 * the whole scope because they also measure sync coverage (the aggregation
 * narrows them). Timestamps come back as ISO strings whatever the driver returns.
 */
export async function getWorkingHabitsRows(
  repos: string[],
  from: Date,
  to: Date,
  logins: string[] | null = null,
): Promise<{ prs: WhPrRow[]; commits: WhCommitRow[] }> {
  if (!repos.length) return { prs: [], commits: [] };
  await ensureSchema();
  const db = getDb();
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const lowered = logins?.length ? logins.map((l) => l.toLowerCase()) : null;
  const [prs, commits] = (await Promise.all([
    db`
      SELECT repo, pr_number, author, merged_at, commit_count, commits_synced_at
      FROM pr_facts
      WHERE repo = ANY(${repos}::varchar[]) AND merged_at >= ${fromIso} AND merged_at < ${toIso}
    `,
    db`
      SELECT c.repo, c.sha, c.pr_number, c.author, c.author_linked, c.files, c.additions, c.deletions, c.committed_at
      FROM pr_commit_facts c
      JOIN pr_facts p ON p.repo = c.repo AND p.pr_number = c.pr_number
      WHERE p.repo = ANY(${repos}::varchar[]) AND p.merged_at >= ${fromIso} AND p.merged_at < ${toIso}
        AND NOT c.is_merge
        AND (${lowered}::text[] IS NULL OR lower(c.author) = ANY(${lowered}::text[]))
    `,
  ])) as [WhPrRow[], WhCommitRow[]];
  const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());
  return {
    prs: prs.map((p) => ({ ...p, merged_at: iso(p.merged_at)!, commits_synced_at: iso(p.commits_synced_at) })),
    commits: commits.map((c) => ({ ...c, committed_at: iso(c.committed_at) })),
  };
}

/** Latest commit sync among `repos`' PRs; null when none has run. */
export async function getLatestCommitSyncAt(repos: string[]): Promise<Date | null> {
  if (!repos.length) return null;
  await ensureSchema();
  const rows = (await getDb()`
    SELECT MAX(commits_synced_at) AS latest FROM pr_facts WHERE repo = ANY(${repos}::varchar[])
  `) as { latest: string | Date | null }[];
  return rows[0]?.latest ? new Date(rows[0].latest) : null;
}

// ── Working habits thresholds (organization mode only) ───────────────────────

export interface DbWorkingHabitsSettings {
  max_commit_files: number;
  max_commit_lines: number;
  max_pr_commits: number;
  updated_by: string | null;
  updated_at: string | null;
}

/** Null when no row exists — callers then use the defaults. */
export async function getWorkingHabitsSettings(): Promise<DbWorkingHabitsSettings | null> {
  await ensureSchema();
  const rows = (await getDb()`
    SELECT max_commit_files, max_commit_lines, max_pr_commits, updated_by, updated_at
    FROM working_habits_settings WHERE id = 1
  `) as DbWorkingHabitsSettings[];
  return rows[0] ?? null;
}

export async function saveWorkingHabitsSettings(input: {
  max_commit_files: number;
  max_commit_lines: number;
  max_pr_commits: number;
  updated_by: string | null;
}): Promise<void> {
  await ensureSchema();
  await getDb()`
    INSERT INTO working_habits_settings
      (id, max_commit_files, max_commit_lines, max_pr_commits, updated_by, updated_at)
    VALUES
      (1, ${input.max_commit_files}, ${input.max_commit_lines}, ${input.max_pr_commits},
       ${input.updated_by}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      max_commit_files = EXCLUDED.max_commit_files,
      max_commit_lines = EXCLUDED.max_commit_lines,
      max_pr_commits   = EXCLUDED.max_pr_commits,
      updated_by       = EXCLUDED.updated_by,
      updated_at       = NOW()
  `;
}

// ── Team workday (organization mode only) ────────────────────────────────────

export interface DbTeamSettings {
  timezone: string;
  workday_start: number;
  workday_end: number;
  updated_by: string | null;
  updated_at: string | null;
}

/** Null when no row exists — callers then use the defaults. */
export async function getTeamSettings(): Promise<DbTeamSettings | null> {
  await ensureSchema();
  const rows = (await getDb()`
    SELECT timezone, workday_start, workday_end, updated_by, updated_at FROM team_settings WHERE id = 1
  `) as DbTeamSettings[];
  const r = rows[0];
  return r ? { ...r, workday_start: Number(r.workday_start), workday_end: Number(r.workday_end) } : null;
}

export async function saveTeamSettings(input: {
  timezone: string;
  workday_start: number;
  workday_end: number;
  updated_by: string | null;
}): Promise<void> {
  await ensureSchema();
  await getDb()`
    INSERT INTO team_settings (id, timezone, workday_start, workday_end, updated_by, updated_at)
    VALUES (1, ${input.timezone}, ${input.workday_start}, ${input.workday_end}, ${input.updated_by}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      timezone      = EXCLUDED.timezone,
      workday_start = EXCLUDED.workday_start,
      workday_end   = EXCLUDED.workday_end,
      updated_by    = EXCLUDED.updated_by,
      updated_at    = NOW()
  `;
}

// ── Identity links (organization mode, admin only) ───────────────────────────

/**
 * Serializes link changes so the one-hop invariant (a primary is never an
 * alias) holds under concurrent requests. Same READ COMMITTED reasoning as
 * PERMISSION_LOCK_KEY: the lock is its own statement, so the guarded CTE after
 * it takes a snapshot that includes every committed change.
 */
const IDENTITY_LOCK_KEY = 718_204_553;

export interface DbIdentityLink {
  alias_login: string;
  primary_login: string;
  created_by: string | null;
  created_at: string | null;
}

export interface DbIdentityDistinct {
  login_a: string;
  login_b: string;
  created_by: string | null;
  created_at: string | null;
}

export async function listIdentityLinks(): Promise<DbIdentityLink[]> {
  await ensureSchema();
  const rows = (await getDb()`
    SELECT alias_login, primary_login, created_by, created_at FROM identity_links ORDER BY primary_login, alias_login
  `) as DbIdentityLink[];
  return rows.map((r) => ({ ...r, created_at: r.created_at ? new Date(r.created_at).toISOString() : null }));
}

export async function listIdentityDistinct(): Promise<DbIdentityDistinct[]> {
  await ensureSchema();
  const rows = (await getDb()`
    SELECT login_a, login_b, created_by, created_at FROM identity_distinct ORDER BY login_a, login_b
  `) as DbIdentityDistinct[];
  return rows.map((r) => ({ ...r, created_at: r.created_at ? new Date(r.created_at).toISOString() : null }));
}

/**
 * Link `alias` to `primary` (both lowercase), atomically:
 *  - a primary that is itself an alias resolves to its own primary (one hop);
 *  - logins currently pointing at `alias` are re-pointed to that primary;
 *  - refused (ok=false) when the resolved primary is `alias` itself (a cycle);
 *  - one audit row per alias whose primary changed, and the pair's
 *    "different people" row is removed (the admin changed their mind).
 */
export async function linkIdentity(
  actor: { id: number; login: string },
  alias: string,
  primary: string,
): Promise<{ ok: boolean; primary: string }> {
  await ensureSchema();
  const db = getDb();
  const [, rows] = await db.transaction([
    db`SELECT pg_advisory_xact_lock(${IDENTITY_LOCK_KEY})`,
    db`
      WITH resolved AS (
        SELECT COALESCE((SELECT primary_login FROM identity_links WHERE alias_login = ${primary}), ${primary}::text) AS p
      ),
      guard AS (
        SELECT (SELECT p FROM resolved) <> ${alias}::text AS ok
      ),
      before AS (
        SELECT alias_login, primary_login FROM identity_links
        WHERE alias_login = ${alias} OR primary_login = ${alias}
      ),
      repoint AS (
        UPDATE identity_links SET primary_login = (SELECT p FROM resolved)
        WHERE primary_login = ${alias} AND (SELECT ok FROM guard)
        RETURNING alias_login, primary_login
      ),
      up AS (
        INSERT INTO identity_links (alias_login, primary_login, created_by)
        SELECT ${alias}, (SELECT p FROM resolved), ${actor.login} WHERE (SELECT ok FROM guard)
        ON CONFLICT (alias_login) DO UPDATE SET
          primary_login = EXCLUDED.primary_login, created_by = EXCLUDED.created_by, created_at = NOW()
        RETURNING alias_login, primary_login
      ),
      undistinct AS (
        -- Pairs are ordered byte-wise (COLLATE "C"), matching the JS ordering in setIdentityDistinct.
        -- Both the requested and the resolved primary: either may have been dismissed before.
        DELETE FROM identity_distinct
        WHERE (SELECT ok FROM guard)
          AND (login_a, login_b) IN (
            (least(${alias}::text COLLATE "C", (SELECT p FROM resolved) COLLATE "C"),
             greatest(${alias}::text COLLATE "C", (SELECT p FROM resolved) COLLATE "C")),
            (least(${alias}::text COLLATE "C", ${primary}::text COLLATE "C"),
             greatest(${alias}::text COLLATE "C", ${primary}::text COLLATE "C"))
          )
        RETURNING 1
      ),
      audit AS (
        INSERT INTO permission_audit (actor_github_id, action, target, details)
        SELECT ${actor.id}, 'identity_link', x.alias_login,
               jsonb_build_object('before_primary', b.primary_login, 'after_primary', x.primary_login)
        FROM (SELECT * FROM up UNION ALL SELECT * FROM repoint) x
        LEFT JOIN before b ON b.alias_login = x.alias_login
        WHERE b.primary_login IS DISTINCT FROM x.primary_login
        RETURNING 1
      )
      SELECT (SELECT ok FROM guard) AS ok, (SELECT p FROM resolved) AS primary_login
    `,
  ], { isolationLevel: "ReadCommitted" }) as [unknown, { ok: boolean; primary_login: string }[]];
  return { ok: rows[0].ok, primary: rows[0].primary_login };
}

/**
 * Remove `alias`'s link. `notLinked` when there is no such alias; `isPrimary`
 * (refused) when other logins point at it — unlink those first.
 */
export async function unlinkIdentity(
  actor: { id: number; login: string },
  alias: string,
): Promise<{ ok: boolean; notLinked?: boolean; isPrimary?: boolean; before?: string }> {
  await ensureSchema();
  const db = getDb();
  const [, rows] = await db.transaction([
    db`SELECT pg_advisory_xact_lock(${IDENTITY_LOCK_KEY})`,
    db`
      WITH del AS (
        DELETE FROM identity_links WHERE alias_login = ${alias} RETURNING alias_login, primary_login
      ),
      audit AS (
        INSERT INTO permission_audit (actor_github_id, action, target, details)
        SELECT ${actor.id}, 'identity_unlink', alias_login,
               jsonb_build_object('before_primary', primary_login, 'after_primary', NULL)
        FROM del
        RETURNING 1
      )
      SELECT (SELECT primary_login FROM del) AS before,
             EXISTS (SELECT 1 FROM identity_links WHERE primary_login = ${alias}) AS is_primary
    `,
  ], { isolationLevel: "ReadCommitted" }) as [unknown, { before: string | null; is_primary: boolean }[]];
  const r = rows[0];
  if (r.before) return { ok: true, before: r.before };
  return r.is_primary ? { ok: false, isPrimary: true } : { ok: false, notLinked: true };
}

/**
 * Record (or, with `distinct` false, remove) "these two logins are different
 * people". Refused (ok=false) while the two are linked. Audited when changed.
 */
export async function setIdentityDistinct(
  actor: { id: number; login: string },
  a: string,
  b: string,
  distinct: boolean,
): Promise<{ ok: boolean; changed: boolean }> {
  await ensureSchema();
  const db = getDb();
  // Byte-wise order, the same as the table's CHECK (login_a < login_b COLLATE "C").
  const [loginA, loginB] = a < b ? [a, b] : [b, a];
  const [, rows] = await db.transaction([
    db`SELECT pg_advisory_xact_lock(${IDENTITY_LOCK_KEY})`,
    db`
      WITH canon AS (
        SELECT
          COALESCE((SELECT primary_login FROM identity_links WHERE alias_login = ${loginA}), ${loginA}::text) AS ca,
          COALESCE((SELECT primary_login FROM identity_links WHERE alias_login = ${loginB}), ${loginB}::text) AS cb
      ),
      guard AS (
        SELECT NOT (${distinct}::boolean AND (SELECT ca = cb FROM canon)) AS ok
      ),
      ins AS (
        INSERT INTO identity_distinct (login_a, login_b, created_by)
        SELECT ${loginA}, ${loginB}, ${actor.login} WHERE ${distinct}::boolean AND (SELECT ok FROM guard)
        ON CONFLICT DO NOTHING
        RETURNING 1
      ),
      del AS (
        DELETE FROM identity_distinct
        WHERE NOT ${distinct}::boolean AND login_a = ${loginA} AND login_b = ${loginB}
        RETURNING 1
      ),
      audit AS (
        INSERT INTO permission_audit (actor_github_id, action, target, details)
        SELECT ${actor.id}, CASE WHEN ${distinct}::boolean THEN 'identity_distinct' ELSE 'identity_distinct_undo' END,
               ${loginA + " + " + loginB}, jsonb_build_object('before', NOT ${distinct}::boolean, 'after', ${distinct}::boolean)
        WHERE EXISTS (SELECT 1 FROM ins) OR EXISTS (SELECT 1 FROM del)
        RETURNING 1
      )
      SELECT (SELECT ok FROM guard) AS ok, (EXISTS (SELECT 1 FROM ins) OR EXISTS (SELECT 1 FROM del)) AS changed
    `,
  ], { isolationLevel: "ReadCommitted" }) as [unknown, { ok: boolean; changed: boolean }[]];
  return { ok: rows[0].ok, changed: rows[0].changed };
}

// ── Sync cursor ───────────────────────────────────────────────────────────────

export async function getSyncCursor(repo: string): Promise<number | null> {
  await ensureSchema();
  const rows = await getDb()`
    SELECT last_run_id FROM sync_cursors WHERE repo = ${repo}
  ` as { last_run_id: number | null }[];
  return rows[0]?.last_run_id ?? null;
}

export async function updateSyncCursor(repo: string, lastRunId: number): Promise<void> {
  await ensureSchema();
  await getDb()`
    INSERT INTO sync_cursors (repo, last_run_id, last_synced_at)
    VALUES (${repo}, ${lastRunId}, NOW())
    ON CONFLICT (repo) DO UPDATE SET
      last_run_id    = EXCLUDED.last_run_id,
      last_synced_at = NOW()
  `;
}

/**
 * All repos that have ever been synced (i.e. someone clicked "Sync from
 * GitHub" or the repo was upserted via webhook at least once). This is the
 * durable list of "tracked" repos — the scheduled cron job re-syncs exactly
 * this set, so a repo opts into background sync by being synced once.
 */
export async function listSyncedRepos(): Promise<{ repo: string; last_synced_at: string | null }[]> {
  await ensureSchema();
  return await getDb()`
    SELECT repo, last_synced_at FROM sync_cursors ORDER BY repo
  ` as { repo: string; last_synced_at: string | null }[];
}

// ── PR facts sync cursor ──────────────────────────────────────────────────────

export async function getPrSyncCursor(
  repo: string,
): Promise<{ cursor: string | null; backfillComplete: boolean; backfillPage: number | null }> {
  await ensureSchema();
  const rows = await getDb()`
    SELECT pr_sync_cursor, pr_backfill_complete, pr_backfill_page
    FROM sync_cursors
    WHERE repo = ${repo}
  ` as { pr_sync_cursor: string | Date | null; pr_backfill_complete: boolean; pr_backfill_page: number | null }[];
  if (!rows.length) return { cursor: null, backfillComplete: false, backfillPage: null };
  const c = rows[0].pr_sync_cursor;
  return {
    cursor: c === null ? null : new Date(c).toISOString(),
    backfillComplete: rows[0].pr_backfill_complete,
    backfillPage: rows[0].pr_backfill_page,
  };
}

/**
 * Save PR-sync state. `backfillPage` is the next page to read while the
 * backfill is incomplete (null once complete). UPDATE-only: never creates a
 * sync_cursors row — PR-facts sync only runs for repos already enrolled by
 * updateSyncCursor (run-sync path).
 */
export async function updatePrSyncCursor(
  repo: string,
  cursor: string | null,
  backfillComplete: boolean,
  backfillPage: number | null = null,
): Promise<void> {
  await ensureSchema();
  await getDb()`
    UPDATE sync_cursors
    SET pr_sync_cursor = ${cursor}, pr_backfill_complete = ${backfillComplete},
        pr_backfill_page = ${backfillPage}
    WHERE repo = ${repo}
  `;
}

// ── Historical queries ────────────────────────────────────────────────────────

export async function getDbRuns(
  repo: string,
  limit = 200,
  offset = 0,
  conclusion?: string,
): Promise<DbWorkflowRun[]> {
  await ensureSchema();
  if (conclusion) {
    return await getDb()`
      SELECT * FROM workflow_runs
      WHERE repo = ${repo} AND conclusion = ${conclusion}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    ` as DbWorkflowRun[];
  }
  return await getDb()`
    SELECT * FROM workflow_runs
    WHERE repo = ${repo}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  ` as DbWorkflowRun[];
}

export async function getDbRunCount(repo: string): Promise<number> {
  await ensureSchema();
  const rows = await getDb()`
    SELECT COUNT(*)::int AS cnt FROM workflow_runs WHERE repo = ${repo}
  ` as { cnt: number }[];
  return rows[0]?.cnt ?? 0;
}

export async function getDailyTrends(
  repo: string,
  days = 90,
): Promise<DbDailyTrend[]> {
  await ensureSchema();
  const rows = await getDb()`
    SELECT
      DATE(created_at)::text                                        AS date,
      COUNT(*)::int                                                 AS total,
      COUNT(*) FILTER (WHERE conclusion = 'success')::int           AS success,
      COUNT(*) FILTER (WHERE conclusion = 'failure')::int           AS failure,
      AVG(duration_ms) FILTER (WHERE duration_ms > 0)::int          AS avg_duration_ms,
      AVG(queue_wait_ms) FILTER (WHERE queue_wait_ms > 0)::int      AS avg_queue_ms
    FROM workflow_runs
    WHERE repo = ${repo}
      AND created_at >= NOW() - (${days} || ' days')::INTERVAL
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;
  return rows as DbDailyTrend[];
}

export async function getQuarterlySummary(
  repo: string,
  quartersBack = 6,
): Promise<DbQuarterSummary[]> {
  await ensureSchema();
  const months = quartersBack * 3;
  const rows = await getDb()`
    SELECT
      EXTRACT(YEAR FROM created_at)::int    AS year,
      EXTRACT(QUARTER FROM created_at)::int AS quarter_num,
      ('Q' || EXTRACT(QUARTER FROM created_at)::int
       || ' ' || EXTRACT(YEAR FROM created_at)::int) AS quarter,
      COUNT(*)::int                         AS total,
      COUNT(*) FILTER (WHERE conclusion = 'success')::int AS success,
      COUNT(*) FILTER (WHERE conclusion = 'failure')::int AS failure,
      CASE WHEN COUNT(*) > 0
        THEN ROUND(COUNT(*) FILTER (WHERE conclusion = 'success') * 100.0 / COUNT(*), 1)
        ELSE 0
      END::float                            AS success_rate,
      AVG(duration_ms) FILTER (WHERE duration_ms > 0)::int AS avg_duration_ms
    FROM workflow_runs
    WHERE repo = ${repo}
      AND created_at >= NOW() - (${months} || ' months')::INTERVAL
    GROUP BY year, quarter_num, quarter
    ORDER BY year, quarter_num
  `;
  return rows as DbQuarterSummary[];
}

export async function getOrgDailyTrends(
  orgPrefix: string,
  days = 90,
): Promise<DbDailyTrend[]> {
  await ensureSchema();
  const pattern = orgPrefix + "/%";
  const rows = await getDb()`
    SELECT
      DATE(created_at)::text                                        AS date,
      COUNT(*)::int                                                 AS total,
      COUNT(*) FILTER (WHERE conclusion = 'success')::int           AS success,
      COUNT(*) FILTER (WHERE conclusion = 'failure')::int           AS failure,
      AVG(duration_ms) FILTER (WHERE duration_ms > 0)::int          AS avg_duration_ms,
      AVG(queue_wait_ms) FILTER (WHERE queue_wait_ms > 0)::int      AS avg_queue_ms
    FROM workflow_runs
    WHERE repo LIKE ${pattern}
      AND created_at >= NOW() - (${days} || ' days')::INTERVAL
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;
  return rows as DbDailyTrend[];
}

// ── Alert rules ───────────────────────────────────────────────────────────────

export async function getAlertRules(scope: string): Promise<DbAlertRule[]> {
  await ensureSchema();
  return await getDb()`
    SELECT * FROM alert_rules WHERE scope = ${scope} ORDER BY id
  ` as DbAlertRule[];
}

export async function getAllAlertRules(): Promise<DbAlertRule[]> {
  await ensureSchema();
  return await getDb()`SELECT * FROM alert_rules ORDER BY scope, id` as DbAlertRule[];
}

/**
 * "leadership_digest" rules (v4.0.3) are a config store, not a normal
 * threshold rule — the alert_rules table/UI is reused (no new migration),
 * but these must never go through evaluateAlertRulesForRepo's per-repo-sync
 * evaluation (that would fire the digest once per repo per day, not once
 * per week). The cron calls this directly on its weekly cadence instead.
 */
export async function getLeadershipDigestRules(): Promise<DbAlertRule[]> {
  await ensureSchema();
  return await getDb()`
    SELECT * FROM alert_rules
    WHERE metric = 'leadership_digest' AND enabled = TRUE
    ORDER BY scope, id
  ` as DbAlertRule[];
}

export async function createAlertRule(
  rule: Omit<DbAlertRule, "id" | "created_at" | "muted_until" | "owner_note">
): Promise<DbAlertRule> {
  await ensureSchema();
  const rows = await getDb()`
    INSERT INTO alert_rules (scope, metric, threshold, window_hours, channel, destination, enabled)
    VALUES (${rule.scope}, ${rule.metric}, ${rule.threshold}, ${rule.window_hours},
            ${rule.channel}, ${rule.destination}, ${rule.enabled})
    RETURNING *
  `;
  return (rows as DbAlertRule[])[0];
}

export async function updateAlertRule(
  id: number,
  patch: { enabled?: boolean; muted_until?: string | null; owner_note?: string | null },
): Promise<DbAlertRule | null> {
  await ensureSchema();
  // Build partial update
  if (patch.enabled !== undefined) {
    await getDb()`UPDATE alert_rules SET enabled = ${patch.enabled} WHERE id = ${id}`;
  }
  if (patch.muted_until !== undefined) {
    await getDb()`UPDATE alert_rules SET muted_until = ${patch.muted_until} WHERE id = ${id}`;
  }
  if (patch.owner_note !== undefined) {
    await getDb()`UPDATE alert_rules SET owner_note = ${patch.owner_note} WHERE id = ${id}`;
  }
  const rows = await getDb()`SELECT * FROM alert_rules WHERE id = ${id}`;
  return (rows as DbAlertRule[])[0] ?? null;
}

export async function deleteAlertRule(id: number): Promise<void> {
  await ensureSchema();
  await getDb()`DELETE FROM alert_rules WHERE id = ${id}`;
}

export async function getAlertEvents(
  scope: string,
  limit = 50,
): Promise<DbAlertEvent[]> {
  await ensureSchema();
  return await getDb()`
    SELECT * FROM alert_events
    WHERE scope = ${scope}
    ORDER BY fired_at DESC
    LIMIT ${limit}
  ` as DbAlertEvent[];
}

export async function getRecentAlertEvents(limit = 100): Promise<DbAlertEvent[]> {
  await ensureSchema();
  return await getDb()`
    SELECT * FROM alert_events ORDER BY fired_at DESC LIMIT ${limit}
  ` as DbAlertEvent[];
}

export async function fireAlertEvent(
  ruleId: number | null,
  scope: string,
  metric: string,
  value: number | null,
  details: Record<string, unknown>,
  provenance?: {
    source: string;
    window_hours: number;
    sample_size: number;
    computed_at: string;
  },
): Promise<void> {
  await ensureSchema();
  const detailsJson = JSON.stringify(details);
  const source = provenance?.source ?? null;
  const windowHours = provenance?.window_hours ?? null;
  const sampleSize = provenance?.sample_size ?? null;
  const computedAt = provenance?.computed_at ?? null;

  await getDb()`
    INSERT INTO alert_events
      (rule_id, scope, metric, value, details, source, window_hours, sample_size, computed_at, delivery_status)
    VALUES
      (${ruleId}, ${scope}, ${metric}, ${value}, ${detailsJson}::jsonb,
       ${source}, ${windowHours}, ${sampleSize}, ${computedAt}, 'pending')
  `;
}

// ── Digest delivery ───────────────────────────────────────────────────────────

/**
 * Events fired by "digest"-channel rules that haven't been folded into a
 * digest email yet. Delivery for these rules is deferred at fire-time
 * (see notifier.ts dispatchAlert) — this is what the daily cron sends.
 */
export async function getPendingDigestEvents(): Promise<PendingDigestEvent[]> {
  await ensureSchema();
  return await getDb()`
    SELECT ae.*, ar.destination
    FROM alert_events ae
    JOIN alert_rules ar ON ar.id = ae.rule_id
    WHERE ar.channel = 'digest'
      AND ae.digest_sent_at IS NULL
    ORDER BY ae.fired_at DESC
  ` as PendingDigestEvent[];
}

export async function markDigestSent(eventIds: number[]): Promise<void> {
  if (!eventIds.length) return;
  await ensureSchema();
  await getDb()`UPDATE alert_events SET digest_sent_at = NOW() WHERE id = ANY(${eventIds})`;
}

export async function updateAlertEventDeliveryStatus(
  eventId: number,
  status: "pending" | "sent" | "failed" | "retrying",
): Promise<void> {
  await ensureSchema();
  await getDb()`UPDATE alert_events SET delivery_status = ${status} WHERE id = ${eventId}`;
}

// ── Alert rule evaluation ─────────────────────────────────────────────────────

/**
 * Metrics computed from pr_commit_facts. They are evaluated by the
 * /api/cron/sync-commit-facts cron right after that repo's commit sync (with
 * `only`), never by the default call from the 03:17 run sync, which would
 * see the previous night's data.
 */
export const COMMIT_FACT_METRICS = ["oversized_commit_pct"];

/**
 * Evaluates all enabled, non-muted alert rules for `repoKey`.
 * People-based metrics now use the pr_facts table instead of workflow_runs proxies.
 * `only` restricts evaluation to those metrics; without it, COMMIT_FACT_METRICS
 * are skipped. Returns the number of new events fired.
 */
export async function evaluateAlertRulesForRepo(
  repoKey: string,
  opts: { only?: string[] } = {},
): Promise<number> {
  await ensureSchema();

  const parts = repoKey.split("/");
  const orgScope  = parts[0] ? `org:${parts[0]}` : null;
  const repoScope = `repo:${repoKey}`;
  const scopes = [repoScope, ...(orgScope ? [orgScope] : [])];

  const rules: DbAlertRule[] = [];
  for (const s of scopes) {
    // leadership_digest rules are excluded here — they're a config store
    // evaluated weekly by the cron directly (getLeadershipDigestRules),
    // never per-repo-sync (see that function's doc comment for why).
    const r = await getDb()`
      SELECT * FROM alert_rules
      WHERE scope = ${s}
        AND enabled = TRUE
        AND metric != 'leadership_digest'
        AND (muted_until IS NULL OR muted_until < NOW())
    ` as DbAlertRule[];
    rules.push(...r.filter((rule) =>
      opts.only ? opts.only.includes(rule.metric) : !COMMIT_FACT_METRICS.includes(rule.metric)));
  }

  if (!rules.length) return 0;
  // Check pr_backfill_complete once per repo — used to gate the 4 pr_facts-backed metrics
  const prBackfillRow = await getPrSyncCursor(repoKey);
  const prBackfillComplete = prBackfillRow.backfillComplete;

  let fired = 0;

  for (const rule of rules) {
    // De-duplicate within window
    const recent = await getDb()`
      SELECT id FROM alert_events
      WHERE rule_id = ${rule.id}
        AND fired_at >= NOW() - (${rule.window_hours} || ' hours')::INTERVAL
      LIMIT 1
    ` as { id: number }[];
    if (recent.length > 0) continue;

    let value: number | null = null;
    let sampleSize = 0;
    const source = "db";
    const computedAt = new Date().toISOString();

    if (rule.metric === "failure_rate") {
      const rows = await getDb()`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE conclusion = 'failure')::int AS failures
        FROM workflow_runs
        WHERE repo = ${repoKey}
          AND status = 'completed'
          AND created_at >= NOW() - (${rule.window_hours} || ' hours')::INTERVAL
      ` as { total: number; failures: number }[];
      const row = rows[0];
      if (row && row.total > 0) {
        sampleSize = row.total;
        value = Math.round((row.failures / row.total) * 100);
      }
    } else if (rule.metric === "duration_p95") {
      const rows = await getDb()`
        SELECT
          COUNT(*)::int AS total,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95
        FROM workflow_runs
        WHERE repo = ${repoKey}
          AND duration_ms > 0
          AND created_at >= NOW() - (${rule.window_hours} || ' hours')::INTERVAL
      ` as { total: number; p95: number | null }[];
      const row = rows[0];
      if (row?.p95 !== null && row?.p95 !== undefined) {
        sampleSize = row.total;
        value = Math.round(row.p95 / 60000);
      }
    } else if (rule.metric === "queue_wait_p95") {
      const rows = await getDb()`
        SELECT
          COUNT(*)::int AS total,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY queue_wait_ms)::int AS p95
        FROM workflow_runs
        WHERE repo = ${repoKey}
          AND queue_wait_ms > 0
          AND created_at >= NOW() - (${rule.window_hours} || ' hours')::INTERVAL
      ` as { total: number; p95: number | null }[];
      const row = rows[0];
      if (row?.p95 !== null && row?.p95 !== undefined) {
        sampleSize = row.total;
        value = Math.round(row.p95 / 60000);
      }
    } else if (rule.metric === "success_streak") {
      const rows = await getDb()`
        SELECT conclusion FROM workflow_runs
        WHERE repo = ${repoKey}
          AND status = 'completed'
        ORDER BY created_at DESC
        LIMIT 100
      ` as { conclusion: string | null }[];
      let streak = 0;
      for (const r of rows) {
        if (r.conclusion === "failure") streak++;
        else break;
      }
      sampleSize = rows.length;
      value = streak;

    // ── People-based metrics (pr_facts-backed) ───────────────────────────────

    } else if (rule.metric === "pr_throughput_drop") {
      if (!prBackfillComplete) { /* value remains null — skip silently */ } else {
      const rows = await getDb()`
        SELECT
          COUNT(*) FILTER (
            WHERE merged_at >= NOW() - (${rule.window_hours} || ' hours')::INTERVAL
          )::int AS current_count,
          COUNT(*) FILTER (
            WHERE merged_at >= NOW() - (${rule.window_hours * 2} || ' hours')::INTERVAL
              AND merged_at < NOW() - (${rule.window_hours} || ' hours')::INTERVAL
          )::int AS prior_count
        FROM pr_facts
        WHERE repo = ${repoKey}
          AND merged_at IS NOT NULL
      ` as { current_count: number; prior_count: number }[];
      const row = rows[0];
      if (row && row.prior_count > 0) {
        sampleSize = row.prior_count + row.current_count;
        const drop = Math.round(((row.prior_count - row.current_count) / row.prior_count) * 100);
        value = Math.max(0, drop);
      }
      }

    } else if (rule.metric === "review_response_p90") {
      if (!prBackfillComplete) { /* value remains null — skip silently */ } else {
      // Time-to-first-review in hours from pr_facts
      const rows = await getDb()`
        SELECT
          COUNT(*)::int AS total,
          PERCENTILE_CONT(0.90) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (first_review_at - created_at))
          )::float AS p90_seconds
        FROM pr_facts
        WHERE repo = ${repoKey}
          AND first_review_at IS NOT NULL
          AND merged_at >= NOW() - (${rule.window_hours} || ' hours')::INTERVAL
      ` as { total: number; p90_seconds: number | null }[];
      const row = rows[0];
      if (row?.p90_seconds !== null && row?.p90_seconds !== undefined) {
        sampleSize = row.total;
        value = Math.round(row.p90_seconds / 3600);
      }
      }

    } else if (rule.metric === "afterhours_commit_pct") {
      const rows = await getDb()`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE EXTRACT(HOUR FROM created_at) < 9
               OR EXTRACT(HOUR FROM created_at) >= 18
          )::int AS afterhours
        FROM workflow_runs
        WHERE repo = ${repoKey}
          AND status = 'completed'
          AND created_at >= NOW() - (${rule.window_hours} || ' hours')::INTERVAL
      ` as { total: number; afterhours: number }[];
      const row = rows[0];
      if (row && row.total > 0) {
        sampleSize = row.total;
        value = Math.round((row.afterhours / row.total) * 100);
      }

    } else if (rule.metric === "pr_abandon_rate") {
      if (!prBackfillComplete) { /* value remains null — skip silently */ } else {
      // Closed-without-merge PRs from pr_facts
      const rows = await getDb()`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE state = 'closed' AND merged_at IS NULL)::int AS abandoned
        FROM pr_facts
        WHERE repo = ${repoKey}
          AND closed_at >= NOW() - (${rule.window_hours} || ' hours')::INTERVAL
      ` as { total: number; abandoned: number }[];
      const row = rows[0];
      if (row && row.total > 0) {
        sampleSize = row.total;
        value = Math.round((row.abandoned / row.total) * 100);
      }
      }

    } else if (rule.metric === "unreviewed_pr_age") {
      if (!prBackfillComplete) { /* value remains null — skip silently */ } else {
      // Max age in days of open PRs without any review
      const rows = await getDb()`
        SELECT MAX(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400)::int AS max_age_days,
               COUNT(*)::int AS total
        FROM pr_facts
        WHERE repo = ${repoKey}
          AND state = 'open'
          AND (review_count IS NULL OR review_count = 0)
      ` as { max_age_days: number | null; total: number }[];
      sampleSize = rows[0]?.total ?? 0;
      value = rows[0]?.max_age_days ?? null;
      }

    } else if (rule.metric === "oversized_commit_pct") {
      // Same calculation as the Team insights page (src/lib/working-habits.ts).
      // Fires only on a fully analysed window with enough commits to mean something.
      if (!prBackfillComplete) { /* value remains null — skip silently */ } else {
      const { computeWorkingHabits, ALERT_MIN_COMMITS } = await import("./working-habits");
      const to = new Date();
      const from = new Date(to.getTime() - rule.window_hours * 3_600_000);
      const wh = await computeWorkingHabits({ repos: [repoKey], from, to });
      if (wh.coverage.complete && wh.totals.commits >= ALERT_MIN_COMMITS) {
        sampleSize = wh.totals.commits;
        value = Math.round((wh.totals.oversizedCommits / wh.totals.commits) * 100);
      }
      }

    } else if (rule.metric === "anomaly_count") {
      // Statistical outliers (duration/queue-wait > 2 stddev from rolling
      // baseline) among completed runs in the window — reuses the same
      // detector the workflow detail page uses client-side (src/lib/anomaly.ts).
      const rows = await getDb()`
        SELECT id, run_number, duration_ms, queue_wait_ms
        FROM workflow_runs
        WHERE repo = ${repoKey}
          AND status = 'completed'
          AND created_at >= NOW() - (${rule.window_hours} || ' hours')::INTERVAL
        ORDER BY created_at DESC
        LIMIT 200
      ` as { id: number; run_number: number | null; duration_ms: number | null; queue_wait_ms: number | null }[];
      if (rows.length > 0) {
        sampleSize = rows.length;
        const anomalies = detectAnomalies(rows);
        value = Array.from(anomalies.values()).filter((a) => a.hasAnomaly).length;
      }
    }

    if (value === null) continue;

    if (value >= rule.threshold) {
      const details = {
        repo: repoKey,
        threshold: rule.threshold,
        window_hours: rule.window_hours,
        triggered_at: computedAt,
      };
      await fireAlertEvent(rule.id, rule.scope, rule.metric, value, details, {
        source,
        window_hours: rule.window_hours,
        sample_size: sampleSize,
        computed_at: computedAt,
      });
      fired++;

      // Deliver via unified notifier (best-effort, non-blocking)
      const payload = buildPayload(rule, repoKey, value);
      dispatchAlert(payload).then((result) => {
        if (!result.ok) {
          console.error(`[alerts] Delivery failed for rule ${rule.id}: ${result.error}`);
        }
      }).catch((e) => {
        console.error("[alerts] Delivery error:", e);
      });
    }
  }

  return fired;
}

// Re-export for backward compatibility
export { _METRIC_LABELS as METRIC_LABELS };

// ── Email settings (v4.1.3) ───────────────────────────────────────────────────

export type EmailProvider = "resend" | "sendgrid";

export interface DbEmailSettings {
  enabled: boolean;
  provider: EmailProvider;
  api_key_sealed: string | null;
  api_key_hint: string | null;
  from_address: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

/**
 * Read the instance email config. Returns null when the table has no row yet
 * (nobody has configured it) — callers then fall back to environment
 * variables, so upgrading to v4.1.3 never breaks a working env-var setup.
 */
export async function getEmailSettings(): Promise<DbEmailSettings | null> {
  await ensureSchema();
  const rows = (await getDb()`
    SELECT enabled, provider, api_key_sealed, api_key_hint,
           from_address, updated_by, updated_at
    FROM email_settings WHERE id = 1
  `) as DbEmailSettings[];
  return rows[0] ?? null;
}

/**
 * Upsert the singleton row.
 *
 * `api_key_sealed` is only written when a new key is supplied — passing
 * undefined preserves the stored one, which is what lets the UI show a masked
 * field and treat "left blank" as "unchanged" without ever round-tripping the
 * secret through the browser.
 */
export async function saveEmailSettings(input: {
  enabled: boolean;
  provider: EmailProvider;
  from_address: string | null;
  updated_by: string | null;
  api_key_sealed?: string;
  api_key_hint?: string;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();

  if (input.api_key_sealed !== undefined) {
    await db`
      INSERT INTO email_settings
        (id, enabled, provider, api_key_sealed, api_key_hint, from_address, updated_by, updated_at)
      VALUES
        (1, ${input.enabled}, ${input.provider}, ${input.api_key_sealed},
         ${input.api_key_hint ?? null}, ${input.from_address}, ${input.updated_by}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        provider = EXCLUDED.provider,
        api_key_sealed = EXCLUDED.api_key_sealed,
        api_key_hint = EXCLUDED.api_key_hint,
        from_address = EXCLUDED.from_address,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
    `;
    return;
  }

  await db`
    INSERT INTO email_settings
      (id, enabled, provider, from_address, updated_by, updated_at)
    VALUES
      (1, ${input.enabled}, ${input.provider}, ${input.from_address}, ${input.updated_by}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      provider = EXCLUDED.provider,
      from_address = EXCLUDED.from_address,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
  `;
}

// ── AI settings (v4.1.5, organization mode only) ──────────────────────────────

export type AiSettingsProvider = "bailian" | "gemini" | "qwen";

export interface DbAiSettings {
  enabled: boolean;
  provider: AiSettingsProvider;
  model: string | null;
  base_url: string | null;
  api_key_sealed: string | null;
  api_key_hint: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

/** Null when no row exists — callers then fall back to environment defaults. */
export async function getAiSettings(): Promise<DbAiSettings | null> {
  await ensureSchema();
  const rows = (await getDb()`
    SELECT enabled, provider, model, base_url, api_key_sealed, api_key_hint,
           updated_by, updated_at
    FROM ai_settings WHERE id = 1
  `) as DbAiSettings[];
  return rows[0] ?? null;
}

/**
 * Upsert the singleton row. Omitting api_key_sealed preserves the stored key,
 * which is what lets the UI treat a blank field as "unchanged" without ever
 * returning the secret to the browser.
 */
export async function saveAiSettings(input: {
  enabled: boolean;
  provider: AiSettingsProvider;
  model: string | null;
  base_url: string | null;
  updated_by: string | null;
  api_key_sealed?: string;
  api_key_hint?: string;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();

  if (input.api_key_sealed !== undefined) {
    await db`
      INSERT INTO ai_settings
        (id, enabled, provider, model, base_url, api_key_sealed, api_key_hint, updated_by, updated_at)
      VALUES
        (1, ${input.enabled}, ${input.provider}, ${input.model}, ${input.base_url},
         ${input.api_key_sealed}, ${input.api_key_hint ?? null}, ${input.updated_by}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        provider = EXCLUDED.provider,
        model = EXCLUDED.model,
        base_url = EXCLUDED.base_url,
        api_key_sealed = EXCLUDED.api_key_sealed,
        api_key_hint = EXCLUDED.api_key_hint,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
    `;
    return;
  }

  await db`
    INSERT INTO ai_settings
      (id, enabled, provider, model, base_url, updated_by, updated_at)
    VALUES
      (1, ${input.enabled}, ${input.provider}, ${input.model}, ${input.base_url},
       ${input.updated_by}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      provider = EXCLUDED.provider,
      model = EXCLUDED.model,
      base_url = EXCLUDED.base_url,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
  `;
}

// ── Users (organization-mode access control) ──────────────────────────────────

export interface DbUser {
  github_id: number;
  login: string;
  avatar_url: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

/** Record a successful org-mode login (insert, or refresh login/avatar/last seen). */
export async function upsertUser(u: { id: number; login: string; avatar_url: string | null }): Promise<void> {
  await ensureSchema();
  await getDb()`
    INSERT INTO users (github_id, login, avatar_url, last_seen_at)
    VALUES (${u.id}, ${u.login}, ${u.avatar_url}, NOW())
    ON CONFLICT (github_id) DO UPDATE
      SET login = EXCLUDED.login, avatar_url = EXCLUDED.avatar_url, last_seen_at = NOW()
  `;
}


/**
 * Delete users who never received a group and have not signed in for 30 days,
 * so abandoned sign-ups do not pile up in the admin "pending" list. The audit
 * log keeps any history. Returns the number removed.
 */
export async function pruneStalePendingUsers(): Promise<number> {
  await ensureSchema();
  const rows = await getDb()`
    DELETE FROM users u
    WHERE u.last_seen_at < NOW() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM user_groups g WHERE g.github_id = u.github_id)
    RETURNING github_id
  ` as { github_id: number }[];
  return rows.length;
}

/**
 * MCP OAuth retention, one statement: delete used-code ids past their expiry,
 * grants whose code was never redeemed within 10 minutes, and grants revoked
 * more than 90 days ago. Returns the number of rows removed from each.
 */
export async function pruneMcpRetention(): Promise<{ used_jti: number; unredeemed: number; revoked: number }> {
  await ensureSchema();
  const [row] = await getDb()`
    WITH j AS (
      -- A minute past expiry: open() still accepts a code up to 5 s late, and its
      -- used-id row must outlive that so a replay is still recognised.
      DELETE FROM mcp_used_jti WHERE expires_at < NOW() - INTERVAL '1 minute' RETURNING 1
    ), u AS (
      DELETE FROM mcp_grants
      WHERE redeemed_at IS NULL AND created_at < NOW() - INTERVAL '10 minutes'
      RETURNING 1
    ), r AS (
      DELETE FROM mcp_grants
      WHERE redeemed_at IS NOT NULL
        AND (revoked_at < NOW() - INTERVAL '90 days' OR absolute_expiry < NOW() - INTERVAL '90 days')
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM j)::int AS used_jti,
           (SELECT count(*) FROM u)::int AS unredeemed,
           (SELECT count(*) FROM r)::int AS revoked
  ` as { used_jti: number; unredeemed: number; revoked: number }[];
  return row;
}

/** Groups stored for a user (bootstrap admins are added by src/lib/permissions.ts). */
export async function getUserGroups(githubId: number): Promise<string[]> {
  await ensureSchema();
  const rows = await getDb()`
    SELECT group_name FROM user_groups WHERE github_id = ${githubId}
  ` as { group_name: string }[];
  return rows.map((r) => r.group_name);
}

/** Flags granted to any of the given groups. */
export async function getGroupFlags(groups: string[]): Promise<string[]> {
  if (!groups.length) return [];
  await ensureSchema();
  const rows = await getDb()`
    SELECT DISTINCT flag_key FROM group_flags WHERE group_name = ANY(${groups})
  ` as { flag_key: string }[];
  return rows.map((r) => r.flag_key);
}

// ── Admin: users, grants, audit (organization mode) ──────────────────────────

/**
 * Serializes permission changes so the "never zero admins" guard sees committed
 * state. Relies on READ COMMITTED (pinned on each transaction): the guard
 * statement then takes a fresh snapshot after the lock is granted.
 */
const PERMISSION_LOCK_KEY = 718_204_552;

export interface AdminUserRow {
  github_id: number;
  login: string;
  avatar_url: string | null;
  first_seen_at: string;
  last_seen_at: string;
  groups: string[];
}

/** Users with their groups; users without any group ("pending") first, then by login. */
export async function listUsers(opts: { q?: string; group?: string; limit?: number; offset?: number } = {}): Promise<AdminUserRow[]> {
  await ensureSchema();
  const q = opts.q ? `%${opts.q.replace(/[\\%_]/g, (c) => "\\" + c)}%` : null;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = await getDb()`
    SELECT u.github_id, u.login, u.avatar_url, u.first_seen_at, u.last_seen_at,
           COALESCE(array_agg(g.group_name::text ORDER BY g.group_name) FILTER (WHERE g.group_name IS NOT NULL), '{}') AS groups
    FROM users u
    LEFT JOIN user_groups g ON g.github_id = u.github_id
    WHERE (${q}::text IS NULL OR u.login ILIKE ${q})
    GROUP BY u.github_id
    HAVING (${opts.group ?? null}::text IS NULL OR ${opts.group ?? null}::text = ANY(array_agg(g.group_name::text)))
    ORDER BY (COUNT(g.group_name) = 0) DESC, u.login
    LIMIT ${limit} OFFSET ${offset}
  ` as AdminUserRow[];
  return rows.map((r) => ({ ...r, github_id: Number(r.github_id) }));
}

/**
 * Replace a user's groups and write one audit row, atomically. Refuses (returns
 * ok=false) a change that would leave no admin at all when there are no
 * bootstrap admins. The advisory lock runs as its own statement first so the
 * guard's count sees every committed change (READ COMMITTED takes a fresh
 * snapshot per statement).
 */
export async function setUserGroups(
  actorId: number,
  githubId: number,
  groups: string[],
  bootstrapAdminIds: number[],
): Promise<{ ok: boolean; before: string[]; after: string[] }> {
  await ensureSchema();
  const db = getDb();
  const after = [...new Set(groups)].sort();
  const [, rows] = await db.transaction([
    db`SELECT pg_advisory_xact_lock(${PERMISSION_LOCK_KEY})`,
    db`
      WITH before AS (
        SELECT COALESCE(array_agg(group_name::text ORDER BY group_name), '{}') AS g
        FROM user_groups WHERE github_id = ${githubId}
      ),
      guard AS (
        SELECT NOT (
          (SELECT 'admin' = ANY(g) FROM before)
          AND NOT ('admin' = ANY(${after}::text[]))
          AND (SELECT count(*) FROM user_groups WHERE group_name = 'admin' AND github_id <> ${githubId}) = 0
          AND cardinality(${bootstrapAdminIds}::bigint[]) = 0
        ) AS ok
      ),
      del AS (
        DELETE FROM user_groups
        WHERE github_id = ${githubId} AND (SELECT ok FROM guard) AND NOT (group_name = ANY(${after}::text[]))
        RETURNING 1
      ),
      ins AS (
        INSERT INTO user_groups (github_id, group_name)
        SELECT ${githubId}, x FROM unnest(${after}::text[]) AS x WHERE (SELECT ok FROM guard)
        ON CONFLICT DO NOTHING
        RETURNING 1
      ),
      audit AS (
        INSERT INTO permission_audit (actor_github_id, action, target, details)
        SELECT ${actorId}, 'user_groups_set', ${String(githubId)},
               jsonb_build_object('before', (SELECT g FROM before), 'after', ${after}::text[])
        WHERE (SELECT ok FROM guard) AND (SELECT g FROM before) IS DISTINCT FROM ${after}::text[]
        RETURNING 1
      )
      SELECT (SELECT ok FROM guard) AS ok, (SELECT g FROM before) AS before
    `,
  ], { isolationLevel: "ReadCommitted" }) as [unknown, { ok: boolean; before: string[] }[]];
  return { ok: rows[0].ok, before: rows[0].before, after };
}

export interface GrantRow {
  group_name: string;
  flag_key: string;
}

export async function listGrants(): Promise<GrantRow[]> {
  await ensureSchema();
  return await getDb()`SELECT group_name, flag_key FROM group_flags ORDER BY group_name, flag_key` as GrantRow[];
}

/** Grant or revoke one flag for one group; audit row only when something changed. Returns whether it was granted before. */
export async function setGrant(actorId: number, group: string, flag: string, granted: boolean): Promise<{ before: boolean }> {
  await ensureSchema();
  const db = getDb();
  const [, rows] = await db.transaction([
    db`SELECT pg_advisory_xact_lock(${PERMISSION_LOCK_KEY})`,
    db`
      WITH before AS (
        SELECT EXISTS (SELECT 1 FROM group_flags WHERE group_name = ${group} AND flag_key = ${flag}) AS had
      ),
      ins AS (
        INSERT INTO group_flags (group_name, flag_key)
        SELECT ${group}, ${flag} WHERE ${granted}::boolean
        ON CONFLICT DO NOTHING
        RETURNING 1
      ),
      del AS (
        DELETE FROM group_flags
        WHERE NOT ${granted}::boolean AND group_name = ${group} AND flag_key = ${flag}
        RETURNING 1
      ),
      audit AS (
        INSERT INTO permission_audit (actor_github_id, action, target, details)
        SELECT ${actorId}, CASE WHEN ${granted}::boolean THEN 'group_grant' ELSE 'group_revoke' END,
               ${group + ":" + flag},
               jsonb_build_object('before', (SELECT had FROM before), 'after', ${granted}::boolean)
        WHERE (SELECT had FROM before) IS DISTINCT FROM ${granted}::boolean
        RETURNING 1
      )
      SELECT (SELECT had FROM before) AS had
    `,
  ], { isolationLevel: "ReadCommitted" }) as [unknown, { had: boolean }[]];
  return { before: rows[0].had };
}

export interface AuditRow {
  id: number;
  actor_github_id: number;
  actor_login: string | null;
  action: string;
  target: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

/** Newest first; pass the last seen id as `before` to page backwards. */
export async function listAudit(opts: { before?: number; limit?: number } = {}): Promise<AuditRow[]> {
  await ensureSchema();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await getDb()`
    SELECT a.id, a.actor_github_id, u.login AS actor_login, a.action, a.target, a.details, a.created_at
    FROM permission_audit a
    LEFT JOIN users u ON u.github_id = a.actor_github_id
    WHERE (${opts.before ?? null}::bigint IS NULL OR a.id < ${opts.before ?? null})
    ORDER BY a.id DESC
    LIMIT ${limit}
  ` as AuditRow[];
  return rows.map((r) => ({ ...r, id: Number(r.id), actor_github_id: Number(r.actor_github_id) }));
}

export async function userExists(githubId: number): Promise<boolean> {
  await ensureSchema();
  const rows = await getDb()`SELECT 1 FROM users WHERE github_id = ${githubId}` as unknown[];
  return rows.length > 0;
}
