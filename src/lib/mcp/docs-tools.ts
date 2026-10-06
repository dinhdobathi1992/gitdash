/**
 * Public MCP docs tools: read-only, no sign-in. They answer from the same
 * content as /docs and its markdown twins.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { ALL_SECTIONS } from "@/app/docs/_parts/nav";
import { docEntries, docMarkdown, excerpt, indexedEntries, score, sections, tableRowsNaming } from "./docs-index";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const PAGE_IDS = ALL_SECTIONS.map((s) => s.id) as [string, ...string[]];
const METRIC_PAGES = PAGE_IDS.filter((id) => id.startsWith("metrics-") && id !== "metrics-reference");

/**
 * Metric aliases: what people type → names the metrics reference uses in the
 * first column of its tables. Unlisted input is matched as typed.
 */
const METRIC_ALIASES: [string[], string[]][] = [
  [["mttr", "time to restore", "time to recovery", "mean time to recovery", "mean time to restore"], ["mttr", "time to restore"]],
  [["cfr", "change failure rate", "failure rate"], ["change failure rate"]],
  [["deploy frequency", "deployment frequency", "deploys"], ["deploy frequency", "deployment frequency"]],
  [["lead time", "lead time for changes"], ["lead time"]],
  [["cycle time", "pr cycle time"], ["cycle time"]],
  [["pickup", "pickup time"], ["pickup"]],
  [["p95", "p95 duration"], ["p95"]],
  [["bus factor"], ["bus factor"]],
  [["flaky", "flaky branches", "flakiness"], ["flaky"]],
];

function aliasesFor(metric: string): string[] {
  const key = metric.toLowerCase().trim();
  return METRIC_ALIASES.find(([typed]) => typed.includes(key))?.[1] ?? [key];
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

export function registerDocsTools(server: McpServer, origin: string): void {
  server.registerTool(
    "list_docs",
    {
      title: "List GitDash docs pages",
      description: "Every GitDash documentation page with its id, title, one-line summary and URL. Use an id with get_doc.",
      annotations: READ_ONLY,
    },
    async () => text(docEntries().map((e) => `- ${e.id} — ${e.title}: ${e.summary} (${e.url})`).join("\n")),
  );

  server.registerTool(
    "search_docs",
    {
      title: "Search GitDash docs",
      description: "Full-text search over the GitDash documentation. Returns the five best pages with an excerpt and URL.",
      inputSchema: z.object({ query: z.string().min(2).max(200).describe("Words to search for, e.g. 'rate limit' or 'Helm values'") }),
      annotations: READ_ONLY,
    },
    async ({ query }) => {
      const ranked = (await indexedEntries(origin))
        .map((e) => ({ e, s: score(e, query) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 5);
      if (!ranked.length) return text(`No docs page matches "${query}". Use list_docs to browse every page.`);
      return text(ranked.map(({ e }) => `## ${e.title} (id: ${e.id})\n${e.url}\n\n${excerpt(e, query)}`).join("\n\n"));
    },
  );

  server.registerTool(
    "get_doc",
    {
      title: "Read a GitDash docs page",
      description: "The full text of one GitDash documentation page as Markdown.",
      inputSchema: z.object({ page: z.enum(PAGE_IDS).describe("Page id from list_docs, e.g. 'quick-start' or 'metrics-dora'") }),
      annotations: READ_ONLY,
    },
    async ({ page }) => {
      const md = await docMarkdown(page, origin);
      return md ? text(md) : fail(`The page "${page}" is unavailable right now. Try again shortly.`);
    },
  );

  server.registerTool(
    "explain_metric",
    {
      title: "Explain a GitDash metric",
      description:
        "What a GitDash metric measures, how it is calculated and what a good value looks like, from the metrics reference. " +
        "Examples: 'lead time', 'change failure rate', 'MTTR', 'bus factor', 'pickup time', 'p95 duration'.",
      inputSchema: z.object({ metric: z.string().min(2).max(80).describe("Metric name in plain words") }),
      annotations: READ_ONLY,
    },
    async ({ metric }) => {
      const aliases = aliasesFor(metric);
      const pages = await Promise.all(METRIC_PAGES.map(async (id) => ({ id, md: await docMarkdown(id, origin) })));

      // 1. Definition rows: every table row whose first cell names the metric.
      const rows = pages.flatMap(({ id, md }) => (md ? tableRowsNaming(md, aliases).map((m) => ({ ...m, id })) : []));
      if (rows.length) {
        return text(
          rows
            .map((r) => `### ${r.heading}\n\n${r.header}\n${r.header.replace(/[^|]+/g, " --- ")}\n${r.row}\n\n(Source: get_doc("${r.id}"))`)
            .join("\n\n"),
        );
      }

      // 2. A section headed by the metric, else 3. the best-scoring section.
      let best: { heading: string; text: string; id: string; s: number } | null = null;
      for (const { id, md } of pages) {
        if (!md) continue;
        for (const sec of sections(md)) {
          const headed = aliases.some((a) => sec.heading.toLowerCase().includes(a)) ? 1000 : 0;
          const s = headed + score({ id, title: sec.heading, summary: "", url: "", body: sec.text }, aliases.join(" "));
          if (s > 0 && (!best || s > best.s)) best = { ...sec, id, s };
        }
      }
      if (!best) return fail(`No metric matches "${metric}". Try search_docs, or get_doc("metrics-reference") for the full list.`);
      return text(`${best.text}\n\n(Source: get_doc("${best.id}"))`);
    },
  );
}
