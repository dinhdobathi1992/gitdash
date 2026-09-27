/**
 * Shared second-level (L2) cache in Postgres, underneath the in-process cache
 * in src/lib/cache.ts. Lets every replica/instance reuse a GitHub DTO another
 * instance already fetched.
 *
 * Opt-in only: withCache(..., { shared: true }). Settings caches, AI results
 * and anything holding secrets must never use it — values are stored as
 * plaintext JSONB (token-scoped keys, expiring rows). Operators can turn the
 * layer off with GITDASH_L2_CACHE=0.
 *
 * Every operation is best-effort: a slow or failing database is a cache miss
 * (reads) or a no-op (writes), never a failed request. Each query is aborted
 * after L2_TIMEOUT_MS, and after any failure the layer is skipped entirely
 * for L2_BREAKER_MS so an outage cannot add latency to every request.
 */

import type { DbClient } from "./db";

const L2_TIMEOUT_MS = 300;
/** One-off per instance: migrations/schema check before the first L2 query. */
const SCHEMA_TIMEOUT_MS = 2_000;
/** After any L2 failure, bypass the layer for this long. */
const L2_BREAKER_MS = 30_000;
/** Values larger than this stay in L1 only. */
const L2_MAX_BYTES = 512 * 1024;
/** Fraction of writes that also sweep expired rows (Helm has no cron). */
const PURGE_SAMPLE_RATE = 0.01;
/** Rows removed per purge statement, so a backlog is worked down in bounded steps. */
const PURGE_BATCH = 1_000;
/** Spread expiry by up to +10% so instances don't all refetch at once. */
const TTL_JITTER = 0.1;

let breakerOpenUntil = 0;

export function isL2Enabled(): boolean {
  return Boolean(process.env.DATABASE_URL) && process.env.GITDASH_L2_CACHE !== "0";
}

/** Enabled and not tripped by a recent failure. */
function available(): boolean {
  return isL2Enabled() && Date.now() >= breakerOpenUntil;
}

// db.ts → notifier → cache → cache-l2 would be an import cycle; load lazily.
// Schema setup runs here, outside the per-query deadline: on a cold instance it
// costs extra round trips that would otherwise eat the 300ms query budget.
// Bounded separately so an unreachable database still can't hang a request;
// ensureSchema() itself is shared per process, so a slow check is not repeated.
async function db(): Promise<DbClient> {
  const mod = await import("./db");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      mod.ensureSchema(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("schema check timed out")), SCHEMA_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  return mod.getDb();
}

async function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await run(ac.signal);
  } finally {
    clearTimeout(timer);
  }
}

const lastWarnAt = new Map<string, number>();
function fail(op: string, err: unknown): void {
  breakerOpenUntil = Date.now() + L2_BREAKER_MS;
  // One line per operation per minute — a DB outage must not flood the logs.
  const now = Date.now();
  if (now - (lastWarnAt.get(op) ?? 0) < 60_000) return;
  lastWarnAt.set(op, now);
  // Name + first line of the message only. Driver errors carry the SQL error
  // or network reason, never the connection string.
  const reason = err instanceof Error ? `${err.name}: ${err.message.split("\n")[0].slice(0, 160)}` : "unknown";
  console.warn(`[cache-l2] ${op} failed (${reason}); bypassing L2 for ${L2_BREAKER_MS / 1000}s`);
}

const warnedOversize = new Set<string>();
const keyPrefix = (key: string) => key.split(":")[0];

async function query(
  sql: DbClient,
  text: string,
  params: unknown[],
  signal: AbortSignal,
): Promise<Record<string, unknown>[]> {
  return (await sql.query(text, params, { fetchOptions: { signal } })) as Record<string, unknown>[];
}

/** Returns the stored value and its remaining TTL, or undefined on miss/expiry/error. */
export async function l2Get<T>(key: string): Promise<{ value: T; ttlSeconds: number } | undefined> {
  if (!available()) return undefined;
  try {
    const sql = await db();
    return await withDeadline(L2_TIMEOUT_MS, async (signal) => {
      const rows = await query(
        sql,
        `SELECT value, EXTRACT(EPOCH FROM (expires_at - NOW()))::float8 AS ttl FROM api_cache WHERE key = $1`,
        [key],
        signal,
      );
      if (!rows.length) return undefined;
      const ttl = Number(rows[0].ttl);
      if (!(ttl > 0)) {
        await query(sql, `DELETE FROM api_cache WHERE key = $1 AND expires_at <= NOW()`, [key], signal);
        return undefined;
      }
      return { value: rows[0].value as T, ttlSeconds: Math.ceil(ttl) };
    });
  } catch (err) {
    fail("get", err);
    return undefined;
  }
}

export async function l2Set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (!available()) return;
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    // A value-specific problem (e.g. a BigInt), not an outage: skip this key
    // without tripping the breaker for every other key.
    return;
  }
  if (json === undefined) return; // undefined / functions have no JSON form
  if (Buffer.byteLength(json) > L2_MAX_BYTES) {
    const prefix = keyPrefix(key);
    if (!warnedOversize.has(prefix)) {
      warnedOversize.add(prefix);
      console.warn(`[cache-l2] value for "${prefix}" exceeds ${L2_MAX_BYTES} bytes; kept in memory only`);
    }
    return;
  }
  const jittered = Math.ceil(ttlSeconds * (1 + Math.random() * TTL_JITTER));
  try {
    const sql = await db();
    await withDeadline(L2_TIMEOUT_MS, (signal) =>
      query(
        sql,
        `INSERT INTO api_cache (key, value, expires_at)
         VALUES ($1, $2::jsonb, NOW() + make_interval(secs => $3))
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
        [key, json, jittered],
        signal,
      ),
    );
  } catch (err) {
    fail("set", err);
    return;
  }
  if (Math.random() < PURGE_SAMPLE_RATE) await l2Purge();
}

export async function l2Delete(key: string): Promise<void> {
  if (!available()) return;
  try {
    const sql = await db();
    await withDeadline(L2_TIMEOUT_MS, (signal) => query(sql, `DELETE FROM api_cache WHERE key = $1`, [key], signal));
  } catch (err) {
    fail("delete", err);
  }
}

/**
 * Delete expired rows in batches of PURGE_BATCH until none remain or the time
 * budget runs out. Request paths use the default L2 budget (one or a few
 * batches); the cron sweep passes a longer budget. Returns rows removed.
 */
export async function l2Purge(budgetMs = L2_TIMEOUT_MS): Promise<number> {
  if (!available()) return 0;
  let removed = 0;
  try {
    const sql = await db();
    await withDeadline(budgetMs, async (signal) => {
      for (;;) {
        const rows = await query(
          sql,
          `DELETE FROM api_cache WHERE key IN (
             SELECT key FROM api_cache WHERE expires_at < NOW() LIMIT ${PURGE_BATCH}
           ) RETURNING 1`,
          [],
          signal,
        );
        removed += rows.length;
        if (rows.length < PURGE_BATCH) break;
      }
    });
  } catch (err) {
    // A budget running out mid-backlog is expected, not an outage.
    if (!(err instanceof Error && /abort/i.test(`${err.name} ${err.message}`))) fail("purge", err);
  }
  return removed;
}

/** Test hook: close the circuit breaker. */
export function __resetL2ForTests(): void {
  breakerOpenUntil = 0;
}
