/**
 * Per-type sealing keys for MCP OAuth tokens.
 *
 * Every token type gets its own key, derived from the session secret with
 * HKDF-SHA256 (info = "gitdash-mcp-v1:" + typ). Confusing one token type for
 * another therefore needs a key break, not just a missing `typ` check.
 *
 * Iron seals with AES-256-CBC and authenticates with HMAC-SHA256. It takes a
 * password map `{ [id]: password }`: the id is written into the token, and
 * unsealing looks the password up by that id.
 *
 * Key ids are a fingerprint of the secret they were derived from (not "1",
 * "2"), so a token keeps naming the right key across any number of rotations:
 *   - seal: the map holds only the current secret's key;
 *   - unseal: the map holds the current key and, when
 *     MCP_PREVIOUS_SESSION_SECRET is set, the previous secret's key too.
 * Rotating SESSION_SECRET = move the old value to MCP_PREVIOUS_SESSION_SECRET
 * for 30 days (the longest token lifetime), then remove it.
 *
 * Authorization codes (`mcp.code`) add one more layer: see `withCodeKey`.
 */

import { hkdfSync } from "node:crypto";
import { DEV_FALLBACK_SECRET, sessionOptions } from "@/lib/session";

export const TOKEN_TYPES = ["mcp.tx", "mcp.code", "mcp.access", "mcp.refresh", "mcp.client", "mcp.key"] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

export type PasswordMap = Record<string, string>;

const MIN_SECRET_LENGTH = 32;
const KEY_BYTES = 32;
// 6 bytes -> an integer below 2^48, exact as a JS number. iron-session picks
// the seal password with Math.max(Number(id)), so ids must be numeric.
const KEY_ID_BYTES = 6;

function hkdf(secret: string, info: string, length: number, salt: string | Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, salt, info, length));
}

/** Numeric, non-reversible id for a secret: stable across processes. */
function keyId(secret: string): string {
  return hkdf(secret, "gitdash-mcp-v1:key-id", KEY_ID_BYTES).readUIntBE(0, KEY_ID_BYTES).toString();
}

/** 32-byte key for one token type, base64url (43 chars, iron needs >= 32). */
function deriveKey(secret: string, typ: TokenType): string {
  return hkdf(secret, `gitdash-mcp-v1:${typ}`, KEY_BYTES).toString("base64url");
}

function currentSecret(): string {
  const secret = sessionOptions.password;
  // sessionOptions.password is a string today; refuse anything else rather
  // than guess which entry of a map is current.
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error("[mcp] session secret must be a string of at least 32 characters");
  }
  // The dev fallback is public: tokens sealed with it could be forged by anyone.
  if (secret === DEV_FALLBACK_SECRET && process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") {
    throw new Error("[mcp] SESSION_SECRET is not set; MCP tokens are disabled");
  }
  return secret;
}

let warnedPrevious = false;

function previousSecret(current: string): string | null {
  const prev = process.env.MCP_PREVIOUS_SESSION_SECRET?.trim();
  if (!prev) return null;
  if (prev.length < MIN_SECRET_LENGTH) {
    if (!warnedPrevious) {
      warnedPrevious = true;
      console.warn("[mcp] MCP_PREVIOUS_SESSION_SECRET is shorter than 32 characters and is ignored");
    }
    return null;
  }
  return prev === current ? null : prev;
}

// Derivation is cheap but runs on every token; memoize per (secret, typ).
const keyCache = new Map<string, { id: string; key: string }>();

function entryFor(secret: string, typ: TokenType): { id: string; key: string } {
  const cacheKey = `${typ}\u0000${secret}`;
  let entry = keyCache.get(cacheKey);
  if (!entry) {
    entry = { id: keyId(secret), key: deriveKey(secret, typ) };
    keyCache.set(cacheKey, entry);
  }
  return entry;
}

// Null-prototype map: iron looks ids up with `id in map`, so inherited names
// such as "constructor" must never resolve.
function passwordMap(entries: { id: string; key: string }[]): PasswordMap {
  const map: PasswordMap = Object.create(null);
  for (const { id, key } of entries) map[id] = key;
  return map;
}

/** Password map for sealing: only the current secret's key for `typ`. */
export function sealPasswords(typ: TokenType): PasswordMap {
  return passwordMap([entryFor(currentSecret(), typ)]);
}

/** A per-grant code key: 32 random bytes, base64url (43 characters). */
export const CODE_KEY_RE = /^[A-Za-z0-9_-]{43}$/;

const CODE_KEY_INFO = "gitdash-mcp-v1:code-key";

/**
 * Bind a password map to a grant's code key. Each password becomes
 * HKDF-SHA256(ikm = the per-type key, salt = code_key,
 * info = "gitdash-mcp-v1:code-key"), base64url, under the same key id, so
 * secret rotation keeps working. A sealed authorization code then needs both
 * SESSION_SECRET (for the per-type key) and the grant row's code_key, which
 * the database drops when the code is redeemed. Throws on a malformed code key.
 */
export function withCodeKey(map: PasswordMap, codeKey: string): PasswordMap {
  if (typeof codeKey !== "string" || !CODE_KEY_RE.test(codeKey)) throw new TypeError("[mcp] invalid code key");
  const bound: PasswordMap = Object.create(null);
  for (const id of Object.keys(map)) bound[id] = hkdf(map[id], CODE_KEY_INFO, KEY_BYTES, codeKey).toString("base64url");
  return bound;
}

/** Password map for unsealing: current key plus the previous secret's key, if configured. */
export function unsealPasswords(typ: TokenType): PasswordMap {
  const current = currentSecret();
  const prev = previousSecret(current);
  const entries = [entryFor(current, typ)];
  if (prev) {
    const p = entryFor(prev, typ);
    // A fingerprint collision would shadow the current key; drop the old one.
    if (p.id !== entries[0].id) entries.push(p);
  }
  return passwordMap(entries);
}
