/**
 * Neon PostgreSQL client + versioned schema migrations.
 *
 * Uses @neondatabase/serverless tagged-template API.
 * Schema is applied via explicit versioned migrations tracked in schema_migrations.
 */

import { neon } from "@neondatabase/serverless";
import { buildPayload, dispatchAlert, METRIC_LABELS as _METRIC_LABELS } from "./notifier";
import { detectAnomalies } from "./anomaly";

// ── Client ────────────────────────────────────────────────────────────────────

let _client: ReturnType<typeof neon> | null = null;

function getDb(): ReturnType<typeof neon> {
  if (!_client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _client = neon(url);
  }
  return _client;
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
}

// ── Versioned migrations ───────────────────────────────────────────────────────

/**
 * Each migration has a unique integer version. Migrations are idempotent and
 * applied in ascending order. Once applied, they are recorded in schema_migrations.
 */
const MIGRATIONS: Array<{ version: number; name: string; up: string[] }> = [
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
];

let schemaEnsured = false;

export async function ensureSchema(): Promise<void> {
  if (schemaEnsured) return;
  const db = getDb();

  // Bootstrap migration tracking table
  await db`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INT PRIMARY KEY,
      name        VARCHAR(200) NOT NULL,
      applied_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  const applied = await db`SELECT version FROM schema_migrations ORDER BY version` as { version: number }[];
  const appliedSet = new Set(applied.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (appliedSet.has(migration.version)) continue;

    for (const sql of migration.up) {
      // db.query() executes a raw SQL string. Do NOT use db.unsafe() here —
      // in the @neondatabase/serverless HTTP driver it returns a non-thenable
      // UnsafeRawSql fragment (for interpolation), so `await db.unsafe(...)`
      // silently executes nothing while the migration is still recorded.
      await db.query(sql);
    }

    await db`
      INSERT INTO schema_migrations (version, name) VALUES (${migration.version}, ${migration.name})
      ON CONFLICT (version) DO NOTHING
    `;
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
           first_review_at, approved_at, additions, deletions, review_count, state)
        VALUES (
          ${r.repo}, ${r.pr_number}, ${r.author}, ${r.created_at}, ${r.merged_at},
          ${r.closed_at}, ${r.first_review_at}, ${r.approved_at}, ${r.additions},
          ${r.deletions}, ${r.review_count}, ${r.state}
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
 * Evaluates all enabled, non-muted alert rules for `repoKey`.
 * People-based metrics now use the pr_facts table instead of workflow_runs proxies.
 * Returns the number of new events fired.
 */
export async function evaluateAlertRulesForRepo(repoKey: string): Promise<number> {
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
    rules.push(...r);
  }

  if (!rules.length) return 0;

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

    } else if (rule.metric === "review_response_p90") {
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

    } else if (rule.metric === "unreviewed_pr_age") {
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
