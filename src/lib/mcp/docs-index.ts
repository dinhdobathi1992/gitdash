/**
 * Full-text index over the public docs for the MCP docs tools.
 *
 * Titles and summaries come from static sources (nav + search index) and are
 * always available. Page bodies come from the markdown twins (self-fetch via
 * pageMarkdown). A partial build is never cached as complete: when any page
 * fails, searches fall back to titles and summaries and the bodies are retried
 * after a minute.
 */

import { ALL_SECTIONS, docHref } from "@/app/docs/_parts/nav";
import { SEARCH_INDEX } from "@/components/docs/search-index";
import { pageMarkdown } from "@/lib/markdown-twin";
import { absoluteUrl } from "@/lib/site";

export type DocEntry = { id: string; title: string; summary: string; url: string; body?: string };

const RETRY_MS = 60_000;
const CONCURRENCY = 4;

let bodies: Map<string, string> | null = null;
let retryAt = 0;
let building: Promise<void> | null = null;

/** Static entries: every docs page with its title and summary. Never fails. */
export function docEntries(): DocEntry[] {
  return ALL_SECTIONS.map((s) => ({
    id: s.id,
    title: s.label,
    summary: SEARCH_INDEX.find((e) => e.id === s.id)?.excerpt ?? "",
    url: absoluteUrl(docHref(s.id)),
  }));
}

/** The markdown of one docs page, or null when it cannot be rendered right now. */
export function docMarkdown(id: string, origin: string): Promise<string | null> {
  return pageMarkdown(docHref(id), origin);
}

async function buildBodies(origin: string): Promise<void> {
  const ids = ALL_SECTIONS.map((s) => s.id);
  const out = new Map<string, string>();
  let failed = 0;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((id) => docMarkdown(id, origin)));
    results.forEach((md, j) => (md ? out.set(batch[j], md) : failed++));
  }
  if (failed === 0) {
    bodies = out;
  } else {
    console.warn(`[mcp] docs index: ${failed} of ${ids.length} pages unavailable; using titles and summaries`);
    retryAt = Date.now() + RETRY_MS;
  }
}

/** Entries with bodies when the full index is available; titles and summaries otherwise. */
export async function indexedEntries(origin: string): Promise<DocEntry[]> {
  if (!bodies && Date.now() >= retryAt) {
    building ??= buildBodies(origin).finally(() => { building = null; });
    await building;
  }
  const entries = docEntries();
  return bodies ? entries.map((e) => ({ ...e, body: bodies!.get(e.id) })) : entries;
}

function terms(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

function count(haystack: string, term: string): number {
  let n = 0;
  for (let i = haystack.indexOf(term); i !== -1; i = haystack.indexOf(term, i + term.length)) n++;
  return n;
}

/** Term-frequency score: title ×5, summary ×2, body ×1. */
export function score(entry: DocEntry, query: string): number {
  const title = entry.title.toLowerCase();
  const summary = entry.summary.toLowerCase();
  const body = entry.body?.toLowerCase() ?? "";
  return terms(query).reduce((sum, t) => sum + 5 * count(title, t) + 2 * count(summary, t) + count(body, t), 0);
}

/** About 300 characters around the first match, else the summary. */
export function excerpt(entry: DocEntry, query: string): string {
  const body = entry.body ?? "";
  const first = terms(query).map((t) => body.toLowerCase().indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (first === undefined) return entry.summary;
  const start = Math.max(0, first - 120);
  const text = body.slice(start, start + 300).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}${start + 300 < body.length ? "…" : ""}`;
}

/** Split markdown into its H2/H3 sections. */
export function sections(markdown: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of markdown.split("\n")) {
    const h = line.match(/^#{2,3} (.+)$/);
    if (h) {
      if (current) out.push({ heading: current.heading, text: current.lines.join("\n").trim() });
      current = { heading: h[1].trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) out.push({ heading: current.heading, text: current.lines.join("\n").trim() });
  return out;
}

export type TableMatch = { heading: string; header: string; row: string };

/**
 * Table rows whose first cell names the metric, with the table header and the
 * section heading above them. Metric definitions in the docs live in such rows
 * ("| Time to Restore (MTTR) | … |").
 */
export function tableRowsNaming(markdown: string, aliases: string[]): TableMatch[] {
  const out: TableMatch[] = [];
  let heading = "";
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{1,3} (.+)$/);
    if (h) heading = h[1].trim();
    if (!lines[i].startsWith("|") || !lines[i + 1]?.startsWith("| ---")) continue;
    const header = lines[i];
    for (i += 2; i < lines.length && lines[i].startsWith("|"); i++) {
      const first = lines[i].split("|")[1]?.trim().toLowerCase() ?? "";
      if (aliases.some((a) => first.includes(a))) out.push({ heading, header, row: lines[i] });
    }
  }
  return out;
}

/** Test hook: forget the cached bodies. */
export function __resetDocsIndexForTests(): void {
  bodies = null;
  retryAt = 0;
  building = null;
}
