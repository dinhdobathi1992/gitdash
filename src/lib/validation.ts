import { NextResponse } from "next/server";

/**
 * HIGH-003: Shared input validation for GitHub API parameters.
 * Validates and sanitises user-supplied query params before forwarding to Octokit.
 */

// GitHub usernames/org names: alphanumeric + hyphens, 1-39 chars
const GITHUB_IDENTIFIER_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$|^[a-zA-Z0-9]$/;

// Repo names: alphanumeric, hyphens, underscores, dots — 1-100 chars
const GITHUB_REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

/** Validate a GitHub owner (user login or org login). */
export function validateOwner(raw: string | null): ValidationResult<string> {
  if (!raw || !GITHUB_IDENTIFIER_RE.test(raw)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid owner parameter" },
        { status: 400 }
      ),
    };
  }
  return { ok: true, data: raw };
}

/** Validate a GitHub repo name. */
export function validateRepo(raw: string | null): ValidationResult<string> {
  if (!raw || !GITHUB_REPO_RE.test(raw)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid repo parameter" },
        { status: 400 }
      ),
    };
  }
  return { ok: true, data: raw };
}

/** Validate an org login (same rules as owner). */
export function validateOrg(raw: string | null): ValidationResult<string> {
  if (!raw || !GITHUB_IDENTIFIER_RE.test(raw)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid org parameter" },
        { status: 400 }
      ),
    };
  }
  return { ok: true, data: raw };
}

/** Validate a numeric workflow or run ID. */
export function validateId(raw: string | null, name = "id"): ValidationResult<number> {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!raw || isNaN(n) || n <= 0 || !Number.isInteger(n)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Invalid ${name} parameter` },
        { status: 400 }
      ),
    };
  }
  return { ok: true, data: n };
}

/** Validate per_page — clamp to [1, 100]. */
export function validatePerPage(raw: string | null, defaultVal = 50): ValidationResult<number> {
  if (!raw) return { ok: true, data: defaultVal };
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid per_page parameter" }, { status: 400 }),
    };
  }
  // Clamp silently to max 100 to prevent GitHub API abuse
  return { ok: true, data: Math.min(n, 100) };
}

/**
 * MED-002: Return a safe error response.
 * Logs the real error server-side; sends a generic message to the client.
 */
export function safeError(error: unknown, publicMessage: string, status = 500): NextResponse {
  // Always log server-side for debugging
  if (error instanceof Error) {
    console.error(`[GitDash API Error] ${publicMessage}:`, error.message);
  } else {
    console.error(`[GitDash API Error] ${publicMessage}:`, error);
  }
  return NextResponse.json({ error: publicMessage }, { status });
}
