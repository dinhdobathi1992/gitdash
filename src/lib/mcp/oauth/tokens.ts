/**
 * Typed, sealed MCP OAuth tokens.
 *
 * A token is an iron seal (AES-256-CBC + HMAC-SHA256) made with the per-type
 * key from ./keys. The payload always carries `typ`, `iat` and `exp`.
 *
 * `open()` never throws and returns null on any failure. It does not rely on
 * iron's own expiry, which accepts a seal up to 60 s past its end: it checks
 * `exp` and `iat` itself with a 5-second tolerance.
 *
 * `gh` (the user's GitHub token) exists only inside sealed tokens. Never log a
 * payload or a sealed token.
 *
 * An authorization code (`mcp.code`) is also bound to its grant's code key
 * (see `withCodeKey`): `seal` and `open` require `{ codeKey }` for that type
 * and refuse it for every other, so a code can never be sealed without the
 * extra layer by mistake.
 */

import { sealData, unsealData } from "iron-session";
import { z } from "zod";
import { sealPasswords, unsealPasswords, withCodeKey, type PasswordMap, type TokenType } from "./keys";

export type { TokenType } from "./keys";

/** Clock tolerance for `exp` and `iat`, in seconds. */
export const CLOCK_TOLERANCE_SEC = 5;

/** Lifetimes by type, in seconds. `seal` refuses a longer ttl. */
export const TOKEN_TTL_SEC: Record<TokenType, number> = {
  "mcp.tx": 10 * 60,
  "mcp.code": 60,
  "mcp.access": 60 * 60,
  "mcp.refresh": 14 * 24 * 3600,
  "mcp.client": 90 * 24 * 3600,
  // Personal MCP key: no refresh, so its whole life is one token.
  "mcp.key": 30 * 24 * 3600,
};

// Upper bound on a token we are willing to try to unseal.
const MAX_TOKEN_LENGTH = 16 * 1024;

const str = (max: number) => z.string().min(1).max(max);
const clientId = str(2048);
const redirectUri = str(1024);
const resource = str(2048);
// RFC 7636: S256 challenge = base64url(SHA-256) = 43 chars; allow the full range.
const codeChallenge = z.string().regex(/^[A-Za-z0-9\-._~]{43,128}$/);
const gh = str(512);
const githubId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const login = str(100);

const identity = { gh, id: githubId, login };

const payloadShapes = {
  "mcp.tx": z
    .object({
      nonce: str(128),
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      state: z.string().max(512).optional(),
      resource,
      // Present after GitHub sign-in.
      gh: gh.optional(),
      id: githubId.optional(),
      login: login.optional(),
    })
    .refine(
      (p) => (p.gh === undefined) === (p.id === undefined) && (p.id === undefined) === (p.login === undefined),
      "gh, id and login are set together",
    ),
  "mcp.code": z.object({
    jti: z.uuid(),
    grant_id: z.uuid(),
    refresh_jti: z.uuid(),
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    resource,
    ...identity,
  }),
  "mcp.access": z.object({
    grant_id: z.uuid(),
    client_id: clientId,
    aud: resource,
    scope: str(200),
    ...identity,
  }),
  "mcp.refresh": z.object({
    jti: z.uuid(),
    grant_id: z.uuid(),
    client_id: clientId,
    aud: resource,
    ...identity,
  }),
  "mcp.client": z.object({
    redirect_uris: z.array(redirectUri).min(1).max(10),
    client_name: str(80),
    application_type: z.enum(["web", "native"]),
  }),
  // Personal MCP key minted in Settings. `gh` is the token the web session
  // signed in with; `source` records which kind it was.
  "mcp.key": z.object({
    grant_id: z.uuid(),
    aud: resource,
    scope: str(200),
    source: z.enum(["pat", "oauth"]),
    ...identity,
  }),
} satisfies Record<TokenType, z.ZodType>;

/** What the caller puts in a token of each type. */
export type TokenPayloadInput = { [T in TokenType]: z.infer<(typeof payloadShapes)[T]> };

/** What `open` returns: the input plus the claims `seal` adds. */
export type TokenPayload<T extends TokenType> = TokenPayloadInput[T] & { typ: T; iat: number; exp: number };

const claims = z.object({ typ: z.string(), iat: z.number().int(), exp: z.number().int() });

const nowSec = () => Math.floor(Date.now() / 1000);

// TypeScript cannot correlate a generic key with the indexed schema; the map
// above is keyed exactly by TokenType, so this narrowing is sound.
const shapeFor = <T extends TokenType>(typ: T) => payloadShapes[typ] as unknown as z.ZodType<TokenPayloadInput[T]>;

