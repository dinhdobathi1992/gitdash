/**
 * Client ID Metadata Document resolution: URL rules, the SSRF guard (IP
 * blocklist, pinned lookup, DNS rebinding), fetch limits, caching and
 * redirect-URI forms. No network: https.request and DNS are faked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "c".repeat(24) + "-secret-for-mcp-cimd-tests";
});

import {
  __setClientFetchDepsForTests,
  cimdUrlProblem,
  guardedLookup,
  isBlockedAddress,
  matchRedirect,
  redirectForm,
  resolveClient,
  type Resolver,
} from "@/lib/mcp/oauth/clients";

const CLIENT = "https://client.example.com/oauth/metadata.json";
const PUBLIC_V4: LookupAddress = { address: "93.184.216.34", family: 4 };
const PRIVATE_V4: LookupAddress = { address: "10.0.0.5", family: 4 };

interface Served {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  hang?: boolean;
}

/** A stand-in for https.request: runs the caller's `lookup`, records the dialled address, then serves `serve()`. */
function fakeHttps(serve: () => Served) {
  const dialled: string[] = [];
  const calls: { hostname: string; servername: string; port: number }[] = [];
  const request = (
    options: { hostname: string; servername: string; port: number; lookup: LookupFunction },
    cb: (res: PassThrough & { statusCode: number; headers: Record<string, string> }) => void,
  ) => {
    calls.push({ hostname: options.hostname, servername: options.servername, port: options.port });
    const req = Object.assign(new EventEmitter(), {
      destroy: () => undefined,
      end: () => {
        options.lookup(options.hostname, {}, (err, address) => {
          if (err) return req.emit("error", err);
          dialled.push(String(address));
          const s = serve();
          if (s.hang) return;
          const res = Object.assign(new PassThrough(), { statusCode: s.status ?? 200, headers: s.headers ?? {} });
          cb(res);
          res.end(s.body ?? "");
        });
      },
    });
    return req;
  };
  return { request: request as unknown as typeof import("node:https").request, dialled, calls };
}

const doc = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ client_id: CLIENT, client_name: "Example", redirect_uris: ["https://app.example.com/cb"], ...over });

function useFake(serve: () => Served, resolver: Resolver = async () => [PUBLIC_V4]) {
  const fake = fakeHttps(serve);
  const resolverSpy = vi.fn(resolver);
  __setClientFetchDepsForTests({ resolver: resolverSpy, request: fake.request });
  return { ...fake, resolver: resolverSpy };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  __setClientFetchDepsForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CIMD client_id URL rules", () => {
  it.each([
    ["http://client.example.com/meta.json", /https/],
    ["https://93.184.216.34/meta.json", /IP address/],
    ["https://[2606:4700::1111]/meta.json", /IP address/],
    ["https://client.example.com:8443/meta.json", /port 443/],
    ["https://client.example.com/", /path/],
    ["https://client.example.com", /path/],
    ["https://user:pw@client.example.com/meta.json", /credentials/],
    ["https://client.example.com/meta.json#x", /fragment/],
    ["https://localhost/meta.json", /public domain/],
  ])("refuses %s", async (url, why) => {
    expect(cimdUrlProblem(url)).toMatch(why);
    const fake = useFake(() => ({ body: doc() }));
    expect((await resolveClient(url)).ok).toBe(false);
    expect(fake.dialled).toEqual([]); // refused before any network access
  });

  it("accepts an https URL with a path on port 443 (explicit :443 normalises away)", () => {
    expect(cimdUrlProblem(CLIENT)).toBeNull();
    expect(cimdUrlProblem("https://client.example.com:443/meta.json")).toBeNull();
  });
});

