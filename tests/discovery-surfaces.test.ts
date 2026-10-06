import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { looksLikeTwin } from "@/lib/paths";
import { pageForTwin } from "@/lib/markdown-twin";

afterEach(() => vi.unstubAllEnvs());

const orgMode = () => {
  vi.stubEnv("MODE", "organization");
  vi.stubEnv("DATABASE_URL", "postgres://test");
  vi.stubEnv("GITDASH_ADMIN_GITHUB_IDS", "1");
  vi.stubEnv("GITDASH_ALLOWED_ORGS", "acme");
};

describe("robots.txt and sitemap", () => {
  it("product site: allows crawling and points at an absolute sitemap", () => {
    vi.stubEnv("GITDASH_LANDING_PAGE", "true");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.gitdash.info");
    const r = robots();
    expect(r.sitemap).toBe("https://www.gitdash.info/sitemap.xml");
    expect(r.rules).toMatchObject({ userAgent: "*", allow: "/" });
  });

  it("self-hosted: keeps every crawler out and lists nothing", () => {
    vi.stubEnv("GITDASH_LANDING_PAGE", "");
    expect(robots().rules).toEqual({ userAgent: "*", disallow: "/" });
    expect(sitemap()).toEqual([]);
  });

  it("sitemap lists only absolute public HTML pages", () => {
    vi.stubEnv("GITDASH_LANDING_PAGE", "true");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.gitdash.info");
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain("https://www.gitdash.info/welcome");
    expect(urls).toContain("https://www.gitdash.info/docs");
    expect(urls).toContain("https://www.gitdash.info/docs/caching");
    expect(urls).toContain("https://www.gitdash.info/docs/privacy");
    expect(urls.every((u) => u.startsWith("https://www.gitdash.info/") && !u.endsWith(".md"))).toBe(true);
    expect(urls.some((u) => /^https:\/\/[^/]+\/(login|setup|pending|api)(\/|$)/.test(u))).toBe(false);
  });
});

describe("markdown twins", () => {
  it("maps twin URLs to their public page", () => {
    expect(pageForTwin("/docs.md")).toBe("/docs");
    expect(pageForTwin("/docs/caching.md")).toBe("/docs/caching");
    expect(pageForTwin("/welcome.md")).toBe("/welcome");
    expect(pageForTwin("/index.html.md")).toBe("/welcome");
    expect(pageForTwin("/docs/nope.md")).toBeNull();
    expect(pageForTwin("/docs/getting-started.md")).toBeNull(); // served at /docs.md
  });

  it("only docs and landing .md paths go to the twin handler", () => {
    expect(looksLikeTwin("/docs/caching.md")).toBe(true);
    expect(looksLikeTwin("/welcome.md")).toBe(true);
    expect(looksLikeTwin("/team.md")).toBe(false);
    expect(looksLikeTwin("/docs/caching")).toBe(false);
  });
});

describe("proxy — discovery paths are public", () => {
  const status = async (path: string) => {
    const res = await proxy(new NextRequest(`http://localhost${path}`));
    return { location: res.headers.get("location"), rewrite: res.headers.get("x-middleware-rewrite") };
  };

  it("signed-out requests for discovery files are not sent to sign-in", async () => {
    orgMode();
    for (const p of ["/robots.txt", "/sitemap.xml", "/llms.txt", "/llms-full.txt", "/opengraph-image", "/docs/caching"]) {
      expect((await status(p)).location, p).toBeNull();
    }
  });

  it("rewrites markdown twins to the /md handler", async () => {
    orgMode();
    expect((await status("/docs/caching.md")).rewrite).toBe("http://localhost/md/docs/caching");
    expect((await status("/welcome.md")).rewrite).toBe("http://localhost/md/welcome");
  });

  it("the /md handler itself is not public when requested directly", async () => {
    orgMode();
    expect((await status("/md/docs/caching")).location).toContain("/login");
  });
});

describe("markdown twin and llms routes", () => {
  afterEach(() => vi.unstubAllGlobals());

  const page = (body: string) => `<html><head><title>t</title></head><body><nav>menu</nav><main><article data-doc-content>${body}</article></main></body></html>`;

  it("rejects paths without a public page, including the playground and nested paths", () => {
    expect(pageForTwin("/docs/playground.md")).toBeNull();
    expect(pageForTwin("/docs/a/b.md")).toBeNull();
  });

  it("serves a page's main content as noindex markdown", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.gitdash.info");
    const fetchMock = vi.fn(async () => new Response(page("<h1>Auth modes</h1><p>Two modes.</p>"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/md/[...path]/route");
    const res = await GET(new NextRequest("http://localhost/md/docs/modes"), { params: Promise.resolve({ path: ["docs", "modes"] }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const text = await res.text();
    expect(text).toContain("> Source: https://www.gitdash.info/docs/modes");
    expect(text).toContain("# Auth modes\n\nTwo modes.");
    expect(text).not.toContain("menu");
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/docs\/modes$/);
  });

  it("answers 404 for an unknown twin without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/md/[...path]/route");
    const res = await GET(new NextRequest("http://localhost/md/docs/nope"), { params: Promise.resolve({ path: ["docs", "nope"] }) });
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("llms.txt follows llmstxt.org and links every docs page's markdown twin", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.gitdash.info");
    const { GET } = await import("@/app/llms.txt/route");
    const text = await GET().text();
    expect(text.startsWith("# GitDash\n\n> ")).toBe(true);
    expect(text).toContain("](https://www.gitdash.info/docs.md)");
    expect(text).toContain("](https://www.gitdash.info/docs/privacy.md)");
    // Docs sections link markdown twins only; the interactive playground sits under "## Optional".
    const docsPart = text.slice(0, text.indexOf("## Optional"));
    expect(docsPart).not.toMatch(/\]\(https:\/\/www\.gitdash\.info\/docs\/[a-z-]+\)/);
  });
});
