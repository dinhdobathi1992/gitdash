/** Whole-segment prefix match: "/docs" matches "/docs" and "/docs/x", not "/docsX". */
export function under(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Pages a signed-out visitor may stay on. A 401 from a background API call on
 * one of these must not bounce the visitor to sign-in.
 */
export const SIGNED_OUT_PAGES = ["/login", "/setup", "/docs", "/welcome"];

/**
 * True for a markdown-twin URL ("/docs/caching.md", "/welcome.md") that the
 * proxy hands to the /md handler. Kept here, free of page imports, so the
 * proxy bundle stays small; the handler decides whether a page exists.
 */
export function looksLikeTwin(pathname: string): boolean {
  if (!pathname.endsWith(".md")) return false;
  return pathname === "/docs.md" || pathname.startsWith("/docs/") || ["/index.md", "/index.html.md", "/welcome.md"].includes(pathname);
}
