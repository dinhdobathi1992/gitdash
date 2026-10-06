import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { APP_VERSION } from "@/components/shell/Logo";
import { SEARCH_INDEX } from "@/components/docs/search-index";
import { ALL_SECTIONS, docHref, findSection } from "../_parts/nav";
import { SECTION_COMPONENTS } from "../_parts/registry";
import { absoluteUrl } from "@/lib/site";

/** TechArticle + breadcrumb for one docs page; values match the visible page. */
function DocStructuredData({ id, label, description }: { id: string; label: string; description: string }) {
  const url = absoluteUrl(docHref(id));
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        headline: label,
        description,
        url,
        inLanguage: "en",
        isPartOf: { "@type": "WebSite", name: "GitDash", url: absoluteUrl("/") },
        about: { "@type": "SoftwareApplication", name: "GitDash", softwareVersion: APP_VERSION },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Docs", item: absoluteUrl("/docs") },
          ...(docHref(id) === "/docs" ? [] : [{ "@type": "ListItem", position: 2, name: label, item: url }]),
        ],
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output with "<" escaped cannot break out of the script element.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</g, "\\u003c") }}
    />
  );
}

function describe(id: string, label: string): string {
  const summary = SEARCH_INDEX.find((s) => s.id === id)?.excerpt;
  return summary ? `${label} — ${summary}` : `${label} in the GitDash documentation.`;
}

/** Title, description, canonical and markdown twin for one docs page. */
export function docMetadata(id: string): Metadata {
  const section = findSection(id);
  if (!section) return {};
  const href = docHref(id);
  const description = describe(id, section.label);
  return {
    title: section.label,
    description,
    alternates: { canonical: href, types: { "text/markdown": `${href}.md` } },
    openGraph: { title: `${section.label} — GitDash Docs`, description, url: href, type: "article" },
  };
}

/** One server-rendered docs page with previous/next links. */
export function DocPage({ id }: { id: string }) {
  const Section = SECTION_COMPONENTS[id];
  const section = findSection(id);
  if (!Section || !section) notFound();

  const index = ALL_SECTIONS.findIndex((s) => s.id === id);
  const prev = index > 0 ? ALL_SECTIONS[index - 1] : null;
  const next = index < ALL_SECTIONS.length - 1 ? ALL_SECTIONS[index + 1] : null;

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <DocStructuredData id={id} label={section.label} description={describe(id, section.label)} />
      {/* data-doc-content marks what the markdown twin and llms-full.txt carry. */}
      <article data-doc-content>
        <Section />
      </article>

      <nav aria-label="Previous and next page" className="mt-16 pt-6 border-t border-slate-800 flex items-center justify-between gap-4">
        {prev ? (
          <Link href={docHref(prev.id)} className="group flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
            <ChevronRight className="w-4 h-4 rotate-180 shrink-0 text-slate-600 group-hover:text-violet-400 transition-colors" aria-hidden="true" />
            <span className="text-left">
              <span className="block text-xs text-slate-600">Previous</span>
              <span className="block font-medium">{prev.label}</span>
            </span>
          </Link>
        ) : <span />}
        {next ? (
          <Link href={docHref(next.id)} className="group flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors text-right">
            <span>
              <span className="block text-xs text-slate-600">Next</span>
              <span className="block font-medium">{next.label}</span>
            </span>
            <ChevronRight className="w-4 h-4 shrink-0 text-slate-600 group-hover:text-violet-400 transition-colors" aria-hidden="true" />
          </Link>
        ) : <span />}
      </nav>

      <footer className="mt-8 pb-4 text-center text-xs text-slate-600 space-y-1">
        <p>GitDash v{APP_VERSION} — GitHub Actions Dashboard</p>
        <p className="flex flex-wrap justify-center gap-x-3">
          <a href="https://github.com/dinhdobathi1992/gitdash" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center hover:text-slate-400 transition-colors">
            Open source on GitHub
          </a>
          <Link href="/docs/privacy" className="inline-flex min-h-6 items-center hover:text-slate-400 transition-colors">Data &amp; privacy</Link>
          <a href="https://github.com/dinhdobathi1992/gitdash/issues" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center hover:text-slate-400 transition-colors">
            Report an issue
          </a>
        </p>
      </footer>
    </main>
  );
}
