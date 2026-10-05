/**
 * Where the playground's raw GitHub responses come from.
 *
 *  - sampleSource(): bundled static fixtures (raw REST shapes, anonymized) —
 *    zero network.
 *  - githubSource(token): the visitor's own token; the BROWSER calls
 *    https://api.github.com directly. The token lives only in the closure
 *    passed in from React state: it is never stored, logged, put in a URL, or
 *    sent to any GitDash route.
 *
 * Both return the same Exchange records so the UI can show the exact request
 * (method + URL) next to each raw response.
 */

import sample from "./sample-responses.json";

export const GITHUB_API = "https://api.github.com";

export interface GitHubRequest {
  method: "GET";
  /** API path, e.g. `/repos/acme/app/pulls`. */
  path: string;
  params: Record<string, string>;
}

export interface Exchange {
  request: GitHubRequest;
  /** Full URL — what `curl` would hit. */
  url: string;
  status: number;
  body: unknown;
  /** `x-ratelimit-remaining` / `x-ratelimit-limit` (null for sample data). */
  rateLimit: { remaining: string; limit: string | null } | null;
  /** Set when the call failed; `body` then holds GitHub's error payload (if any). */
  error?: string;
}

export type Source = (req: GitHubRequest, signal?: AbortSignal) => Promise<Exchange>;

/** Thrown when a required call fails; carries the failed exchange for display. */
export class GitHubCallError extends Error {
  constructor(message: string, readonly exchange: Exchange) {
    super(message);
    this.name = "GitHubCallError";
  }
}

/** Canonical query string: params sorted by key, URL-encoded. Fixture keys use the same form. */
export function queryString(params: Record<string, string>): string {
  const sorted = Object.keys(params).sort().map((k) => [k, params[k]] as [string, string]);
  return new URLSearchParams(sorted).toString();
}

export function requestUrl(req: GitHubRequest): string {
  const qs = queryString(req.params);
  return `${GITHUB_API}${req.path}${qs ? `?${qs}` : ""}`;
}

/** Copy-pasteable curl for a request. Uses $GITHUB_TOKEN — never the visitor's token. */
export function curlFor(req: GitHubRequest): string {
  return [
    `curl -s "${requestUrl(req)}"`,
    `  -H "Accept: application/vnd.github+json"`,
    `  -H "Authorization: Bearer $GITHUB_TOKEN"`,
    `  -H "X-GitHub-Api-Version: 2022-11-28"`,
  ].join(" \\\n");
}

// ── Sample data ───────────────────────────────────────────────────────────────

interface SampleFile {
  owner: string;
  repo: string;
  /** The instant the sample was captured; all sample math uses it as "now". */
  now: string;
  responses: Record<string, unknown>;
}

const SAMPLE = sample as SampleFile;

export const SAMPLE_REPO = { owner: SAMPLE.owner, repo: SAMPLE.repo };
export const SAMPLE_NOW = Date.parse(SAMPLE.now);

function sampleKey(req: GitHubRequest): string {
  const qs = queryString(req.params);
  return `${req.path}${qs ? `?${qs}` : ""}`;
}

/** True when the bundled sample has a response for this request (used by tests). */
export function hasSampleResponse(req: GitHubRequest): boolean {
  return Object.prototype.hasOwnProperty.call(SAMPLE.responses, sampleKey(req));
}

export function sampleSource(): Source {
  return async (req) => {
    const url = requestUrl(req);
    const key = sampleKey(req);
    if (!Object.prototype.hasOwnProperty.call(SAMPLE.responses, key)) {
      const exchange: Exchange = { request: req, url, status: 404, body: { message: "Not Found" }, rateLimit: null, error: "Not in the sample data set" };
      throw new GitHubCallError(`Sample data has no response for ${key}`, exchange);
    }
    return { request: req, url, status: 200, body: SAMPLE.responses[key], rateLimit: null };
  };
}

// ── Live GitHub (browser → api.github.com) ────────────────────────────────────

/** GitHub owner / repo name rules (same as the server-side validation). */
const OWNER_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;

export function validateRepoInput(owner: string, repo: string): string | null {
  if (!OWNER_RE.test(owner)) return "Owner must be a GitHub user or organization name (letters, digits, single hyphens).";
  if (!REPO_RE.test(repo) || repo === "." || repo === "..") return "Repository must be a GitHub repository name (letters, digits, '.', '_', '-').";
  return null;
}

/** A GitHub token is printable ASCII with no whitespace (PATs, fine-grained PATs, OAuth/app tokens). */
const TOKEN_RE = /^[\x21-\x7e]{1,255}$/;

export function validateTokenInput(token: string): string | null {
  const t = token.trim();
  if (!t) return "Paste a GitHub token first.";
  if (!TOKEN_RE.test(t)) return "That doesn't look like a GitHub token (unexpected spaces or characters).";
  return null;
}

/** Human message for a failed GitHub response. Never includes the token. */
export function describeGitHubError(status: number, headers: Headers, body: unknown): string {
  const ghMessage =
    body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string"
      ? (body as { message: string }).message
      : null;
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = Number(headers.get("x-ratelimit-reset"));
  const resetAt = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toLocaleTimeString() : null;

  if (status === 401) return "GitHub rejected the token (401). Check that it is pasted correctly and has not expired or been revoked.";
  if ((status === 403 || status === 429) && remaining === "0") {
    return `GitHub rate limit reached${resetAt ? ` — it resets at ${resetAt}` : ""}. Try again later or use sample data.`;
  }
  if (status === 429 || (status === 403 && ghMessage && /secondary rate limit|abuse/i.test(ghMessage))) {
    return "GitHub's secondary rate limit was hit (too many requests in a short time). Wait a minute and try again.";
  }
  if (status === 403) {
    return `GitHub refused the request (403)${ghMessage ? `: ${ghMessage}` : ""}. The token may lack read access to this repository (fine-grained tokens need Contents, Pull requests, Actions and Metadata: read).`;
  }
  if (status === 404) return "Not found (404). The repository does not exist, or this token cannot see it — private repositories need a token with access to them.";
  if (status === 409) return "GitHub returned 409 — the repository is probably empty.";
  return `GitHub returned ${status}${ghMessage ? `: ${ghMessage}` : ""}.`;
}

/**
 * A Source that calls api.github.com from the browser with `token`.
 * `credentials: "omit"` and `referrerPolicy: "no-referrer"`: nothing about
 * GitDash leaks to GitHub and no cookies ride along.
 */
export function githubSource(
  token: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Source {
  const trimmed = token.trim();
  const invalid = validateTokenInput(trimmed);
  if (invalid) throw new Error(invalid);
  return async (req, signal) => {
    const url = requestUrl(req);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: req.method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${trimmed}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal,
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      const exchange: Exchange = { request: req, url, status: 0, body: null, rateLimit: null, error: "Network error" };
      throw new GitHubCallError("Could not reach api.github.com (network error, offline, or blocked by an extension).", exchange);
    }
    const remaining = res.headers.get("x-ratelimit-remaining");
    const rateLimit = remaining !== null ? { remaining, limit: res.headers.get("x-ratelimit-limit") } : null;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const exchange: Exchange = { request: req, url, status: res.status, body, rateLimit };
    if (!res.ok) {
      const message = describeGitHubError(res.status, res.headers, body);
      throw new GitHubCallError(message, { ...exchange, error: message });
    }
    return exchange;
  };
}
