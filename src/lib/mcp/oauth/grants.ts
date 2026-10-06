/**
 * MCP OAuth grant store (tables from migration 13 in src/lib/db.ts).
 *
 * A grant row holds ids only, never a token. Every write is one SQL statement:
 * the Neon HTTP driver has no interactive transactions, so read-then-branch
 * logic would race. Conditional UPDATE / INSERT ... ON CONFLICT and a single
 * CTE give the same guarantees under concurrency.
 *
 * Database errors propagate to the caller, which must map them to
 * "unavailable" (never to "invalid").
 */

import { randomUUID } from "node:crypto";
import { ensureSchema, getDb } from "@/lib/db";

/** How long a grant can live, whatever its refresh activity. */
export const GRANT_ABSOLUTE_TTL_DAYS = 30;
/** How long `getActiveGrant` trusts its per-instance cache: the revocation bound. */
export const ACTIVE_GRANT_CACHE_MS = 60_000;
/** A presented previous refresh id within this window is a benign retry (literal in rotateRefresh's SQL). */
export const REFRESH_GRACE_SEC = 30;

export type RevokeReason =
  | "user_revoked"
  | "admin_revoked"
  | "client_revoked"
  | "code_reuse"
  | "refresh_reuse"
  | "github_revoked"
  | "org_removed";

export type RotateOutcome = "ok" | "reuse" | "revoked";

export interface ActiveGrant {
  grant_id: string;
  github_id: number;
  client_id: string;
  absolute_expiry: string; // ISO 8601
}

export interface ConnectedGrant {
  grant_id: string;
  client_id: string;
  client_name: string;
  redirect_host: string;
  created_at: string;
  last_used_at: string | null;
  absolute_expiry: string;
}

export interface NewGrantInput {
  github_id: number;
  /** CIMD URL, or the sha256 hex of a DCR client id. */
  client_id: string;
  client_name: string;
  redirect_host: string;
}

export interface NewGrant {
  grant_id: string;
  current_refresh: string;
  absolute_expiry: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isGithubId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

function iso(v: unknown): string {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new Error("[mcp] unexpected timestamp from database");
  return d.toISOString();
}
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

/** Strip control characters and cap at 80 characters, as stored in client_name. */
export function sanitizeClientName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").trim();
  return Array.from(clean).slice(0, 80).join("");
}

/**
 * Create an unredeemed grant at consent time. Generates the grant id and the
 * first refresh id (carried in the authorization code).
 */
export async function createGrant(input: NewGrantInput): Promise<NewGrant> {
  if (!isGithubId(input.github_id)) throw new TypeError("[mcp] createGrant: invalid github_id");
  const clientId = input.client_id;
  if (typeof clientId !== "string" || clientId.length === 0 || clientId.length > 2048) {
    throw new TypeError("[mcp] createGrant: invalid client_id");
  }
  const host = input.redirect_host;
  if (typeof host !== "string" || host.length === 0 || host.length > 255) {
    throw new TypeError("[mcp] createGrant: invalid redirect_host");
  }
  const name = sanitizeClientName(String(input.client_name ?? ""));
  if (!name) throw new TypeError("[mcp] createGrant: empty client_name");

  const grantId = randomUUID();
  const refresh = randomUUID();
  await ensureSchema();
  const [row] = (await getDb()`
    INSERT INTO mcp_grants (grant_id, github_id, client_id, client_name, redirect_host, current_refresh, absolute_expiry)
    VALUES (${grantId}::uuid, ${input.github_id}, ${clientId}, ${name}, ${host}, ${refresh}::uuid,
            NOW() + make_interval(days => ${GRANT_ABSOLUTE_TTL_DAYS}::int))
    RETURNING absolute_expiry
  `) as { absolute_expiry: unknown }[];
  return { grant_id: grantId, current_refresh: refresh, absolute_expiry: iso(row.absolute_expiry) };
}

/**
 * Mark an authorization-code id as used until `expiresAt`. True only for the
 * first caller; any replay gets false.
 */
