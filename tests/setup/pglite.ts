/**
 * pglite test harness — disposable real Postgres per test suite.
 * Tests use this to run actual SQL against a real embedded Postgres
 * instance instead of mocking @/lib/db.
 *
 * Usage in test files:
 *   import { createPgliteDb } from "./setup/pglite";
 *   const db = await createPgliteDb();
 *   await db.exec(`INSERT INTO pr_facts ...`);
 *   const rows = await db.query(`SELECT * FROM pr_facts WHERE repo = $1`, ["owner/repo"]);
 */

import { PGlite } from "@electric-sql/pglite";

// Extracted from src/lib/db.ts MIGRATIONS — kept in sync manually.
// Only the DDL that tests actually exercise is needed here.
export const MIGRATION_SQL: string[] = [
  // v1: core tables
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
  `CREATE TABLE IF NOT EXISTS sync_cursors (
    repo            VARCHAR(300) PRIMARY KEY,
    last_run_id     BIGINT,
    last_synced_at  TIMESTAMPTZ DEFAULT NOW()
  )`,
  // v2: pr_facts
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
  // v7: pr_sync_cursor columns (additive)
  `ALTER TABLE sync_cursors ADD COLUMN IF NOT EXISTS pr_sync_cursor TIMESTAMPTZ`,
  `ALTER TABLE sync_cursors ADD COLUMN IF NOT EXISTS pr_backfill_complete BOOLEAN NOT NULL DEFAULT FALSE`,
];

/** Create a fresh pglite instance and apply schema migrations. */
export async function createPgliteDb() {
  const db = new PGlite();
  for (const sql of MIGRATION_SQL) {
    await db.exec(sql);
  }
  return db;
}
