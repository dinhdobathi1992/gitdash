import { NextRequest } from "next/server";
import { MARKDOWN_HEADERS, pageForTwin, pageMarkdown } from "@/lib/markdown-twin";

/**
 * Markdown twin of a public page. Reached only through the proxy's rewrite of
 * "/<page>.md"; any path without a public page behind it is a 404.
 */
export async function GET(req: NextRequest, { params }: RouteContext<"/md/[...path]">) {
  const { path } = await params;
  const page = pageForTwin(`/${path.join("/")}.md`);
  if (!page) return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  const md = await pageMarkdown(page, req.nextUrl.origin);
  if (!md) return new Response("Page unavailable\n", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(md, { headers: MARKDOWN_HEADERS });
}
