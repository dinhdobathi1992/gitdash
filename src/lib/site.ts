/**
 * The site's public origin for metadata that is built without a request:
 * canonical links, the sitemap, robots.txt, Open Graph URLs and llms.txt.
 * NEXT_PUBLIC_APP_URL wins; on Vercel the production domain is the fallback.
 */
export function siteUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      return new URL(configured);
    } catch {
      // fall through to the platform default
    }
  }
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return new URL(vercel ? `https://${vercel}` : "http://localhost:3000");
}

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl()).toString();
}

/**
 * True on the public product site (GITDASH_LANDING_PAGE=true). Only that site
 * asks to be indexed; a self-hosted instance tells crawlers to stay out.
 */
export function isProductSite(): boolean {
  return process.env.GITDASH_LANDING_PAGE === "true";
}
