/**
 * Symmetric encryption for secrets stored in the database (v4.1.3).
 *
 * Email provider API keys are entered in Settings and persisted, which means
 * they land in every database backup and every `pg_dump`. Storing them in
 * plaintext would make a leaked backup equivalent to a leaked credential, so
 * they are sealed here first.
 *
 * The key is derived from SESSION_SECRET, which the app already requires to be
 * >= 32 characters in production and already treats as its root secret (it
 * encrypts session cookies). Deriving rather than reusing it directly means a
 * sealed value cannot be fed to the session layer or vice versa.
 *
 * Threat model, stated plainly: this protects against a leaked *database*.
 * It does not protect against an attacker who has both the database and the
 * environment — at that point they have SESSION_SECRET and can unseal. That
 * is the same bar as the rest of the app's secret handling.
 *
 * Format: v1.<iv-b64>.<tag-b64>.<ciphertext-b64>
 * The version prefix exists so the algorithm can be rotated later without
 * guessing at what an existing row contains.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard

function derivedKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "[GitDash] SESSION_SECRET must be set to at least 32 characters before secrets can be stored.",
    );
  }
  // Domain-separated from the session cookie's use of the same root secret.
  return createHash("sha256").update(`gitdash:secret-box:v1:${secret}`).digest();
}

/** Encrypt a plaintext secret for storage. Returns an opaque, versioned string. */
export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, derivedKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/**
 * Decrypt a sealed secret. Returns null rather than throwing on any problem —
 * a corrupted or wrong-key row should degrade to "email not configured",
 * never take down the cron that reads it.
 */
export function unseal(sealed: string): string | null {
  try {
    const parts = sealed.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION) return null;
    const [, ivB64, tagB64, dataB64] = parts;

    const decipher = createDecipheriv(ALGORITHM, derivedKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    // Wrong key, tampered ciphertext, or malformed input — all indistinguishable
    // to the caller by design.
    return null;
  }
}

/**
 * Last-4 hint for the UI, so a user can tell which key is stored without the
 * server ever returning it. Short secrets reveal nothing at all.
 */
export function maskHint(plaintext: string): string {
  if (plaintext.length < 8) return "••••";
  return `••••${plaintext.slice(-4)}`;
}
