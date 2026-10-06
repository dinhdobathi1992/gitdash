/**
 * Shared result shape and option bag for the data loaders.
 *
 * Loaders take the GitHub token as an argument so a web route and an MCP tool
 * run the same validate -> cache -> compute path with the same cache keys.
 * They never read the session: the caller owns authentication and HTTP.
 *
 * Expected failures (bad input, billing 403/404) come back as `{ ok: false }`.
 * Unexpected GitHub or runtime errors are thrown; the caller maps them
 * (routes use safeError, MCP tools return a tool error).
 */

import { labelGitHubRoute } from "@/lib/github-telemetry";
import type { ValidationResult } from "@/lib/validation";

export type LoaderResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; hint?: string };

export interface LoaderOptions {
  /** Telemetry label for GitHub calls (for example "mcp/repo_dora"). When absent, the caller's label applies. */
  label?: string;
  /** Bypass the cached value and recompute. Only loaders whose route supports a forced refresh read it. */
  refresh?: boolean;
}

export function applyLabel(opts?: LoaderOptions): void {
  if (opts?.label) labelGitHubRoute(opts.label);
}

export function loaderOk<T>(data: T): LoaderResult<T> {
  return { ok: true, data };
}

export function loaderFail(status: number, error: string, hint?: string): LoaderResult<never> {
  return hint === undefined ? { ok: false, status, error } : { ok: false, status, error, hint };
}

/**
 * Convert a failed validator result (which carries a NextResponse) into a
 * loader failure, so the error text stays defined in one place: validation.ts.
 */
export async function validationFailure(
  result: Extract<ValidationResult<unknown>, { ok: false }>,
): Promise<LoaderResult<never>> {
  const body = (await result.response.json()) as { error: string };
  return loaderFail(result.response.status, body.error);
}
