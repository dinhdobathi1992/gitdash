import { NextRequest } from "next/server";
import { ALL_SECTIONS, docHref } from "@/app/docs/_parts/nav";
import { MARKDOWN_HEADERS, pageMarkdown } from "@/lib/markdown-twin";

export const dynamic = "force-dynamic";

/** Every docs page as markdown, in reading order, in one file. */
export async function GET(req: NextRequest) {
  const pages = (await Promise.all(ALL_SECTIONS.map((s) => pageMarkdown(docHref(s.id), req.nextUrl.origin))))
    .filter((p): p is string => p !== null);
  // A page that fails to render is left out (and logged); only a total failure is an error.
  if (!pages.length) {
    return new Response("Documentation unavailable\n", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const body = ["# GitDash documentation", "", ...pages.flatMap((p) => [p, "---", ""])].join("\n");
  return new Response(body, { headers: { ...MARKDOWN_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}
