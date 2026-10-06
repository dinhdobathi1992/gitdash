/**
 * Markdown twins: every public content page /path also answers at /path.md.
 * The twin is made from the page's own server-rendered HTML, so the two can
 * never drift. src/proxy.ts rewrites "*.md" to /md/<path>, which renders it.
 */

import { APP_VERSION } from "@/components/shell/Logo";
import { ALL_SECTIONS, docHref } from "@/app/docs/_parts/nav";
import { findNode, nodeToMarkdown, parseHtml } from "@/lib/html-to-markdown";
import { absoluteUrl } from "@/lib/site";

/** Page path → its markdown twin path. The landing page also answers at /index.md. */
export function twinPath(pagePath: string): string {
  return `${pagePath}.md`;
}

/** The HTML page behind a twin path ("/docs/caching.md" → "/docs/caching"), or null if it has none. */
export function pageForTwin(mdPath: string): string | null {
  if (["/index.md", "/index.html.md", "/welcome.md"].includes(mdPath)) return "/welcome";
  const page = mdPath.replace(/\.md$/, "");
  return ALL_SECTIONS.some((s) => docHref(s.id) === page) ? page : null;
}

export const MARKDOWN_HEADERS = {
  "Content-Type": "text/markdown; charset=utf-8",
  // Twins are for agents; the HTML page is the one search engines should rank.
  "X-Robots-Tag": "noindex",
  // Content changes only with a deploy, which clears the CDN cache.
  "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
} as const;

/** Public pages only change with a deploy, which starts a new process: convert each once. */
const cache = new Map<string, string>();
/** Pages that just failed are not refetched for a minute, so a broken page cannot amplify traffic. */
const FAILURE_TTL_MS = 60_000;
const failedUntil = new Map<string, number>();
/** One fetch per page at a time; concurrent callers share it. */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Where to fetch this server's own pages. On Vercel that is the request's
 * origin. Elsewhere (Docker, Kubernetes) the public URL may not be reachable
 * from inside the container, so go straight to the local listener.
 */
export function selfOrigin(requestOrigin: string): string {
  if (process.env.VERCEL) return requestOrigin;
  return `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
}

/**
 * Fetch a public page from this same server and convert its main content.
 * Docs pages mark their content with data-doc-content; the landing page uses <main>.
 */
export async function pageMarkdown(pagePath: string, origin: string): Promise<string | null> {
  const hit = cache.get(pagePath);
  if (hit) return hit;
  if ((failedUntil.get(pagePath) ?? 0) > Date.now()) return null;
  let pending = inFlight.get(pagePath);
  if (!pending) {
    pending = convert(pagePath, origin)
      .then((md) => {
        if (md) cache.set(pagePath, md);
        else failedUntil.set(pagePath, Date.now() + FAILURE_TTL_MS);
        return md;
      })
      .finally(() => inFlight.delete(pagePath));
    inFlight.set(pagePath, pending);
  }
  return pending;
}

async function convert(pagePath: string, origin: string): Promise<string | null> {
  const url = new URL(pagePath, selfOrigin(origin));
  let html: string;
  try {
    const res = await fetch(url, { headers: { accept: "text/html" }, redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.warn(`[markdown-twin] ${url} answered ${res.status}`);
      return null;
    }
    html = await res.text();
  } catch (err) {
    console.warn(`[markdown-twin] could not fetch ${url}: ${(err as Error).name}`);
    return null;
  }
  const tree = parseHtml(html);
  const main =
    findNode(tree, (n) => "data-doc-content" in n.attrs) ??
    findNode(tree, (n) => n.tag === "main");
  if (!main) return null;
  const canonical = absoluteUrl(pagePath);
  return `> Source: ${canonical} · GitDash v${APP_VERSION}\n\n${nodeToMarkdown(main, canonical)}\n`;
}
