/**
 * Bearer-token handling for /mcp/me.
 *
 * `verifyToken` never throws. It answers:
 *  - ok:          a live `mcp.access` token or personal `mcp.key` for this
 *                 resource, on a live grant;
 *  - invalid:     anything else the client sent (HTTP 401 invalid_token);
 *  - unavailable: the grant store could not be read (HTTP 503). An outage is
 *                 never reported as an invalid token, so clients do not throw
 *                 away good credentials and force the user to sign in again.
 *
 * The route builds `WWW-Authenticate` from the explicit metadata URL (from
 * NEXT_PUBLIC_APP_URL), never from forwarded headers.
 */

import { after } from "next/server";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { ensureSchema, getDb } from "@/lib/db";
import { open } from "./oauth/tokens";
import { getActiveGrant } from "./oauth/grants";
import { grantClientId } from "./oauth/clients";
import { MCP_SCOPE, PERSONAL_KEY_CLIENT_ID, isOurResource, mcpEnabled, resourceMetadataUrl } from "./oauth/config";
import { MCP_CORS_HEADERS } from "./http";

/** What tools find in `ctx.http.authInfo.extra`. `gh` is the user's GitHub token: never log or return it. */
export interface McpAuthExtra {
  gh: string;
  id: number;
  login: string;
  grant_id: string;
}

export type VerifyResult =
  | { ok: true; authInfo: AuthInfo & { extra: McpAuthExtra } }
  | { ok: false; reason: "invalid" | "unavailable" };

/** The bearer token, null when there is no Authorization header, "" when it is not a Bearer credential. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header === null) return null;
  const m = /^Bearer[ ]+([^\s]+)\s*$/i.exec(header);
  return m ? m[1] : "";
}

/** The fields both bearer types share, plus the grant client id the token must belong to. */
interface Bearer {
  grant_id: string;
  aud: string;
  scope: string;
  gh: string;
  id: number;
  login: string;
  exp: number;
  clientId: string;
  grantClientId: string;
}

/**
 * Open a bearer credential: an OAuth access token (`mcp.access`) or a
 * personal MCP key (`mcp.key`). Each type has its own sealing key, so a code,
 * refresh or any other token type never opens here. A key may only belong to
 * a personal-key grant and an access token only to its OAuth client's grant.
 */
async function openBearer(token: string): Promise<Bearer | null> {
  const a = await open("mcp.access", token);
  if (a) return { ...a, clientId: a.client_id, grantClientId: grantClientId(a.client_id) };
  const k = await open("mcp.key", token);
  if (k) return { ...k, clientId: PERSONAL_KEY_CLIENT_ID, grantClientId: PERSONAL_KEY_CLIENT_ID };
  return null;
}

export async function verifyToken(token: string): Promise<VerifyResult> {
  const invalid = { ok: false, reason: "invalid" } as const;
  const t = await openBearer(token);
  if (!t) return invalid;
  if (!isOurResource(t.aud)) return invalid;
  if (!t.scope.split(" ").includes(MCP_SCOPE)) return invalid;

  let grant: Awaited<ReturnType<typeof getActiveGrant>>;
  try {
    grant = await getActiveGrant(t.grant_id);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!grant || grant.github_id !== t.id || grant.client_id !== t.grantClientId) return invalid;

  return {
    ok: true,
    authInfo: {
      token: "<redacted>",
      clientId: t.clientId,
      scopes: t.scope.split(" "),
      expiresAt: t.exp,
      resource: new URL(t.aud),
      extra: { gh: t.gh, id: t.id, login: t.login, grant_id: t.grant_id },
    },
  };
}

/** Read the extra fields back from a tool's auth info; null if anything is missing. */
export function authExtra(authInfo: AuthInfo | undefined): McpAuthExtra | null {
  const e = authInfo?.extra as Partial<McpAuthExtra> | undefined;
  if (!e || typeof e.gh !== "string" || !e.gh || typeof e.id !== "number" || typeof e.login !== "string" || typeof e.grant_id !== "string") {
    return null;
  }
  return { gh: e.gh, id: e.id, login: e.login, grant_id: e.grant_id };
}

// ── Responses ────────────────────────────────────────────────────────────────

/**
 * WWW-Authenticate for a 401. `resource_metadata` (which starts OAuth) only
 * when this deployment runs the OAuth server: standalone mode has none, and
 * pointing a client at a missing authorization server would only fail later.
 */
function challenge(error?: { code: string; description: string }): string {
  const parts = mcpEnabled() ? [`Bearer resource_metadata="${resourceMetadataUrl()}"`, `scope="${MCP_SCOPE}"`] : [`Bearer scope="${MCP_SCOPE}"`];
  if (error) parts.push(`error="${error.code}"`, `error_description="${error.description}"`);
  return parts.join(", ");
}

function json(body: unknown, status: number, extra: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...MCP_CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

/** 401 that starts (or restarts) OAuth. `invalid` adds error="invalid_token". */
export function unauthorized(invalid: boolean): Response {
  const err = invalid ? { code: "invalid_token", description: "The access token is invalid, expired or revoked" } : undefined;
  return json(
    {
      error: invalid ? "invalid_token" : "unauthorized",
      error_description: invalid ? err!.description : mcpEnabled() ? "Sign in to use these tools" : "Send a personal MCP key as a Bearer token (Settings → Connected apps)",
    },
    401,
    { "WWW-Authenticate": challenge(err) },
  );
}

/** 503 for an outage: retry, keep the credentials. */
export function authUnavailable(): Response {
  return json({ error: "temporarily_unavailable", error_description: "Try again shortly" }, 503, { "Retry-After": "5" });
}

// ── Background work ──────────────────────────────────────────────────────────

/**
 * Run `p` after the response when inside a request (route handlers); outside
 * one (tests, scripts) `after` throws and the promise just runs. `p` must
 * handle its own errors.
 */
export function inBackground(p: Promise<unknown>): void {
  try {
    after(p);
  } catch {
    // Outside a request scope: nothing to extend.
  }
}

const TOUCH_EVERY_MS = 5 * 60_000;
const lastTouched = new Map<string, number>();

/** Update the grant's last_used_at, at most every 5 minutes per grant and instance. Never throws. */
export function touchGrant(grantId: string): void {
  const now = Date.now();
  if (now - (lastTouched.get(grantId) ?? 0) < TOUCH_EVERY_MS) return;
  lastTouched.set(grantId, now);
  if (lastTouched.size > 10_000) lastTouched.clear();
  inBackground(
    (async () => {
      await ensureSchema();
      await getDb()`
        UPDATE mcp_grants SET last_used_at = NOW()
        WHERE grant_id = ${grantId}::uuid AND revoked_at IS NULL
          AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes')
      `;
    })().catch(() => lastTouched.delete(grantId)),
  );
}