export async function consumeJti(jti: string, expiresAt: Date): Promise<boolean> {
  if (!isUuid(jti) || !(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) return false;
  await ensureSchema();
  const rows = (await getDb()`
    INSERT INTO mcp_used_jti (jti, expires_at) VALUES (${jti}::uuid, ${expiresAt.toISOString()}::timestamptz)
    ON CONFLICT DO NOTHING
    RETURNING jti
  `) as unknown[];
  return rows.length === 1;
}

/**
 * Exchange the code for the grant: succeeds once, and only while the grant is
 * live and the code's refresh id is still the grant's current one.
 */
export async function redeemGrant(grantId: string, refreshJti: string): Promise<boolean> {
  if (!isUuid(grantId) || !isUuid(refreshJti)) return false;
  await ensureSchema();
  const rows = (await getDb()`
    UPDATE mcp_grants SET redeemed_at = NOW(), last_used_at = NOW()
    WHERE grant_id = ${grantId}::uuid AND current_refresh = ${refreshJti}::uuid
      AND redeemed_at IS NULL AND revoked_at IS NULL AND NOW() < absolute_expiry
    RETURNING grant_id
  `) as unknown[];
  return rows.length === 1;
}

/**
 * Rotate the refresh id in one statement.
 *  - `presented` is the current id, or the previous one within 30 s of the
 *    last rotation (a benign retry or a parallel refresh) -> "ok"; the grant
 *    now expects `next`.
 *  - any other id on a live grant -> the grant is revoked (`refresh_reuse`)
 *    and the result is "reuse".
 *  - revoked, expired or unknown grant -> "revoked".
 */
export async function rotateRefresh(grantId: string, presented: string, next: string): Promise<RotateOutcome> {
  if (!isUuid(grantId) || !isUuid(presented) || !isUuid(next)) return "revoked";
  await ensureSchema();
  const rows = (await getDb()`
    WITH r AS (
      UPDATE mcp_grants
      SET previous_refresh = current_refresh, current_refresh = ${next}::uuid, rotated_at = NOW(), last_used_at = NOW()
      WHERE grant_id = ${grantId}::uuid AND revoked_at IS NULL AND NOW() < absolute_expiry
        AND (current_refresh = ${presented}::uuid
             OR (previous_refresh = ${presented}::uuid AND rotated_at > NOW() - INTERVAL '30 seconds'))
      RETURNING 'ok'::text AS outcome
    ), v AS (
      UPDATE mcp_grants SET revoked_at = NOW(), revoked_reason = 'refresh_reuse'
      WHERE grant_id = ${grantId}::uuid AND revoked_at IS NULL AND NOW() < absolute_expiry
        AND NOT EXISTS (SELECT 1 FROM r)
      RETURNING 'reuse'::text AS outcome
    )
    SELECT outcome FROM r UNION ALL SELECT outcome FROM v
  `) as { outcome: string }[];
  const outcome = rows[0]?.outcome;
  if (outcome === "ok" || outcome === "reuse") {
    if (outcome === "reuse") activeCache.delete(grantId.toLowerCase());
    return outcome;
  }
  return "revoked";
}

// ── Active-grant cache (per instance) ────────────────────────────────────────

const ACTIVE_CACHE_MAX = 5_000;
const activeCache = new Map<string, { grant: ActiveGrant | null; at: number }>();

function cacheSet(id: string, grant: ActiveGrant | null): void {
  if (activeCache.size >= ACTIVE_CACHE_MAX) {
    const oldest = activeCache.keys().next().value;
    if (oldest !== undefined) activeCache.delete(oldest);
  }
  activeCache.set(id, { grant, at: Date.now() });
}

/**
 * The grant if it is redeemed, not revoked and not past its absolute expiry;
 * otherwise null. Cached for 60 s per instance: a revocation on another
 * instance takes effect here within that bound. Throws on a database error.
 */
export async function getActiveGrant(grantId: string): Promise<ActiveGrant | null> {
  if (!isUuid(grantId)) return null;
  const id = grantId.toLowerCase();
  const hit = activeCache.get(id);
  if (hit && Date.now() - hit.at < ACTIVE_GRANT_CACHE_MS) {
    if (hit.grant && Date.parse(hit.grant.absolute_expiry) <= Date.now()) return null;
    return hit.grant;
  }
  await ensureSchema();
  const [row] = (await getDb()`
    SELECT grant_id::text AS grant_id, github_id::text AS github_id, client_id, absolute_expiry,
           (redeemed_at IS NOT NULL) AS redeemed,
           (revoked_at IS NULL AND NOW() < absolute_expiry) AS live
    FROM mcp_grants WHERE grant_id = ${id}::uuid
  `) as { grant_id: string; github_id: string; client_id: string; absolute_expiry: unknown; redeemed: boolean; live: boolean }[];

  // Not yet redeemed: may become active soon, so never cache the miss.
  if (row && row.live && !row.redeemed) return null;
  const grant: ActiveGrant | null =
    row && row.live
      ? { grant_id: row.grant_id, github_id: Number(row.github_id), client_id: row.client_id, absolute_expiry: iso(row.absolute_expiry) }
      : null;
  cacheSet(id, grant);
  return grant;
}

/** Revoke a grant. True when this call revoked it, false if it was already revoked or unknown. */
export async function revokeGrant(grantId: string, reason: RevokeReason): Promise<boolean> {
  if (!isUuid(grantId)) return false;
  await ensureSchema();
  const rows = (await getDb()`
    UPDATE mcp_grants SET revoked_at = NOW(), revoked_reason = ${reason}
    WHERE grant_id = ${grantId}::uuid AND revoked_at IS NULL
    RETURNING grant_id
  `) as unknown[];
  activeCache.delete(grantId.toLowerCase());
  return rows.length === 1;
}

/** A user's connected apps: redeemed, unrevoked, unexpired grants, newest first. */
export async function listGrants(githubId: number): Promise<ConnectedGrant[]> {
  if (!isGithubId(githubId)) return [];
  await ensureSchema();
  const rows = (await getDb()`
    SELECT grant_id::text AS grant_id, client_id, client_name, redirect_host, created_at, last_used_at, absolute_expiry
    FROM mcp_grants
    WHERE github_id = ${githubId} AND revoked_at IS NULL AND redeemed_at IS NOT NULL AND NOW() < absolute_expiry
    ORDER BY created_at DESC
  `) as { grant_id: string; client_id: string; client_name: string; redirect_host: string; created_at: unknown; last_used_at: unknown; absolute_expiry: unknown }[];
  return rows.map((r) => ({
    grant_id: r.grant_id,
    client_id: r.client_id,
    client_name: r.client_name,
    redirect_host: r.redirect_host,
    created_at: iso(r.created_at),
    last_used_at: isoOrNull(r.last_used_at),
    absolute_expiry: iso(r.absolute_expiry),
  }));
}

/** Delete grants whose code was never redeemed within 10 minutes. Returns the count. */
export async function pruneUnredeemed(): Promise<number> {
  await ensureSchema();
  const rows = (await getDb()`
    DELETE FROM mcp_grants
    WHERE redeemed_at IS NULL AND created_at < NOW() - INTERVAL '10 minutes'
    RETURNING grant_id
  `) as unknown[];
  return rows.length;
}

/** Test hook: forget the per-instance active-grant cache. */
export function __clearGrantCacheForTests(): void {
  activeCache.clear();
}