describe("IP blocklist", () => {
  it.each([
    "0.1.2.3", "10.1.2.3", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.0.0.8", "192.168.1.1", "198.18.0.1", "198.19.255.255", "224.0.0.1", "239.1.1.1", "240.0.0.1", "255.255.255.255",
    "::1", "::", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "fc00::1", "fd12:3456::1",
    "fe80::1", "febf::1", "ff02::1", "64:ff9b::a00:1", "2002:a00:1::", "::10.0.0.1", "not-an-ip",
  ])("blocks %s", (addr) => {
    expect(isBlockedAddress(addr)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "100.128.0.1", "172.32.0.1", "198.20.0.1", "2606:4700::1111", "::ffff:93.184.216.34", "2002:5db8:d822::"])(
    "allows public %s",
    (addr) => {
      expect(isBlockedAddress(addr)).toBe(false);
    },
  );
});

describe("guarded lookup", () => {
  it("refuses when any resolved address is private, even if another is public", async () => {
    const lookup = guardedLookup(async () => [PUBLIC_V4, PRIVATE_V4]);
    const err = await new Promise<Error | null>((resolve) => lookup("x.example.com", {}, (e) => resolve(e)));
    expect(err?.name).toBe("BlockedAddressError");
  });

  it("answers with exactly the checked address, in both callback forms", async () => {
    const lookup = guardedLookup(async () => [PUBLIC_V4, { address: "93.184.216.35", family: 4 }]);
    const single = await new Promise<unknown>((resolve) => lookup("x.example.com", {}, (_e, a) => resolve(a)));
    expect(single).toBe(PUBLIC_V4.address);
    const all = await new Promise<unknown>((resolve) => lookup("x.example.com", { all: true }, (_e, a) => resolve(a)));
    expect(all).toEqual([{ address: PUBLIC_V4.address, family: 4 }]);
  });

  it("DNS rebinding: resolves once and dials the address it checked", async () => {
    let n = 0;
    const fake = useFake(
      () => ({ body: doc() }),
      async () => (n++ === 0 ? [PUBLIC_V4] : [{ address: "127.0.0.1", family: 4 }]),
    );
    const r = await resolveClient(CLIENT);
    expect(r.ok).toBe(true);
    expect(fake.resolver).toHaveBeenCalledTimes(1);
    expect(fake.dialled).toEqual([PUBLIC_V4.address]);
    // SNI and certificate validation use the hostname, on port 443.
    expect(fake.calls[0]).toEqual({ hostname: "client.example.com", servername: "client.example.com", port: 443 });
  });

  it("a host resolving to a private address is refused and nothing is dialled", async () => {
    const fake = useFake(() => ({ body: doc() }), async () => [{ address: "::ffff:127.0.0.1", family: 6 }]);
    const r = await resolveClient(CLIENT);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/private or reserved/) });
    expect(fake.dialled).toEqual([]);
  });
});

