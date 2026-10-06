/**
 * The GitDash MCP server definition. /mcp serves the public docs tools;
 * /mcp/me (signed in) serves the same docs tools plus the read-only data tools.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createMcpHandler } from "mcp-handler";
import { APP_VERSION } from "@/components/shell/Logo";
import { registerDocsTools } from "./docs-tools";
import { registerDataTools } from "./data-tools";

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

const ME_INSTRUCTIONS =
  INSTRUCTIONS +
  " Signed in, you also get read-only data tools (list_repos, repo_overview, repo_dora, failing_workflows, open_pr_health, " +
  "org_health, actions_cost) that return what you can see in the GitDash web app.";

const meHandler = createMcpHandler(
  (server) => {
    registerDocsTools(server, currentOrigin);
    registerDataTools(server);
  },
  { serverInfo: { name: "gitdash", version: APP_VERSION }, instructions: ME_INSTRUCTIONS },
);

/**
 * Serve one signed-in MCP request (/mcp/me). The route has already verified
 * the bearer token and put its AuthInfo on `req.auth`; tools read it from
 * `ctx.http.authInfo`.
 */
export function handleMeRequest(req: Request, origin: string): Promise<Response> {
  return requestOrigin.run(origin, () => meHandler(req));
}
