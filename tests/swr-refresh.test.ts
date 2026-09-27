import { describe, it, expect, afterEach, vi } from "vitest";
import { fetcher, requestFresh } from "@/lib/swr";

function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("requestFresh", () => {
  it("a normal fetch uses the plain URL and default caching", async () => {
    const calls = stubFetch();
    await fetcher("/api/github/repos");
    expect(calls[0].url).toBe("/api/github/repos");
    expect(calls[0].init?.cache).toBeUndefined();
  });

  it("a marked URL keeps its URL but reloads with the refresh header", async () => {
    const calls = stubFetch();
    requestFresh("/api/github/repo-overview?owner=a&repo=b");
    await fetcher("/api/github/repo-overview?owner=a&repo=b");
    await fetcher("/api/github/repos"); // unrelated URL is untouched
    expect(calls[0].url).toBe("/api/github/repo-overview?owner=a&repo=b");
    expect(calls[0].init?.cache).toBe("reload");
    expect((calls[0].init?.headers as Record<string, string>)["X-GitDash-Refresh"]).toBe("1");
    expect(calls[1].init?.cache).toBeUndefined();
  });

  it("predicates match several URLs and the mark expires", async () => {
    vi.useFakeTimers();
    const calls = stubFetch();
    requestFresh((u) => u.startsWith("/api/github/repo-summary"));
    await fetcher("/api/github/repo-summary?owner=a&repo=b");
    await fetcher("/api/github/repo-summary?owner=a&repo=c");
    vi.advanceTimersByTime(6_000);
    await fetcher("/api/github/repo-summary?owner=a&repo=d");
    expect(calls.map((c) => c.init?.cache === "reload")).toEqual([true, true, false]);
  });
});
