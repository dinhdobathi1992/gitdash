/**
 * pglite test harness — disposable real Postgres per test suite.
 *
 * Two ways to use it:
 *
 * 1. Raw SQL against an embedded Postgres (schema = every migration's DDL):
 *      const db = await createPgliteDb();
 *      await db.query(`SELECT * FROM pr_facts WHERE repo = $1`, ["owner/repo"]);
 *
 * 2. Drive the real src/lib/db.ts helpers through a neon()-compatible adapter:
 *      const pg = new PGlite();
 *      __setDbClientForTests(createPgliteClient(pg));
 *      await ensureSchema();           // runs the real MIGRATIONS
 */

import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS, type DbClient } from "@/lib/db";

// Generated from src/lib/db.ts MIGRATIONS so the test schema cannot drift from
// production. Every statement is idempotent (IF NOT EXISTS), so replaying is safe.
export const MIGRATION_SQL: string[] = MIGRATIONS.flatMap((m) => m.up);

/** Create a fresh pglite instance and apply every migration's DDL. */
export async function createPgliteDb() {
  const db = new PGlite();
  for (const sql of MIGRATION_SQL) {
    await db.exec(sql);
  }
  return db;
}

// ── neon()-compatible adapter ────────────────────────────────────────────────

interface LazyQuery extends PromiseLike<unknown[]> {
  readonly text: string;
  readonly params: unknown[];
}

/**
 * The neon driver sends JS arrays as Postgres array literals ('{"a","b"}');
 * PGlite does not, so convert them here to keep the adapter faithful.
 */
function toPgParam(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  const item = (x: unknown): string =>
    x === null || x === undefined
      ? "NULL"
      : Array.isArray(x)
        ? (toPgParam(x) as string)
        : `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `{${v.map(item).join(",")}}`;
}

/**
 * Mirror the neon HTTP driver's shape: queries are lazy (run on first await),
 * a tagged-template call resolves to the row array, and `.transaction()`
 * accepts an array (or a function returning one) of not-yet-awaited queries
 * and runs them atomically in order, resolving to one row array per query.
 */
export function createPgliteClient(pg: PGlite): DbClient {
  const lazy = (text: string, rawParams: unknown[]): LazyQuery => {
    const params = rawParams.map(toPgParam);
    let run: Promise<unknown[]> | undefined;
    return {
      text,
      params,
      then(onFulfilled, onRejected) {
        run ??= pg.query(text, params).then((r) => r.rows as unknown[]);
        return run.then(onFulfilled, onRejected);
      },
    };
  };

  const sql = (strings: TemplateStringsArray, ...values: unknown[]) =>
    lazy(strings.reduce((acc, s, i) => acc + `$${i}` + s), values);

  const client = Object.assign(sql, {
    query: (text: string, params: unknown[] = []) => lazy(text, params),
    transaction: async (queries: LazyQuery[] | ((c: unknown) => LazyQuery[])) => {
      const list = typeof queries === "function" ? queries(client) : queries;
      return pg.transaction(async (tx) => {
        const results: unknown[][] = [];
        for (const q of list) results.push((await tx.query(q.text, q.params)).rows as unknown[]);
        return results;
      });
    },
  });

  return client as unknown as DbClient;
}