/** Extra sealing input: the grant's code key, required for `mcp.code` and refused for every other type. */
export interface SealOptions {
  codeKey?: string;
}

/** The password map for `typ`, bound to the code key for `mcp.code`. Throws when the options do not fit the type. */
function passwordsFor(typ: TokenType, base: PasswordMap, opts: SealOptions | undefined): PasswordMap {
  const codeKey = opts?.codeKey;
  if (typ === "mcp.code") {
    if (codeKey === undefined) throw new TypeError("[mcp] mcp.code needs the grant's code key");
    return withCodeKey(base, codeKey);
  }
  if (codeKey !== undefined) throw new TypeError(`[mcp] ${typ} does not take a code key`);
  return base;
}

/**
 * Seal `payload` as a token of type `typ` that expires in `ttlSeconds`.
 * Throws on an invalid payload, ttl or code key: all are programming errors.
 */
export async function seal<T extends TokenType>(
  typ: T,
  payload: TokenPayloadInput[T],
  ttlSeconds: number,
  opts?: SealOptions,
): Promise<string> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > TOKEN_TTL_SEC[typ]) {
    throw new RangeError(`[mcp] ttl for ${typ} must be an integer in 1..${TOKEN_TTL_SEC[typ]}`);
  }
  const password = passwordsFor(typ, sealPasswords(typ), opts);
  const parsed = shapeFor(typ).safeParse(payload);
  // Report field paths only: the payload may contain a GitHub token.
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
    throw new TypeError(`[mcp] invalid ${typ} payload: ${fields}`);
  }
  const iat = nowSec();
  const body = { ...parsed.data, typ, iat, exp: iat + ttlSeconds };
  return sealData(body, { password, ttl: ttlSeconds });
}

let warnedKeys = false;

/**
 * Open a token of type `typ`. Returns null for any invalid, expired or foreign
 * token, and for a code opened without (or with the wrong) code key. Never throws.
 */
export async function open<T extends TokenType>(typ: T, token: unknown, opts?: SealOptions): Promise<TokenPayload<T> | null> {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  let base: PasswordMap;
  try {
    base = unsealPasswords(typ);
  } catch (err) {
    // A configuration fault, not a bad token: say so once, loudly, then fail closed.
    if (!warnedKeys) {
      warnedKeys = true;
      console.error(`[mcp] token keys unavailable: ${(err as Error).message}`);
    }
    return null;
  }
  let password: PasswordMap;
  try {
    password = passwordsFor(typ, base, opts);
  } catch {
    return null;
  }
  try {
    const data = await unsealData<unknown>(token, { password, ttl: TOKEN_TTL_SEC[typ] });
    // iron-session returns {} for a bad MAC, an unknown key id or an expired seal.
    if (data === null || typeof data !== "object" || Object.keys(data).length === 0) return null;

    const c = claims.safeParse(data);
    if (!c.success || c.data.typ !== typ) return null;
    const now = nowSec();
    if (c.data.exp + CLOCK_TOLERANCE_SEC < now) return null;
    if (c.data.iat - CLOCK_TOLERANCE_SEC > now) return null;
    if (c.data.exp <= c.data.iat) return null;

    const p = shapeFor(typ).safeParse(data);
    if (!p.success) return null;
    return { ...p.data, typ, iat: c.data.iat, exp: c.data.exp };
  } catch {
    return null;
  }
}

// ── Authorization code wire format ───────────────────────────────────────────

const CODE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(.+)$/i;

/**
 * The authorization code as sent to the client: `<grant_id>.<sealed>`. The
 * grant id is in clear so the token endpoint can load the grant's code key
 * before it can open the seal; it reveals nothing the code did not already
 * name, and the sealed part also carries it, checked on open.
 */
export function formatCode(grantId: string, sealed: string): string {
  if (!CODE_RE.test(`${grantId}.x`)) throw new TypeError("[mcp] formatCode: invalid grant id");
  return `${grantId.toLowerCase()}.${sealed}`;
}

/** Split a presented code into its grant id (lowercased) and sealed part, or null when it has the wrong shape. */
export function parseCode(code: unknown): { grantId: string; sealed: string } | null {
  if (typeof code !== "string" || code.length > MAX_TOKEN_LENGTH) return null;
  const m = CODE_RE.exec(code);
  return m ? { grantId: m[1].toLowerCase(), sealed: m[2] } : null;
}
