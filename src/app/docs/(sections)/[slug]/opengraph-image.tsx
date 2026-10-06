import { ogCard, OG_SIZE } from "@/lib/og-card";
import { ALL_SECTIONS, HOME_SECTION, findSection } from "../../_parts/nav";
import { SEARCH_INDEX } from "@/components/docs/search-index";

export const alt = "GitDash Docs page";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return ALL_SECTIONS.filter((s) => s.id !== HOME_SECTION).map((s) => ({ slug: s.id }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const section = findSection(slug);
  const summary = SEARCH_INDEX.find((s) => s.id === slug)?.excerpt ?? "GitDash documentation.";
  return ogCard({
    eyebrow: "Docs",
    title: section?.label ?? "GitDash Docs",
    subtitle: summary.length > 110 ? `${summary.slice(0, 107).trimEnd()}…` : summary,
  });
}
