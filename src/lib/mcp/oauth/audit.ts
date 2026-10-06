/**
 * Audit trail for MCP OAuth events, written to permission_audit.
 *
 * For system events (reuse detection, GitHub revocation, organization
 * removal) the actor is the grant owner. Details must never carry a token:
 * anything that looks like a GitHub token or a sealed token is refused.
 */

import { ensureSchema, getDb } from "@/lib/db";
import { revokeAllForUser, type RevokeReason } from "./grants";

export const MCP_AUDIT_ACTIONS = [
  "mcp.grant_created",
  "mcp.token_issued",
  "mcp.grant_revoked",
  "mcp.refresh_reuse",
  "mcp.code_reuse",
  "mcp.github_revoked",
  "mcp.org_removed",
  "mcp.key_created",
] as const;
export type McpAuditAction = (typeof MCP_AUDIT_ACTIONS)[number];

export type McpAuditDetails = Record<string, string | number | boolean | null>;

/** GitHub token prefixes (gho_, ghp_, ghs_, ghu_, ghr_, github_pat_) and iron seals (Fe26.). */
export const TOKEN_LIKE = /gh[opsur]_|github_pat_|Fe26\./;

const MAX_TARGET = 500;
const MAX_DETAILS_JSON = 4_096;

/**
 * Write one audit row. Throws on invalid input or token-like content, so a
 * caller can never quietly leak a token into the audit log.
 */
export async function auditMcp(
  action: McpAuditAction,
  actorGithubId: number,
  target: string,
  details: McpAuditDetails = {},
): Promise<void> {
  if (!(MCP_AUDIT_ACTIONS as readonly string[]).includes(action)) {
    throw new TypeError("[mcp] auditMcp: unknown action");
  }
  if (!Number.isSafeInteger(actorGithubId) || actorGithubId <= 0) {
    throw new TypeError("[mcp] auditMcp: invalid actor");
  }
  if (typeof target !== "string") throw new TypeError("[mcp] auditMcp: invalid target");
  if (details === null || typeof details !== "object" || Array.isArray(details)) {
    throw new TypeError("[mcp] auditMcp: details must be an object");
  }
  for (const v of Object.values(details)) {
    if (v !== null && !["string", "number", "boolean"].includes(typeof v)) {
      throw new TypeError("[mcp] auditMcp: details values must be scalars");
    }
  }
  const json = JSON.stringify(details);
  // Checked before any size limit, so the refusal names the real problem.
  if (TOKEN_LIKE.test(json) || TOKEN_LIKE.test(target)) {
    throw new Error("[mcp] auditMcp: refusing to write token-like content");
  }
  if (target.length === 0 || target.length > MAX_TARGET) throw new TypeError("[mcp] auditMcp: invalid target");
  if (json.length > MAX_DETAILS_JSON) throw new RangeError("[mcp] auditMcp: details too large");

  await ensureSchema();
  await getDb()`
    INSERT INTO permission_audit (actor_github_id, action, target, details)
    VALUES (${actorGithubId}, ${action}, ${target}, ${json}::jsonb)
  `;
}

/**
 * Revoke every live grant of one user (see revokeAllForUser) and write one
 * audit row per revoked grant, so each app and key in the log shows why it
 * stopped. A database error from the revocation propagates; an audit failure
 * is logged by name only and never undoes the revocation.
 */
export async function revokeAllForUserAudited(githubId: number, reason: RevokeReason, action: McpAuditAction): Promise<string[]> {
  const ids = await revokeAllForUser(githubId, reason);
  for (const id of ids) {
    try {
      await auditMcp(action, githubId, id, { reason });
    } catch (err) {
      console.error(`[mcp] audit ${action} failed: ${(err as Error).name}`);
    }
  }
  return ids;
}
