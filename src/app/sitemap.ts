import type { MetadataRoute } from "next";
import { absoluteUrl, isProductSite } from "@/lib/site";
import { ALL_SECTIONS, docHref } from "@/app/docs/_parts/nav";

export const dynamic = "force-dynamic";

/**
 * Public, indexable pages only: the landing page, every docs page and the API
 * playground. No lastmod: the pages carry no trustworthy per-page date, and a
 * build timestamp would claim every page changed on every deploy.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isProductSite()) return [];
  const paths = ["/welcome", ...ALL_SECTIONS.map((s) => docHref(s.id)), "/docs/playground"];
  return paths.map((p) => ({ url: absoluteUrl(p) }));
}
