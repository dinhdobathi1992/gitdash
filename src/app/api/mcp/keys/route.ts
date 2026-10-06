/**
 * POST /api/mcp/keys — mint a personal MCP key for the signed-in user.
 *
 * A key is a sealed `mcp.key` token carrying the GitHub token this web session
 * signed in with (a PAT or an OAuth token). MCP clients send it as
 * `Authorization: Bearer <key>` to /mcp/me, with no OAuth round trip. It lives
 * 30 days, is backed by one grant row (ids only, so Settings can list and
 * revoke it) and is returned exactly once.
 *
 * Body: { "label": string } (1-80 characters).
 * Answers:
 *   201 { key, grant_id, expires_at }  Cache-Control: private, no-store
 *   400 bad body or label
 *   401 no session, or GitHub rejects the session's token
 *   403 cross-origin request, or the user is outside GITDASH_ALLOWED_ORGS
 *   404 GITDASH_MCP is off
 *   409 no DATABASE_URL: a key that cannot be revoked is never issued
 *   429 more than 5 keys an hour for this GitHub user (per instance)
 *   503 GitHub or the database is unavailable, or the MCP origin is misconfigured
 *
 * Never logs the key or the GitHub token.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSession, sessionToken } from "@/lib/session";
import { isStandaloneMode } from "@/lib/mode";
import { lookupWhoAmI, type WhoAmI } from "@/lib/identity";
import { isSameOrigin } from "@/lib/url";
import { rateLimit } from "@/lib/ratelimit";
import { noStoreHeaders } from "@/lib/http-cache";
import { createGrant, redeemGrant, revokeGrant, sanitizeClientName } from "@/lib/mcp/oauth/grants";
import { seal, TOKEN_TTL_SEC } from "@/lib/mcp/oauth/tokens";
import { auditMcp, TOKEN_LIKE } from "@/lib/mcp/oauth/audit";
import {
  MCP_SCOPE,
  PERSONAL_KEY_CLIENT_ID,
  PERSONAL_KEY_HOST,
  hasDatabase,
  mcpFlagOn,
  mcpGate,
  resourceUrl,
} from "@/lib/mcp/oauth/config";

// Route modules may only export handlers and segment config, so these stay private.
/** Keys a GitHub user may mint per hour (per instance, best effort). */
const KEY_RATE_LIMIT = { limit: 5, windowMs: 60 * 60_000 };
/** Longest accepted label, in characters. */
const MAX_LABEL_CHARS = 80;
const MAX_BODY_CHARS = 2_048;

const Body = z.object({ label: z.string() });

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...noStoreHeaders(), ...extra },
  });
}

const statusOf = (err: unknown) => (err as { status?: number } | null)?.status;
const errName = (err: unknown) => (err instanceof Error ? err.name : typeof err);

/** The label, validated and sanitised; or the reason it was refused. */
function parseLabel(raw: string): { ok: true; label: string } | { ok: false; error: string } {
  if (raw.length > MAX_BODY_CHARS) return { ok: false, error: "Request body is too large." };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Send a JSON body: { \"label\": \"...\" }." };
  }
  const parsed = Body.safeParse(data);
  if (!parsed.success) return { ok: false, error: "Send a JSON body: { \"label\": \"...\" }." };
  if (Array.from(parsed.data.label.trim()).length > MAX_LABEL_CHARS) {
    return { ok: false, error: `The label must be at most ${MAX_LABEL_CHARS} characters.` };
  }
  const label = sanitizeClientName(parsed.data.label);
  if (!label) return { ok: false, error: "Give the key a label, such as \"Claude Code on my laptop\"." };
  // The label is stored and audited in clear text: never let a pasted token in.
  if (TOKEN_LIKE.test(label)) return { ok: false, error: "The label looks like a token. Use a plain name." };
  return { ok: true, label };
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!mcpFlagOn()) return json({ error: "Not found" }, 404);
  if (!hasDatabase()) {
    return json({ error: "MCP keys need DATABASE_URL so they can be revoked.", code: "database_required" }, 409);
  }
  const gated = mcpGate(req, "resource");
  if (gated) return gated;
  // The organization-mode proxy already refuses cross-site writes; standalone's does not.
  if (!isSameOrigin(req)) return json({ error: "Forbidden", code: "cross_origin" }, 403);

  const session = await getSession();
  const token = sessionToken(session);
  if (!token) return json({ error: "Unauthorized" }, 401);
  const source = !isStandaloneMode() && session.accessToken ? "oauth" : "pat";

  // Before any GitHub call, so a bad request costs no API quota.
  const label = parseLabel(await req.text().catch(() => ""));
  if (!label.ok) return json({ error: label.error }, 400);

  // Fresh, uncached lookup: the key is bound to the identity GitHub reports
  // for this token, never to the display copy in the session.
  let who: WhoAmI;
  try {
    who = await lookupWhoAmI(token);
  } catch (err) {
    if (statusOf(err) === 401) return json({ error: "Unauthorized", code: "github_token_rejected" }, 401);
    console.error(`[mcp] key: GitHub identity lookup failed: ${errName(err)} ${statusOf(err) ?? ""}`.trim());
    return json({ error: "GitHub is unavailable. Try again shortly." }, 503, { "Retry-After": "30" });
  }
  // `allowed` is always true without GITDASH_ALLOWED_ORGS. When it is set (in
  // either mode) the tools would revoke the key on first use, so refuse it now.
  if (!who.allowed) return json({ error: "Forbidden", code: "org_not_allowed" }, 403);

  const rl = rateLimit(`mcp:keys:${who.identity.id}`, KEY_RATE_LIMIT.limit, KEY_RATE_LIMIT.windowMs);
  if (!rl.allowed) {
    const retry = Math.max(1, Math.ceil((rl.retryAfterMs ?? KEY_RATE_LIMIT.windowMs) / 1000));
    return json({ error: `You can create ${KEY_RATE_LIMIT.limit} keys an hour. Try again later.` }, 429, { "Retry-After": String(retry) });
  }

  let grantId: string;
  let expiresAt: string;
  try {
    const grant = await createGrant({
      github_id: who.identity.id,
      client_id: PERSONAL_KEY_CLIENT_ID,
      client_name: label.label,
      redirect_host: PERSONAL_KEY_HOST,
    });
    // A key has no code exchange: redeem at once with the generated (never issued) refresh id.
    if (!(await redeemGrant(grant.grant_id, grant.current_refresh))) throw new Error("grant could not be redeemed");
    grantId = grant.grant_id;
    expiresAt = grant.absolute_expiry;
  } catch (err) {
    console.error(`[mcp] key: grant could not be created: ${errName(err)}`);
    return json({ error: "Could not create the key. Try again shortly." }, 503, { "Retry-After": "5" });
  }

  let key: string;
  try {
    key = await seal(
      "mcp.key",
      {
        grant_id: grantId,
        aud: resourceUrl(),
        scope: MCP_SCOPE,
        source,
        gh: token,
        id: who.identity.id,
        login: who.identity.login,
      },
      TOKEN_TTL_SEC["mcp.key"],
    );
    await auditMcp("mcp.key_created", who.identity.id, grantId, { label: label.label, source });
  } catch (err) {
    // Unaudited or unsealed: withdraw the grant so no unaccounted key exists.
    console.error(`[mcp] key: sealing or auditing failed, withdrawing grant: ${errName(err)}`);
    await revokeGrant(grantId, "user_revoked").catch(() => undefined);
    return json({ error: "Could not create the key. Try again shortly." }, 503, { "Retry-After": "5" });
  }

  return json({ key, grant_id: grantId, expires_at: expiresAt }, 201);
}
