/**
 * GitHub rate-limit telemetry.
 *
 * Every Octokit request (GET and writes, including free 304s) is observed in
 * src/lib/github.ts and passed to recordGitHubCall():
 *  - GITDASH_GH_LOG=1 → one structured log line per call (route, method, path,
 *    status, remaining budget). Off by default: it is noisy.
 *  - Always → a single warning per token per rate-limit window when the
 *    remaining budget drops below 10% of the limit.
 *
 * Only the token digest (never the token) and the URL path (never the query
 * string) are logged.
 */

import { AsyncLocalStorage } from "async_hooks";

const routeLabel = new AsyncLocalStorage<string>();

/**
 * Tag the current request's async context with the API route name, so GitHub
 * calls made anywhere below it (helpers, fan-outs) are attributed to the
 * route. Call once at the top of a route handler.
 */
export function labelGitHubRoute(label: string): void {
  routeLabel.enterWith(label);
}

export function currentGitHubRoute(): string {
  return routeLabel.getStore() ?? "unknown";
}

const LOW_BUDGET_RATIO = 0.1;

/**
 * `${tokenKey}:${resource}` → reset epoch (seconds) we already warned for.
 * Keyed per resource: core, search and graphql have separate budgets.
 */
const warnedUntilReset = new Map<string, number | undefined>();

type HeaderBag = Record<string, string | number | undefined> | undefined;

function num(h: HeaderBag, name: string): number | undefined {
  const v = h?.[name];
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0];
  }
}

export function recordGitHubCall(
  tokenKey: string,
  method: string,
  url: string,
  status: number,
  headers: HeaderBag,
): void {
  const remaining = num(headers, "x-ratelimit-remaining");
  const limit = num(headers, "x-ratelimit-limit");
  const reset = num(headers, "x-ratelimit-reset");
  const resource = headers?.["x-ratelimit-resource"];
  const route = currentGitHubRoute();

  if (process.env.GITDASH_GH_LOG === "1") {
    console.info(
      "[gh]",
      JSON.stringify({ route, method, path: pathOf(url), status, remaining, limit, resource, token: tokenKey }),
    );
  }

  if (remaining === undefined || !limit) return;
  if (remaining >= limit * LOW_BUDGET_RATIO) return;
  const slot = `${tokenKey}:${resource ?? "core"}`;
  // Same window = same reset epoch; a missing reset header counts as the same
  // window so it cannot turn into a warning on every call.
  if (warnedUntilReset.has(slot) && (reset === undefined || warnedUntilReset.get(slot) === reset)) return;
  warnedUntilReset.set(slot, reset);
  console.warn(
    "[gh] GitHub rate-limit budget low",
    JSON.stringify({ token: tokenKey, route, resource, remaining, limit, reset }),
  );
}

/** Test hook: forget which tokens were already warned about. */
export function __resetGitHubTelemetryForTests(): void {
  warnedUntilReset.clear();
}
