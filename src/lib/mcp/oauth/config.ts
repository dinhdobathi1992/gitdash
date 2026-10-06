/**
 * Configuration and the feature gate for the MCP OAuth server and /mcp/me.
 *
 * Two gates, both off unless GITDASH_MCP=true:
 *  - the OAuth server (/oauth/**, the .well-known metadata, the MCP GitHub
 *    callback) also needs MODE=organization: standalone has no OAuth App;
 *  - the protected resource /mcp/me, personal MCP keys and the Connected apps
 *    API need organization mode, or standalone mode with DATABASE_URL (a key
 *    must be revocable, so it needs the grant store).
 * When a gate is on, NEXT_PUBLIC_APP_URL is the single source of the issuer
 * and the resource URL; it is never derived from forwarded headers. A request whose
 * origin does not match it gets 503 `misconfigured` (fail closed), so a
 * preview URL or a spoofed host can never mint tokens for another origin.
 *
 * Environment:
 *   GITDASH_MCP=true          enable the signed-in MCP endpoint, personal keys and (organization mode) the OAuth server
 *   DATABASE_URL              required for /mcp/me and keys in standalone mode
 *   MCP_ALLOW_DCR=true        also accept Dynamic Client Registration (default off)
 *   MCP_NATIVE_SCHEMES=a,b    custom redirect schemes allowed for desktop apps (default none)
 */

import { getAppMode } from "@/lib/mode";

/** The only scope the server issues. */
export const MCP_SCOPE = "gitdash:read";
/** Path of the protected resource on this origin. */
export const RESOURCE_PATH = "/mcp/me";
/** GitHub callback for the MCP sign-in (registered on the OAuth App as a second callback URL). */
export const GITHUB_CALLBACK_PATH = "/api/auth/callback/mcp";
/**
 * GitHub scopes the MCP sign-in requests: only what the read-only tools and
 * the identity check use. `repo` reads repositories, Actions runs and pull
 * requests; `read:org` answers the organization allow-list and org tools;
 * `read:user` reads the profile (GET /user). Narrower than the web sign-in:
 * no `workflow` (only needed to change workflow files) and no `user:email`
 * (only needed for GET /user/emails, which nothing here calls).
 */
export const GITHUB_SCOPES = "repo read:org read:user";
/**
 * Grant client_id of a personal MCP key. OAuth grants store a CIMD https URL
 * or a sha256 hex id, so this value can never collide with one.
 */
export const PERSONAL_KEY_CLIENT_ID = "gitdash:personal-key";
/** redirect_host stored on a personal key's grant (a key has no redirect). */
export const PERSONAL_KEY_HOST = "personal key";

/** GITDASH_MCP=true: the switch for everything signed-in MCP, whatever the mode. */
export function mcpFlagOn(): boolean {
  return process.env.GITDASH_MCP === "true";
}

/** True when a database is configured: grants, keys and their revocation live there. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** The OAuth authorization server: organization mode only (standalone has no OAuth App). */
export function mcpEnabled(): boolean {
  return getAppMode() === "organization" && mcpFlagOn();
}

/** /mcp/me, personal keys and the Connected apps API: organization mode, or standalone with a database. */
export function mcpResourceEnabled(): boolean {
  return mcpFlagOn() && (getAppMode() === "organization" || hasDatabase());
}

/** Which gate a route sits behind: the OAuth server, or the protected resource. */
export type McpGateScope = "oauth" | "resource";

export function dcrEnabled(): boolean {
  return process.env.MCP_ALLOW_DCR === "true";
}

// Schemes that must never be accepted as a "native" scheme, whatever is configured.
const RESERVED_SCHEMES = new Set(["http", "https", "javascript", "data", "file", "vbscript", "blob", "about", "ftp", "ws", "wss"]);

/** MCP_NATIVE_SCHEMES, lowercased; invalid or reserved entries are ignored. */
export function nativeSchemes(raw = process.env.MCP_NATIVE_SCHEMES): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/:$/, ""))
    .filter((s) => /^[a-z][a-z0-9+.-]{0,63}$/.test(s) && !RESERVED_SCHEMES.has(s));
}

