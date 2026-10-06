/**
 * Record that a signed-in user was seen, so an admin can find them and assign
 * a group. Shared by the proxy (web requests) and the signed-in MCP tools.
 *
 * In-process throttle: at most one database write per user per 10 minutes.
 * Upsert (not update): sessions created before users were recorded still get a
 * row. Never blocks the caller and never throws; a failed write is retried on
 * the next request.
 */

const SEEN_EVERY_MS = 10 * 60_000;
const MAX_TRACKED = 10_000;
const lastRecorded = new Map<number, number>();

export interface SeenIdentity {
  id: number;
  login: string;
  avatar_url: string;
}

/**
 * Start the write if one is due. `waitUntil` keeps the platform alive until it
 * settles (the proxy passes `event.waitUntil`, route handlers pass `after`).
 */
export function recordSeen(identity: SeenIdentity, waitUntil?: (p: Promise<unknown>) => void): void {
  const now = Date.now();
  if (now - (lastRecorded.get(identity.id) ?? 0) < SEEN_EVERY_MS) return;
  lastRecorded.set(identity.id, now);
  if (lastRecorded.size > MAX_TRACKED) lastRecorded.clear();
  const write = import("@/lib/db")
    .then((db) => db.upsertUser({ id: identity.id, login: identity.login, avatar_url: identity.avatar_url }))
    .catch(() => lastRecorded.delete(identity.id));
  waitUntil?.(write);
}

/** Test hook. */
export function __resetRecordSeenForTests(): void {
  lastRecorded.clear();
}
