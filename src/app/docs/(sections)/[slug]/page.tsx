import type { Metadata } from "next";
import { DocPage, docMetadata } from "../doc-page";
import { ALL_SECTIONS, HOME_SECTION } from "../../_parts/nav";

// Every docs page is known at build time; anything else is a 404.
export const dynamicParams = false;

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return ALL_SECTIONS.filter((s) => s.id !== HOME_SECTION).map((s) => ({ slug: s.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return docMetadata(slug);
}

export default async function DocsSectionPage({ params }: Props) {
  const { slug } = await params;
  return <DocPage id={slug} />;
}
