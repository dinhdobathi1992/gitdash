/**
 * Per-call authorization for the signed-in MCP tools. It mirrors src/proxy.ts
 * and reuses its building blocks, so a tool is allowed exactly when the web
 * API route it stands for (`apiPath`) would be:
 *
 *  1. resolveIdentity(gh): a GitHub 401 revokes the grant (the next request
 *     gets HTTP 401 and the client signs in again); a user outside the allowed
 *     organizations has every grant they hold revoked; an outage is a tool
 *     error and never fails open.
 *  2. decide(classify(apiPath), access, rbacEnforced()).
 *  3. recordSeen, after the response.
 *
 * While GitHub and the database are reachable, organization and group
 * changes apply within 60 s. During an outage the last known answer is reused
 * for up to 10 minutes, as in the web app (see LAST_KNOWN_MAX_MS).
 */

import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import {
  classify,
  decide,
  needsAccess,
  rbacEnforced,
  resolveAccess,
  resolveIdentity,
} from "@/lib/permissions";
import { recordSeen } from "@/lib/record-seen";
import { revokeGrant, type RevokeReason } from "./oauth/grants";
import { auditMcp, revokeAllForUserAudited, type McpAuditAction } from "./oauth/audit";
import { authExtra, inBackground, type McpAuthExtra } from "./auth";

export type ToolAuth = McpAuthExtra;

export type ToolGate = { ok: true; auth: ToolAuth } | { ok: false; result: CallToolResult };

export const toolError = (text: string): CallToolResult => ({ content: [{ type: "text", text }], isError: true });

export const MSG = {
  noAuth: "This tool needs a signed-in connection. Reconnect GitDash in your app.",
  githubRevoked: "Your GitHub authorization was revoked; reconnect GitDash in your app.",
  unavailable: "GitDash can't check your access right now; try again shortly.",
  orgRemoved:
    "Your GitHub account is not a member of an organization allowed on this GitDash (GITDASH_ALLOWED_ORGS). " +
    "This connection has been revoked.",
  noGroups: "Your account has no GitDash group yet. Ask a GitDash admin to add you to one.",
  unregistered: "This tool is not available on this GitDash.",
} as const;

export const forbiddenMessage = (flag?: string) =>
  flag
    ? `This needs the "${flag}" feature, which none of your GitDash groups grants. Ask a GitDash admin.`
    : "Your GitDash groups do not allow this.";

/** Revoke the grant and audit it. Errors are logged by name only and swallowed: the caller already answers with an error. */
export async function revokeForTool(auth: ToolAuth, reason: RevokeReason, action: McpAuditAction): Promise<void> {
  try {
    if (await revokeGrant(auth.grant_id, reason)) await auditMcp(action, auth.id, auth.grant_id, { reason });
  } catch (err) {
    console.error(`[mcp] revoking grant (${reason}) failed: ${(err as Error).name}`);
  }
}

/** Revoke every live grant of the caller's user (`org_removed`), audited per grant. Errors are logged by name and swallowed. */
async function revokeAllForTool(auth: ToolAuth): Promise<void> {
  try {
    await revokeAllForUserAudited(auth.id, "org_removed", "mcp.org_removed");
  } catch (err) {
    console.error(`[mcp] revoking the user's grants (org_removed) failed: ${(err as Error).name}`);
  }
}

const statusOf = (err: unknown) => (err as { status?: number } | null)?.status;

export async function authorizeTool(authInfo: AuthInfo | undefined, apiPath: string): Promise<ToolGate> {
  const auth = authExtra(authInfo);
  if (!auth) return { ok: false, result: toolError(MSG.noAuth) };

  let who: Awaited<ReturnType<typeof resolveIdentity>>;
  try {
    who = await resolveIdentity(auth.gh);
  } catch (err) {
    if (statusOf(err) === 401) {
      await revokeForTool(auth, "github_revoked", "mcp.github_revoked");
      return { ok: false, result: toolError(MSG.githubRevoked) };
    }
    return { ok: false, result: toolError(MSG.unavailable) };
  }
  if (who.identity.id !== auth.id) {
    await revokeForTool(auth, "github_revoked", "mcp.github_revoked");
    return { ok: false, result: toolError(MSG.githubRevoked) };
  }
  if (!who.allowed) {
    // The user, not just this connection, lost access: revoke every grant they hold.
    await revokeAllForTool(auth);
    return { ok: false, result: toolError(MSG.orgRemoved) };
  }

  const cls = classify(apiPath, "GET");
  const enforce = rbacEnforced();
  let access: Awaited<ReturnType<typeof resolveAccess>> | null = null;
  if (needsAccess(cls, enforce)) {
    try {
      access = await resolveAccess(who.identity.id);
    } catch {
      // AuthzUnavailableError (no recent answer to fall back on): never fail open.
      return { ok: false, result: toolError(MSG.unavailable) };
    }
  }
  const d = decide(cls, access, enforce);

  recordSeen(who.identity, inBackground);

  if (d.ok) return { ok: true, auth };
  if (d.code === "no_groups") return { ok: false, result: toolError(MSG.noGroups) };
  if (d.code === "unregistered") return { ok: false, result: toolError(MSG.unregistered) };
  return { ok: false, result: toolError(forbiddenMessage(d.flag)) };
}