/**
 * Normalise a URL for comparison: lowercase scheme and host (the URL parser
 * does this), default port dropped, trailing slashes removed from the path.
 * Null for anything unparsable or carrying a fragment or credentials.
 */
export function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.hash || raw.includes("#") || u.username || u.password) return null;
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
}

/** NEXT_PUBLIC_APP_URL reduced to its origin, or null when unset or invalid. */
function configuredOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The authorization server's issuer: this site's origin, no trailing slash. Throws when unset. */
export function issuer(): string {
  const origin = configuredOrigin();
  if (!origin) throw new Error("[mcp] NEXT_PUBLIC_APP_URL must be set when GITDASH_MCP=true");
  return origin;
}

/** The protected resource identifier: `<issuer>/mcp/me`. */
export function resourceUrl(): string {
  return `${issuer()}${RESOURCE_PATH}`;
}

/** RFC 9728 metadata URL for /mcp/me (path-inserted form). */
export function resourceMetadataUrl(): string {
  return `${issuer()}/.well-known/oauth-protected-resource${RESOURCE_PATH}`;
}

/** True when `raw` names this server's resource after normalisation. */
export function isOurResource(raw: unknown): boolean {
  const want = normalizeUrl(resourceUrl());
  return want !== null && normalizeUrl(raw) === want;
}

/** Whether issued cookies need `Secure` (always, unless the site itself is plain http). */
export function secureCookies(): boolean {
  return issuer().startsWith("https:");
}

/**
 * The origins this request may have been addressed to: by its Host (or URL)
 * and by X-Forwarded-Host, each with the forwarded protocol. This is a
 * misconfiguration check, not an authentication boundary: no URL is ever
 * built from these headers, so a spoofed header cannot redirect anything.
 */
function requestOrigins(req: Request): string[] {
  const first = (v: string | null) => v?.split(",")[0].trim() || null;
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return [];
  }
  const proto = first(req.headers.get("x-forwarded-proto")) ?? url.protocol.replace(/:$/, "");
  const hosts = [req.headers.get("host") ?? url.host, first(req.headers.get("x-forwarded-host"))];
  const out: string[] = [];
  for (const host of hosts) {
    if (!host) continue;
    try {
      out.push(new URL(`${proto}://${host}`).origin);
    } catch {
      // ignore an unparsable host
    }
  }
  return out;
}

let warnedMisconfigured = false;

function warnOnce(reason: string): void {
  if (warnedMisconfigured) return;
  warnedMisconfigured = true;
  console.error(`[mcp] MCP is enabled but misconfigured: ${reason}. OAuth and /mcp/me answer 503 until this is fixed.`);
}

/**
 * The gate every MCP OAuth and /mcp/me route runs first. Null means proceed;
 * otherwise the response to send: 404 when the feature is off for `scope`,
 * 503 when the configured origin is missing or differs from the request's.
 */
export function mcpGate(req: Request, scope: McpGateScope = "oauth"): Response | null {
  if (!(scope === "oauth" ? mcpEnabled() : mcpResourceEnabled())) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const origin = configuredOrigin();
  const misconfigured = (reason: string) => {
    warnOnce(reason);
    return new Response(JSON.stringify({ error: "misconfigured" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "300" },
    });
  };
  if (!origin) return misconfigured("NEXT_PUBLIC_APP_URL is not set");
  if (!requestOrigins(req).includes(origin)) return misconfigured("the request origin does not match NEXT_PUBLIC_APP_URL");
  return null;
}

/** Test hook: allow the misconfiguration warning to be logged again. */
export function __resetConfigWarningForTests(): void {
  warnedMisconfigured = false;
}

/** RFC 8414 authorization server metadata. `registration_endpoint` only when DCR is on. */
export function authorizationServerMetadata(): Record<string, unknown> {
  const iss = issuer();
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    token_endpoint: `${iss}/oauth/token`,
    revocation_endpoint: `${iss}/oauth/revoke`,
    ...(dcrEnabled() ? { registration_endpoint: `${iss}/oauth/register` } : {}),
    scopes_supported: [MCP_SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}
