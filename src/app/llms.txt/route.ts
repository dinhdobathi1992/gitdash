import { NAV, docHref } from "@/app/docs/_parts/nav";
import { SEARCH_INDEX } from "@/components/docs/search-index";
import { MARKDOWN_HEADERS, twinPath } from "@/lib/markdown-twin";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/** llms.txt (llmstxt.org): what GitDash is, then every docs page as a markdown link. */
export function GET() {
  const summary = (id: string) => SEARCH_INDEX.find((s) => s.id === id)?.excerpt;
  const sections = NAV.map((group) => [
    `## ${group.title}`,
    "",
    ...group.items.map((item) => {
      const note = summary(item.id);
      return `- [${item.label}](${absoluteUrl(twinPath(docHref(item.id)))})${note ? `: ${note}` : ""}`;
    }),
  ].join("\n"));

  const body = [
    "# GitDash",
    "",
    "> Self-hosted, open-source (MIT) dashboard that turns GitHub Actions runs and pull requests into DORA, reliability, cost and team-health metrics, using each person's own GitHub token.",
    "",
    "Runs as a Docker image, a Helm chart or on Vercel, in standalone mode (one person, a personal access token) or organization mode (GitHub sign-in, groups and Postgres).",
    "",
    `- [Product overview](${absoluteUrl("/welcome.md")}): what GitDash shows and how it is deployed.`,
    `- [Full documentation in one file](${absoluteUrl("/llms-full.txt")})`,
    `- MCP server: ${absoluteUrl("/mcp")} (Streamable HTTP, read-only docs tools; see [MCP server](${absoluteUrl("/docs/mcp.md")}))`,
    "",
    ...sections.flatMap((s) => [s, ""]),
    "## Optional",
    "",
    `- [GitHub API playground](${absoluteUrl("/docs/playground")}): interactive page showing the raw GitHub responses behind each metric.`,
    "- [Source code](https://github.com/dinhdobathi1992/gitdash)",
    "",
  ].join("\n");

  return new Response(body, { headers: { ...MARKDOWN_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}