describe("metadata fetch", () => {
  it("resolves a valid document", async () => {
    useFake(() => ({ body: doc() }));
    const r = await resolveClient(CLIENT);
    expect(r).toMatchObject({ ok: true, client: { client_name: "Example", redirect_uris: ["https://app.example.com/cb"], kind: "cimd", id_host: "client.example.com" } });
  });

  it.each([
    ["3xx responses", { status: 302, headers: { location: "https://elsewhere.example.com/x" } }, /redirects/],
    ["non-200 responses", { status: 500 }, /HTTP 500/],
    ["a declared body over 8 KB", { headers: { "content-length": "9000" }, body: doc() }, /8 KB/],
    ["a streamed body over 8 KB", { body: doc({ pad: "x".repeat(9000) }) }, /8 KB/],
    ["bad JSON", { body: "{not json" }, /not valid JSON/],
  ])("refuses %s", async (_name, served, why) => {
    useFake(() => served);
    const r = await resolveClient(CLIENT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(why);
  });

  it("refuses a document whose client_id differs from its URL", async () => {
    useFake(() => ({ body: doc({ client_id: "https://evil.example.com/meta.json" }) }));
    const r = await resolveClient(CLIENT);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/different client_id/) });
  });

  it("refuses a document without redirect_uris", async () => {
    useFake(() => ({ body: doc({ redirect_uris: [] }) }));
    expect((await resolveClient(CLIENT)).ok).toBe(false);
  });

  it("times out after 5 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    useFake(() => ({ hang: true }));
    const pending = resolveClient(CLIENT);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await pending).toEqual({ ok: false, error: expect.stringMatching(/timed out/) });
  });

  it("caches failures for 60 s and never falls back to trusting the client", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let body = "{bad";
    const fake = useFake(() => ({ body }));
    expect((await resolveClient(CLIENT)).ok).toBe(false);
    body = doc();
    expect((await resolveClient(CLIENT)).ok).toBe(false); // still the cached failure
    expect(fake.dialled).toHaveLength(1);
    vi.setSystemTime(Date.now() + 61_000);
    expect((await resolveClient(CLIENT)).ok).toBe(true);
    expect(fake.dialled).toHaveLength(2);
  });

  it("caches successes for the HTTP lifetime, clamped to 5 min .. 1 h", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fake = useFake(() => ({ body: doc(), headers: { "cache-control": "public, max-age=30" } }));
    await resolveClient(CLIENT);
    vi.setSystemTime(Date.now() + 299_000);
    await resolveClient(CLIENT);
    expect(fake.dialled).toHaveLength(1); // 30 s raised to the 5-minute minimum
    vi.setSystemTime(Date.now() + 2_000);
    await resolveClient(CLIENT);
    expect(fake.dialled).toHaveLength(2);

    const long = useFake(() => ({ body: doc(), headers: { "cache-control": "max-age=86400" } }));
    await resolveClient(CLIENT);
    vi.setSystemTime(Date.now() + 3_601_000);
    await resolveClient(CLIENT);
    expect(long.dialled).toHaveLength(2); // a day capped to an hour
  });

  it("sanitises client_name: control and bidi-override characters stripped, 80 characters max", async () => {
    useFake(() => ({ body: doc({ client_name: "Good‮evil\u0007 " + "x".repeat(200) }) }));
    const r = await resolveClient(CLIENT);
    if (!r.ok) throw new Error(r.error);
    expect(r.client.client_name).not.toMatch(/[‮\u0007]/);
    expect(r.client.client_name.startsWith("Goodevil")).toBe(true);
    expect(Array.from(r.client.client_name)).toHaveLength(80);
  });

  it("falls back to the host when the document has no client_name", async () => {
    useFake(() => ({ body: JSON.stringify({ client_id: CLIENT, redirect_uris: ["https://app.example.com/cb"] }) }));
    const r = await resolveClient(CLIENT);
    expect(r.ok && r.client.client_name).toBe("client.example.com");
  });
});

describe("redirect URI forms", () => {
  it("allows https and loopback http, refuses everything else by default", () => {
    expect(redirectForm("https://app.example.com/cb")).toMatchObject({ kind: "https", host: "app.example.com", formAction: "https://app.example.com" });
    expect(redirectForm("http://localhost:6274/cb")).toMatchObject({ kind: "loopback", formAction: "http://localhost:6274" });
    expect(redirectForm("http://127.0.0.1:33418/")).toMatchObject({ kind: "loopback" });
    for (const bad of [
      "http://app.example.com/cb",
      "http://192.168.1.2/cb",
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
      "https://app.example.com/cb#frag",
      "https://user:pw@app.example.com/cb",
      "cursor://anysphere.cursor-retrieval/oauth",
    ]) {
      expect(redirectForm(bad), bad).toBeNull();
    }
  });

  it("allows a custom scheme only when listed in MCP_NATIVE_SCHEMES", () => {
    vi.stubEnv("MCP_NATIVE_SCHEMES", "cursor, javascript, https");
    expect(redirectForm("cursor://anysphere.cursor-retrieval/oauth/callback")).toMatchObject({
      kind: "native",
      host: "cursor://anysphere.cursor-retrieval",
      formAction: "cursor:",
    });
    expect(redirectForm("javascript:alert(1)")).toBeNull(); // reserved, even when listed
  });

  it("requires an exact match with a registered URI", () => {
    const client = {
      client_id: CLIENT,
      grant_client_id: CLIENT,
      client_name: "Example",
      redirect_uris: ["https://app.example.com/cb"],
      kind: "cimd" as const,
      id_host: "client.example.com",
    };
    expect(matchRedirect(client, "https://app.example.com/cb")).not.toBeNull();
    expect(matchRedirect(client, "https://app.example.com/cb/")).toBeNull();
    expect(matchRedirect(client, "https://app.example.com/cb?x=1")).toBeNull();
  });
});
