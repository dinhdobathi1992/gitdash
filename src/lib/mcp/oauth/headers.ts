/**
 * Response helpers for the OAuth endpoints. /oauth and /.well-known are
 * excluded from the global header block in next.config.ts, so every response
 * here sets its own headers:
 *  - machine endpoints (metadata, token, revoke, register): CORS for any
 *    origin, exactly one Access-Control-Allow-Origin, no cookies involved;
 *  - browser pages (authorize, consent): the global CSP with
 *    frame-ancestors 'none'; form-action widened only on the consent POST
 *    response, to the one redirect origin that was validated.
 */

import { MCP_CORS_HEADERS } from "@/lib/mcp/http";

const isDev = process.env.NODE_ENV !== "production";

/** Same allow and expose lists as /mcp. */
export const OAUTH_CORS_HEADERS = MCP_CORS_HEADERS;

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

/** JSON with CORS. `noStore` for anything carrying or refusing a token. */
export function corsJson(body: unknown, status = 200, extra: Record<string, string> = {}, noStore = true): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    ...(noStore ? NO_STORE : {}),
    ...extra,
  });
  for (const [k, v] of Object.entries(OAUTH_CORS_HEADERS)) headers.set(k, v);
  return new Response(JSON.stringify(body), { status, headers });
}

/** RFC 6749 §5.2 error body with CORS and no-store. */
export function oauthError(error: string, description: string, status = 400, extra: Record<string, string> = {}): Response {
  return corsJson({ error, error_description: description }, status, extra);
}

/** CORS preflight for the machine endpoints. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}

/** Add CORS headers to a response that does not have them (for example the feature gate's). */
export function addCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(OAUTH_CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * The global CSP from next.config.ts, with `form-action` replaced: 'self'
 * plus, on the consent POST response only, the validated redirect origin
 * (or `scheme:` for a native app) so the browser follows the redirect.
 */
export function pageCsp(formActionExtra?: string): string {
  return [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://avatars.githubusercontent.com https://user-images.githubusercontent.com https://*.githubusercontent.com",
    "connect-src 'self' https://api.github.com https://github.com",
    "font-src 'self' data:",
    "media-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    `form-action 'self'${formActionExtra ? ` ${formActionExtra}` : ""}`,
  ].join("; ");
}

/** Security headers for the browser-facing pages and their redirects. */
export function pageHeaders(formActionExtra?: string): Headers {
  const h = new Headers({
    "Content-Security-Policy": pageCsp(formActionExtra),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    // The query strings here carry state, challenges and nonces: never send them
    // to another origin. Not "no-referrer": that makes browsers send
    // `Origin: null` on the consent form POST, which the Origin check refuses.
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Robots-Tag": "noindex",
    ...NO_STORE,
  });
  if (!isDev) h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return h;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; padding: 2rem 1rem; background: Canvas; color: CanvasText; }
  main { max-width: 32rem; margin: 0 auto; border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 12px; padding: 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  .host { font-size: 1.1rem; font-weight: 600; word-break: break-all; }
  .muted { opacity: .75; font-size: .9rem; }
  .warn { border-left: 3px solid #d97706; padding: .25rem .75rem; margin: 1rem 0; }
  .badge { display: inline-block; font-size: .75rem; border: 1px solid #d97706; color: #d97706; border-radius: 999px; padding: 0 .5rem; }
  .actions { display: flex; gap: .75rem; margin-top: 1.5rem; }
  button, .button { font: inherit; padding: .5rem 1.25rem; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); background: transparent; color: inherit; cursor: pointer; text-decoration: none; }
  button.primary, .button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  code { word-break: break-all; }
`;

/** A minimal, self-contained HTML page (no scripts unless `script` is given). */
export function htmlPage(
  title: string,
  bodyHtml: string,
  status = 200,
  headers: Headers = pageHeaders(),
  script?: string,
): Response {
  headers.set("Content-Type", "text/html; charset=utf-8");
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">` +
    `<title>${escapeHtml(title)} · GitDash</title><style>${STYLE}</style></head>` +
    `<body><main>${bodyHtml}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
  return new Response(html, { status, headers });
}

/** An error page: never redirects anywhere. */
export function errorPage(status: number, message: string): Response {
  return htmlPage(
    "Sign-in problem",
    `<h1>Can't connect this app</h1><p>${escapeHtml(message)}</p>` +
      `<p class="muted">Close this tab and start the connection again from your app.</p>`,
    status,
  );
}
