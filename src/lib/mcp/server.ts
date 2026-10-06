/**
 * The GitDash MCP server definition. /mcp serves the public docs tools; the
 * signed-in endpoint planned for later reuses this module and adds data tools.
 */

import { createMcpHandler } from "mcp-handler";
import { APP_VERSION } from "@/components/shell/Logo";
import { selfOrigin } from "@/lib/markdown-twin";
import { registerDocsTools } from "./docs-tools";

const INSTRUCTIONS =
  "GitDash is a self-hosted dashboard for GitHub Actions and pull requests: DORA, reliability, cost and team health. " +
  "These tools answer questions about GitDash itself — setup, configuration, access control and what each metric means. " +
  "Start with search_docs or explain_metric; use get_doc for a whole page.";

const handlers = new Map<string, (req: Request) => Promise<Response>>();
const MAX_HANDLERS = 20;

/**
 * One handler per self-origin: the docs tools render pages from this same
 * server. Off Vercel that is always the local listener, so there is one
 * handler; on Vercel it is the request origin, which Vercel limits to the
 * project's domains. The cap guards against a client cycling Host headers.
 */
export function docsHandler(origin: string): (req: Request) => Promise<Response> {
  const key = selfOrigin(origin);
  let handler = handlers.get(key);
  if (!handler) {
    if (handlers.size >= MAX_HANDLERS) handlers.clear();
    handler = createMcpHandler((server) => registerDocsTools(server, origin), {
      serverInfo: { name: "gitdash", version: APP_VERSION },
      instructions: INSTRUCTIONS,
    });
    handlers.set(key, handler);
  }
  return handler;
}

/** Test hook: how many handlers are cached. */
export function __handlerCountForTests(): number {
  return handlers.size;
}
