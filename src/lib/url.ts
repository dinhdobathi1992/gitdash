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
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (req.nextUrl.protocol === "https:" ? "https" : "http");
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host");

  if (host) {
    return new URL(path, `${proto}://${host}`);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    return new URL(path, appUrl);
  }

  return new URL(path, req.url);
}
