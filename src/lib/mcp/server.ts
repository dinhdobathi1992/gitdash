/**
 * The GitDash MCP server definition. /mcp serves the public docs tools; the
 * signed-in endpoint planned for later reuses this module and adds data tools.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createMcpHandler } from "mcp-handler";
import { APP_VERSION } from "@/components/shell/Logo";
import { registerDocsTools } from "./docs-tools";

const INSTRUCTIONS =
  "GitDash is a self-hosted dashboard for GitHub Actions and pull requests: DORA, reliability, cost and team health. " +
  "These tools answer questions about GitDash itself — setup, configuration, access control and what each metric means. " +
  "Start with search_docs or explain_metric; use get_doc for a whole page.";

/**
 * The request origin for the call in progress. The docs tools render pages
 * from this same server, and on Vercel that means the request's own origin;
 * the server factory has no access to the request, so the route provides it.
 */
const requestOrigin = new AsyncLocalStorage<string>();

export function currentOrigin(): string {
  return requestOrigin.getStore() ?? "http://localhost";
}

const handler = createMcpHandler((server) => registerDocsTools(server, currentOrigin), {
  serverInfo: { name: "gitdash", version: APP_VERSION },
  instructions: INSTRUCTIONS,
});

/** Serve one MCP request with its origin available to the tools. */
export function handleDocsRequest(req: Request, origin: string): Promise<Response> {
  return requestOrigin.run(origin, () => handler(req));
}
