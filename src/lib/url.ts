import { NextRequest } from "next/server";

/**
 * Build a URL using the externally-visible origin.
 *
 * Behind a reverse proxy (NGINX ingress, ALB, etc.) the raw req.url may
 * resolve to the container address (e.g. http://0.0.0.0:3000). We reconstruct
 * the public origin from the standard forwarding headers the proxy sets, with
 * a fallback to NEXT_PUBLIC_APP_URL, and finally to req.url.
 */
export function publicUrl(path: string, req: NextRequest): URL {
  // Chained proxies send comma-joined lists ("https, http"); the first value is
  // the one the client used.
  const first = (v: string | null) => v?.split(",")[0].trim() || null;
  const proto =
    first(req.headers.get("x-forwarded-proto")) ??
    (req.nextUrl.protocol === "https:" ? "https" : "http");
  const host =
    first(req.headers.get("x-forwarded-host")) ?? req.headers.get("host");

  if (host) {
    return new URL(path, `${proto}://${host}`);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    return new URL(path, appUrl);
  }

  return new URL(path, req.url);
}

/**
 * True when a state-changing request comes from this app's own origin.
 * Browsers always send `Origin` on cross-site POSTs, so a missing or foreign
 * Origin is rejected (login CSRF / cross-site writes).
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  if (origin === publicUrl("/", req).origin || origin === req.nextUrl.origin) return true;
  // Behind a proxy that rewrites Host without X-Forwarded-Host, fall back to
  // the configured public URL.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return false;
  try {
    return origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}
