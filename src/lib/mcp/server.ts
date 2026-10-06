/**
 * The GitDash MCP server definition. /mcp serves the public docs tools; the
 * signed-in endpoint planned for later reuses this module and adds data tools.
 */

import { createMcpHandler } from "mcp-handler";
import { APP_VERSION } from "@/components/shell/Logo";
import { registerDocsTools } from "./docs-tools";

const INSTRUCTIONS =
  "GitDash is a self-hosted dashboard for GitHub Actions and pull requests: DORA, reliability, cost and team health. " +
  "These tools answer questions about GitDash itself — setup, configuration, access control and what each metric means. " +
  "Start with search_docs or explain_metric; use get_doc for a whole page.";

const handlers = new Map<string, (req: Request) => Promise<Response>>();

/**
 * One handler per origin: the docs tools render pages from this same server,
 * and on Vercel that means the request's own origin. A deployment serves only
 * a handful of origins, so the map stays small.
 */
export function docsHandler(origin: string): (req: Request) => Promise<Response> {
  let handler = handlers.get(origin);
  if (!handler) {
    handler = createMcpHandler((server) => registerDocsTools(server, origin), {
      serverInfo: { name: "gitdash", version: APP_VERSION },
      instructions: INSTRUCTIONS,
    });
    handlers.set(origin, handler);
  }
  return handler;
}
