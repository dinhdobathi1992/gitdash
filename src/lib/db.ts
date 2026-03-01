/**
 * Neon PostgreSQL client + schema migration.
 *
 * Uses @neondatabase/serverless tagged-template API.
 * Schema is applied idempotently on first use via `ensureSchema()`.
 */

import { neon } from "@neondatabase/serverless";

// ── Client ────────────────────────────────────────────────────────────────────

// Lazy singleton — only initialised when the first query runs, not at module
// evaluation time.  This prevents build-time crashes when DATABASE_URL is
// absent (e.g. during Vercel CI where env vars are injected at runtime).
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
}

export interface DbAlertEvent {
  id: number;
  rule_id: number | null;
  scope: string;
  metric: string;
  value: number | null;
  fired_at: string;
  details: Record<string, unknown> | null;
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

// ── Schema migration ──────────────────────────────────────────────────────────

let schemaEnsured = false;

export async function ensureSchema(): Promise<void> {
  if (schemaEnsured) return;
  await getDb()`
    CREATE TABLE IF NOT EXISTS workflow_runs (
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
    )
  `;
  await getDb()`CREATE INDEX IF NOT EXISTS idx_wr_repo_created ON workflow_runs(repo, created_at DESC)`;
  await getDb()`CREATE INDEX IF NOT EXISTS idx_wr_workflow ON workflow_runs(workflow_id, created_at DESC)`;
  await getDb()`CREATE INDEX IF NOT EXISTS idx_wr_conclusion ON workflow_runs(repo, conclusion, created_at DESC)`;

  await getDb()`
    CREATE TABLE IF NOT EXISTS sync_cursors (
      repo            VARCHAR(300) PRIMARY KEY,
      last_run_id     BIGINT,
      last_synced_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await getDb()`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id              SERIAL PRIMARY KEY,
      scope           VARCHAR(300) NOT NULL,
      metric          VARCHAR(50) NOT NULL,
      threshold       NUMERIC NOT NULL,
      window_hours    INT NOT NULL DEFAULT 24,
      channel         VARCHAR(50) NOT NULL,
      destination     TEXT,
      enabled         BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await getDb()`CREATE INDEX IF NOT EXISTS idx_ar_scope ON alert_rules(scope)`;

  await getDb()`
    CREATE TABLE IF NOT EXISTS alert_events (
      id              SERIAL PRIMARY KEY,
      rule_id         INT REFERENCES alert_rules(id) ON DELETE CASCADE,
      scope           VARCHAR(300) NOT NULL,
      metric          VARCHAR(50) NOT NULL,
      value           NUMERIC,
      fired_at        TIMESTAMPTZ DEFAULT NOW(),
      details         JSONB
    )
  `;
  await getDb()`CREATE INDEX IF NOT EXISTS idx_ae_scope_fired ON alert_events(scope, fired_at DESC)`;

  schemaEnsured = true;
}

// ── Run upsert ────────────────────────────────────────────────────────────────

export async function upsertRuns(rows: RunUpsertRow[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  // Individual upserts — Neon HTTP is connectionless so batching in a loop is fine
  for (const r of rows) {
    await getDb()`
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
    `;
  }
  return rows.length;
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

export async function createAlertRule(
  rule: Omit<DbAlertRule, "id" | "created_at">
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
  enabled: boolean,
): Promise<DbAlertRule | null> {
  await ensureSchema();
  const rows = await getDb()`
    UPDATE alert_rules SET enabled = ${enabled} WHERE id = ${id} RETURNING *
  `;
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
): Promise<void> {
  await ensureSchema();
  const detailsJson = JSON.stringify(details);
  await getDb()`
    INSERT INTO alert_events (rule_id, scope, metric, value, details)
    VALUES (${ruleId}, ${scope}, ${metric}, ${value}, ${detailsJson}::jsonb)
  `;
}

// ── Alert rule evaluation ─────────────────────────────────────────────────────

/**
 * Evaluates all enabled alert rules whose scope matches `repoKey` (format:
 * "repo:owner/name" or "org:orgname").  For each rule that is breached and
 * hasn't already fired within its window, inserts an alert_event row.
 *
 * Returns the number of new events fired.
 */
export async function evaluateAlertRulesForRepo(repoKey: string): Promise<number> {
  await ensureSchema();

  // Build the list of scopes to check: exact repo match + org prefix
  const parts = repoKey.split("/");          // ["owner", "repo"]
  const orgScope  = parts[0] ? `org:${parts[0]}` : null;
  const repoScope = `repo:${repoKey}`;

  const scopes = [repoScope, ...(orgScope ? [orgScope] : [])];

  // Fetch all enabled rules for those scopes
  const rules: DbAlertRule[] = [];
  for (const s of scopes) {
    const r = await getDb()`
      SELECT * FROM alert_rules WHERE scope = ${s} AND enabled = TRUE
    ` as DbAlertRule[];
    rules.push(...r);
  }

  if (!rules.length) return 0;

  let fired = 0;

  for (const rule of rules) {
    // De-duplicate: skip if an event for this rule already fired in the window
    const recent = await getDb()`
      SELECT id FROM alert_events
      WHERE rule_id = ${rule.id}
        AND fired_at >= NOW() - (${rule.window_hours} || ' hours')::INTERVAL
      LIMIT 1
    ` as { id: number }[];
    if (recent.length > 0) continue;

    // Compute the current metric value for this rule's scope over the window
    let value: number | null = null;

    if (rule.metric === "failure_rate") {
      // Failure rate (%) of completed runs in the window for this repo
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
        value = Math.round((row.failures / row.total) * 100);
      }
    } else if (rule.metric === "duration_p95") {
      // P95 duration in minutes
      const rows = await getDb()`
        SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95
        FROM workflow_runs
        WHERE repo = ${repoKey}
          AND duration_ms > 0
          AND created_at >= NOW() - (${rule.window_hours} || ' hours')::INTERVAL
      ` as { p95: number | null }[];
      const p95ms = rows[0]?.p95 ?? null;
      if (p95ms !== null) value = Math.round(p95ms / 60000);
    } else if (rule.metric === "queue_wait_p95") {
      // P95 queue wait in minutes
      const rows = await getDb()`
        SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY queue_wait_ms)::int AS p95
        FROM workflow_runs
        WHERE repo = ${repoKey}
          AND queue_wait_ms > 0
          AND created_at >= NOW() - (${rule.window_hours} || ' hours')::INTERVAL
      ` as { p95: number | null }[];
      const p95ms = rows[0]?.p95 ?? null;
      if (p95ms !== null) value = Math.round(p95ms / 60000);
    } else if (rule.metric === "success_streak") {
      // Count consecutive failures from the most recent completed runs
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
      value = streak;
    }

    if (value === null) continue;

    // Check threshold
    if (value >= rule.threshold) {
      await fireAlertEvent(rule.id, rule.scope, rule.metric, value, {
        repo: repoKey,
        threshold: rule.threshold,
        window_hours: rule.window_hours,
        triggered_at: new Date().toISOString(),
      });
      fired++;
    }
  }

  return fired;
}
