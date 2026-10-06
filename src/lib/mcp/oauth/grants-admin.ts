/**
 * Read queries for the Connected apps screens that grants.ts does not offer:
 * every user's active grants (admin view) and the owner of one active grant
 * (revocation authorization). Same "active" definition as listGrants:
 * redeemed, not revoked, not past the absolute expiry. Ids and names only,
 * never a token. Database errors propagate to the caller.
 */

import { ensureSchema, getDb } from "@/lib/db";
import type { ConnectedGrant } from "@/lib/mcp/oauth/grants";

export interface AdminGrant extends ConnectedGrant {
  github_id: number;
  /** Null when the user row is gone. */
  login: string | null;
}

export interface GrantOwner {
  github_id: number;
  client_name: string;
  redirect_host: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function iso(v: unknown): string {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new Error("[mcp] unexpected timestamp from database");
  return d.toISOString();
}

/** Every user's active grants, newest first, capped at `limit` (default 500, max 1000). */
export async function listAllActiveGrants(limit = 500): Promise<AdminGrant[]> {
  await ensureSchema();
  const cap = Math.max(1, Math.min(Math.trunc(limit) || 500, 1_000));
  const rows = (await getDb()`
    SELECT g.grant_id::text AS grant_id, g.github_id::text AS github_id, u.login AS login,
           g.client_id, g.client_name, g.redirect_host, g.created_at, g.last_used_at, g.absolute_expiry
    FROM mcp_grants g LEFT JOIN users u ON u.github_id = g.github_id
    WHERE g.revoked_at IS NULL AND g.redeemed_at IS NOT NULL AND NOW() < g.absolute_expiry
    ORDER BY g.created_at DESC
    LIMIT ${cap}
  `) as {
    grant_id: string; github_id: string; login: string | null; client_id: string; client_name: string;
    redirect_host: string; created_at: unknown; last_used_at: unknown; absolute_expiry: unknown;
  }[];
  return rows.map((r) => ({
    grant_id: r.grant_id,
    github_id: Number(r.github_id),
    login: r.login,
    client_id: r.client_id,
    client_name: r.client_name,
    redirect_host: r.redirect_host,
    created_at: iso(r.created_at),
    last_used_at: r.last_used_at == null ? null : iso(r.last_used_at),
    absolute_expiry: iso(r.absolute_expiry),
  }));
}

/** The owner of an active grant, or null when the id is unknown, malformed, never redeemed, revoked or expired. */
export async function getActiveGrantOwner(grantId: string): Promise<GrantOwner | null> {
  if (!UUID_RE.test(grantId)) return null;
  await ensureSchema();
  const [row] = (await getDb()`
    SELECT github_id::text AS github_id, client_name, redirect_host
    FROM mcp_grants
    WHERE grant_id = ${grantId.toLowerCase()}::uuid AND revoked_at IS NULL AND redeemed_at IS NOT NULL AND NOW() < absolute_expiry
  `) as { github_id: string; client_name: string; redirect_host: string }[];
  return row ? { github_id: Number(row.github_id), client_name: row.client_name, redirect_host: row.redirect_host } : null;
}
