import type { MetadataRoute } from "next";
import { absoluteUrl, isProductSite } from "@/lib/site";

// Read the environment per request: the same image serves the product site
// and private self-hosted instances.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (!isProductSite()) {
    // A self-hosted GitDash is a private tool: keep every crawler out.
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  // Product site: search, answer and training crawlers are all welcome to the
  // public pages. Sign-in pages stay crawlable so their noindex header is seen.
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
