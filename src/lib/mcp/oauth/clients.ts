/**
 * OAuth client resolution for the MCP authorization server.
 *
 * Clients are public (no secret). Two kinds:
 *  - CIMD (always on): the client_id is an https URL whose JSON document lists
 *    the client's name and redirect URIs. The document is fetched with an SSRF
 *    guard: node:https with a custom `lookup` that resolves every A/AAAA record
 *    once, refuses the request if any address is private or reserved, and hands
 *    the connection the exact address it checked (DNS rebinding cannot swap it).
 *    SNI and certificate validation still use the hostname. No redirects, 5 s
 *    total, 8 KB cap. Failures are cached for 60 s, in a cache of their own
 *    so they cannot evict verified documents, and never fall back to trusting
 *    the client. At most 8 fetches run at once process-wide and 2 per
 *    hostname (more fail fast as "busy"), and concurrent lookups of one URL
 *    share a single fetch.
 *  - DCR (only with MCP_ALLOW_DCR=true): stateless registration; the client_id
 *    is a sealed `mcp.client` token carrying the registered metadata.
 *
 * Grant rows store the CIMD URL, or the SHA-256 of a DCR client_id, never the
 * sealed id itself.
 */

import { createHash } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { z } from "zod";
import { sanitizeClientName } from "./grants";
import { open, seal, TOKEN_TTL_SEC } from "./tokens";
import { dcrEnabled, nativeSchemes } from "./config";

// ── IP blocklist ─────────────────────────────────────────────────────────────

type Range4 = [number, number]; // [network, prefix length]

const ip4 = (a: number, b: number, c: number, d: number) => ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

const BLOCKED_V4: Range4[] = [
  [ip4(0, 0, 0, 0), 8], // "this" network
  [ip4(10, 0, 0, 0), 8], // private
  [ip4(100, 64, 0, 0), 10], // carrier-grade NAT
  [ip4(127, 0, 0, 0), 8], // loopback
  [ip4(169, 254, 0, 0), 16], // link-local (cloud metadata)
  [ip4(172, 16, 0, 0), 12], // private
  [ip4(192, 0, 0, 0), 24], // IETF protocol assignments
  [ip4(192, 0, 2, 0), 24], // TEST-NET-1 (documentation)
  [ip4(192, 88, 99, 0), 24], // deprecated 6to4 relay anycast
  [ip4(192, 168, 0, 0), 16], // private
  [ip4(198, 18, 0, 0), 15], // benchmarking
  [ip4(198, 51, 100, 0), 24], // TEST-NET-2 (documentation)
  [ip4(203, 0, 113, 0), 24], // TEST-NET-3 (documentation)
  [ip4(224, 0, 0, 0), 4], // multicast
  [ip4(240, 0, 0, 0), 4], // reserved, broadcast
];

function parseV4(addr: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ip4(parts[0], parts[1], parts[2], parts[3]);
}

function inRange4(ip: number, [net, bits]: Range4): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
}

const blockedV4 = (ip: number) => BLOCKED_V4.some((r) => inRange4(ip, r));

/** Eight 16-bit groups, or null. Accepts "::", an embedded IPv4 tail and a zone id. */
function parseV6(raw: string): number[] | null {
  let addr = raw.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  let tail: number[] = [];
  const lastColon = addr.lastIndexOf(":");
  const last = addr.slice(lastColon + 1);
  if (last.includes(".")) {
    // Embedded IPv4 tail: "::ffff:1.2.3.4" -> groups "::ffff" + two from the IPv4.
    const n = parseV4(last);
    if (n === null || lastColon < 0) return null;
    tail = [n >>> 16, n & 0xffff];
    addr = addr.slice(0, lastColon + 1);
    if (!addr.endsWith("::")) addr = addr.slice(0, -1);
  }
  const want = 8 - tail.length;
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const toGroups = (s: string) => (s === "" ? [] : s.split(":"));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = want - head.length - rest.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill("0"), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== want) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  if (nums.some(Number.isNaN)) return null;
  return [...nums, ...tail];
}

function blockedV6(g: number[]): boolean {
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  const v4At = (i: number) => ((g[i] << 16) | g[i + 1]) >>> 0;
  if (zeros(0, 8)) return true; // ::/128 unspecified
  if (zeros(0, 7) && g[7] === 1) return true; // ::1 loopback
  if (zeros(0, 5) && g[5] === 0xffff) return blockedV4(v4At(6)); // ::ffff:0:0/96 mapped: check as IPv4
  if (zeros(0, 6)) return true; // ::/96 IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return blockedV4(v4At(6)); // NAT64 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // local-use NAT64 64:ff9b:1::/48
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001::/32
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation 2001:db8::/32
  if (g[0] === 0x2002) return blockedV4(v4At(1)); // 6to4 2002::/16 embeds an IPv4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** True for any address an outbound fetch must never reach (or one that cannot be parsed). */
export function isBlockedAddress(addr: string): boolean {
  const family = isIP(addr.replace(/^\[|\]$/g, "").split("%")[0]);
  if (family === 4) {
    const n = parseV4(addr);
    return n === null || blockedV4(n);
  }
  if (family === 6) {
    const g = parseV6(addr);
    return g === null || blockedV6(g);
  }
  return true;
}

// ── Guarded fetch ────────────────────────────────────────────────────────────

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;
type RequestFn = typeof httpsRequest;

const defaultResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) =>
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))),
  );

let deps: { resolver: Resolver; request: RequestFn } = { resolver: defaultResolver, request: httpsRequest };

/** Test hook: swap the resolver and/or the https.request implementation. Pass nothing to restore. */
export function __setClientFetchDepsForTests(next?: Partial<{ resolver: Resolver; request: RequestFn }>): void {
  deps = { resolver: next?.resolver ?? defaultResolver, request: next?.request ?? httpsRequest };
  clearCaches();
}

export class BlockedAddressError extends Error {
  constructor() {
    super("client metadata host resolves to a private or reserved address");
    this.name = "BlockedAddressError";
  }
}

/**
 * A `lookup` for net/tls: resolves all records once, refuses the connection if
 * any address is blocked, and returns exactly one checked address, so the
 * socket dials what was checked.
 */
export function guardedLookup(resolver: Resolver): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname)
      .then((addrs) => {
        if (addrs.length === 0) throw Object.assign(new Error("no addresses"), { code: "ENOTFOUND" });
        if (addrs.some((a) => isBlockedAddress(a.address))) throw new BlockedAddressError();
        const chosen = addrs[0];
        if ((options as { all?: boolean } | undefined)?.all) callback(null, [{ address: chosen.address, family: chosen.family }]);
        else callback(null, chosen.address, chosen.family);
      })
      .catch((err: NodeJS.ErrnoException) => callback(err, "", 0));
  };
}

const MAX_BODY_BYTES = 8 * 1024;
const FETCH_TIMEOUT_MS = 5_000;

interface FetchedDoc {
  body: unknown;
  maxAgeSec: number | null;
}

class FetchError extends Error {}

/** GET an https URL through the guarded lookup. Throws FetchError (message is safe to show). */
function guardedGet(url: URL): Promise<FetchedDoc> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err: Error | null, value?: FetchedDoc) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value!);
    };
    const req = deps.request(
      {
        protocol: "https:",
        hostname: url.hostname,
        servername: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false, // a fresh connection, so every fetch goes through the guarded lookup
        lookup: guardedLookup(deps.resolver),
        headers: { Accept: "application/json", "User-Agent": "GitDash-MCP (client metadata fetch)" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status !== 200) {
          res.resume();
          req.destroy();
          return done(new FetchError(status >= 300 && status < 400 ? "redirects are not allowed" : `HTTP ${status}`));
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > MAX_BODY_BYTES) {
          req.destroy();
          return done(new FetchError("document is larger than 8 KB"));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy();
            return done(new FetchError("document is larger than 8 KB"));
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          let body: unknown;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return done(new FetchError("document is not valid JSON"));
          }
          const cc = String(res.headers["cache-control"] ?? "");
          const m = /(?:^|[,\s])max-age=(\d+)/i.exec(cc);
          done(null, { body, maxAgeSec: m ? Number(m[1]) : null });
        });
        res.on("error", () => done(new FetchError("connection failed")));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(new FetchError("timed out"));
    }, FETCH_TIMEOUT_MS);
    req.on("error", (err) => done(err instanceof BlockedAddressError ? new FetchError(err.message) : new FetchError("connection failed")));
    req.end();
  });
}

// ── Client resolution ────────────────────────────────────────────────────────

export interface ResolvedClient {
  /** The client_id as presented. */
  client_id: string;
  /** What a grant row stores: the CIMD URL, or the SHA-256 of a DCR client_id. */
  grant_client_id: string;
  /** Sanitised, at most 80 characters: what the client calls itself. */
  client_name: string;
  redirect_uris: string[];
  kind: "cimd" | "dcr";
  /** Host of a CIMD client_id, shown on consent; null for DCR. */
  id_host: string | null;
}

export type ClientResult =
  | { ok: true; client: ResolvedClient }
  | { ok: false; error: string; /** Transient: too many metadata fetches in progress. */ busy?: true };

/** The grant-row client id for a presented client_id. */
export function grantClientId(clientId: string): string {
  return /^https:\/\//i.test(clientId) ? clientId : createHash("sha256").update(clientId).digest("hex");
}

const CIMD_DOC = z.object({
  client_id: z.string(),
  client_name: z.string().max(2000).optional(),
  redirect_uris: z.array(z.string().min(1).max(1024)).min(1).max(10),
});
type CimdDoc = z.infer<typeof CIMD_DOC>;

const POSITIVE_MIN_SEC = 300;
const POSITIVE_MAX_SEC = 3600;
const NEGATIVE_SEC = 60;
const CACHE_MAX = 1_000;
const FAIL_CACHE_MAX = 1_000;
/** Process-wide cap on concurrent metadata fetches: client_id is attacker-chosen, so this bounds outbound load. */
const MAX_CONCURRENT_FETCHES = 8;
/** Per-hostname cap, so one slow host cannot take every process-wide slot. */
const MAX_CONCURRENT_FETCHES_PER_HOST = 2;

type DocResult = { ok: true; doc: CimdDoc } | { ok: false; error: string };
type Cached<T> = { result: T; until: number };

/**
 * Two caches by normalised URL, each with its own cap: verified documents,
 * and failures. Unauthenticated callers can create failures at will, so they
 * live apart and can never evict a good document.
 */
const docCache = new Map<string, Cached<Extract<DocResult, { ok: true }>>>();
const failCache = new Map<string, Cached<Extract<DocResult, { ok: false }>>>();
/** Fetches in progress by normalised URL: concurrent lookups of one client share a request. */
const inFlight = new Map<string, Promise<DocResult>>();
let activeFetches = 0;
/** Fetches in progress by hostname. */
const hostFetches = new Map<string, number>();

function putCapped<T>(cache: Map<string, Cached<T>>, max: number, key: string, result: T, ttlSec: number): T {
  cache.delete(key);
  if (cache.size >= max) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { result, until: Date.now() + ttlSec * 1000 });
  return result;
}

function cachePut(key: string, result: DocResult, ttlSec: number): DocResult {
  if (result.ok) {
    failCache.delete(key);
    return putCapped(docCache, CACHE_MAX, key, result, ttlSec);
  }
  return putCapped(failCache, FAIL_CACHE_MAX, key, result, ttlSec);
}

/** A live cached outcome for `key`: a good document first, then a recent failure. */
function cacheGet(key: string): DocResult | null {
  const now = Date.now();
  const good = docCache.get(key);
  if (good && good.until > now) return good.result;
  const bad = failCache.get(key);
  if (bad && bad.until > now) return bad.result;
  return null;
}

function clearCaches(): void {
  docCache.clear();
  failCache.clear();
  inFlight.clear();
}

/**
 * The cache and in-flight key: scheme and host lowercased (the URL parser does
 * this), so case variants of one URL cannot multiply fetches. It never
 * replaces the exact client_id comparison against the document.
 */
function cimdKey(u: URL): string {
  return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
}

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Why a client_id URL is not an acceptable CIMD URL, or null when it is. */
export function cimdUrlProblem(clientId: string): string | null {
  let u: URL;
  try {
    u = new URL(clientId);
  } catch {
    return "client_id is not a URL";
  }
  if (u.protocol !== "https:") return "client_id must be an https URL";
  if (u.port !== "") return "client_id must use port 443";
  if (u.username || u.password || u.hash || clientId.includes("#")) return "client_id must not carry credentials or a fragment";
  if (u.pathname === "/" || u.pathname === "") return "client_id must have a path";
  const host = u.hostname;
  if (host.startsWith("[") || IPV4_LITERAL.test(host) || isIP(host)) return "client_id host must be a name, not an IP address";
  if (!host.includes(".")) return "client_id host must be a public domain name";
  return null;
}

/** Fetch and validate the document at `url`, caching the outcome. Holds one fetch slot while running. */
async function fetchDoc(key: string, url: URL): Promise<DocResult> {
  const host = url.hostname;
  activeFetches++;
  hostFetches.set(host, (hostFetches.get(host) ?? 0) + 1);
  try {
    let fetched: FetchedDoc;
    try {
      fetched = await guardedGet(url);
    } catch (err) {
      const reason = err instanceof FetchError ? err.message : "fetch failed";
      console.warn(`[mcp] client metadata fetch refused for host ${url.hostname}: ${reason}`);
      return cachePut(key, { ok: false, error: `Could not load the app's metadata (${reason}).` }, NEGATIVE_SEC);
    }
    const doc = CIMD_DOC.safeParse(fetched.body);
    if (!doc.success) {
      return cachePut(key, { ok: false, error: "The app's metadata document is invalid." }, NEGATIVE_SEC);
    }
    let named: URL | null = null;
    try {
      named = new URL(doc.data.client_id);
    } catch {
      // handled below
    }
    if (!named || cimdKey(named) !== key) {
      return cachePut(key, { ok: false, error: "The app's metadata names a different client_id." }, NEGATIVE_SEC);
    }
    const ttl = Math.min(POSITIVE_MAX_SEC, Math.max(POSITIVE_MIN_SEC, fetched.maxAgeSec ?? POSITIVE_MIN_SEC));
    return cachePut(key, { ok: true, doc: doc.data }, ttl);
  } finally {
    activeFetches--;
    const left = (hostFetches.get(host) ?? 1) - 1;
    if (left > 0) hostFetches.set(host, left);
    else hostFetches.delete(host);
  }
}

async function resolveCimd(clientId: string): Promise<ClientResult> {
  const problem = cimdUrlProblem(clientId);
  if (problem) return { ok: false, error: problem };

  const url = new URL(clientId);
  const key = cimdKey(url);
  let result: DocResult;
  const hit = cacheGet(key);
  if (hit) {
    result = hit;
  } else {
    let pending = inFlight.get(key);
    if (!pending) {
      if (activeFetches >= MAX_CONCURRENT_FETCHES || (hostFetches.get(url.hostname) ?? 0) >= MAX_CONCURRENT_FETCHES_PER_HOST) {
        console.warn("[mcp] client metadata fetch refused: too many fetches in progress");
        return { ok: false, error: "GitDash is busy verifying other apps. Try again in a moment.", busy: true };
      }
      const started: Promise<DocResult> = fetchDoc(key, url).finally(() => {
        if (inFlight.get(key) === started) inFlight.delete(key);
      });
      inFlight.set(key, started);
      pending = started;
    }
    result = await pending;
  }
  if (!result.ok) return result;
  // Exact match, as presented: a case variant of the URL shares the fetch but not the identity.
  if (result.doc.client_id !== clientId) return { ok: false, error: "The app's metadata names a different client_id." };
  return {
    ok: true,
    client: {
      client_id: clientId,
      grant_client_id: clientId,
      client_name: sanitizeClientName(result.doc.client_name ?? "") || url.hostname,
      redirect_uris: result.doc.redirect_uris,
      kind: "cimd",
      id_host: url.hostname,
    },
  };
}

async function resolveDcr(clientId: string): Promise<ClientResult> {
  if (!dcrEnabled()) return { ok: false, error: "Unknown client." };
  const p = await open("mcp.client", clientId);
  if (!p) return { ok: false, error: "Unknown or expired client registration." };
  return {
    ok: true,
    client: {
      client_id: clientId,
      grant_client_id: grantClientId(clientId),
      client_name: p.client_name,
      redirect_uris: p.redirect_uris,
      kind: "dcr",
      id_host: null,
    },
  };
}

/** Resolve a client_id. Never throws; never trusts a client it could not verify. */
export async function resolveClient(clientId: unknown): Promise<ClientResult> {
  if (typeof clientId !== "string" || clientId.length === 0 || clientId.length > 2048) {
    return { ok: false, error: "client_id is missing or too long." };
  }
  // Anything with a scheme is a CIMD URL (and must pass its rules); anything else is a DCR id.
  if (/^[a-z][a-z0-9+.-]*:/i.test(clientId)) return resolveCimd(clientId);
  return resolveDcr(clientId);
}

/** Test hook. */
export function __clearClientCacheForTests(): void {
  clearCaches();
}

// ── Redirect URIs ────────────────────────────────────────────────────────────

export type RedirectKind = "https" | "loopback" | "native";

export interface ValidRedirect {
  uri: string;
  kind: RedirectKind;
  /** Stored on the grant and shown first on consent. */
  host: string;
  /** CSP form-action source that lets the browser follow the redirect. */
  formAction: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Classify a redirect URI by form, or null when its form is never allowed. */
export function redirectForm(uri: unknown): ValidRedirect | null {
  if (typeof uri !== "string" || uri.length === 0 || uri.length > 1024 || uri.includes("#")) return null;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const scheme = u.protocol.slice(0, -1).toLowerCase();
  if (scheme === "https") {
    if (!u.hostname) return null;
    return { uri, kind: "https", host: u.host, formAction: u.origin };
  }
  if (scheme === "http") {
    if (!LOOPBACK_HOSTS.has(u.hostname)) return null;
    return { uri, kind: "loopback", host: u.host, formAction: u.origin };
  }
  if (nativeSchemes().includes(scheme)) {
    const where = u.host || u.pathname.split("/").filter(Boolean)[0] || "";
    return { uri, kind: "native", host: `${scheme}://${where}`.slice(0, 255), formAction: `${scheme}:` };
  }
  return null;
}

/** The redirect URI if it exactly matches one the client registered and its form is allowed. */
export function matchRedirect(client: ResolvedClient, uri: unknown): ValidRedirect | null {
  if (typeof uri !== "string" || !client.redirect_uris.includes(uri)) return null;
  return redirectForm(uri);
}

// ── Dynamic Client Registration (MCP_ALLOW_DCR=true only) ────────────────────

const DCR_REQUEST = z.object({
  redirect_uris: z.array(z.string().min(1).max(1024)).min(1).max(10),
  client_name: z.string().max(2000).optional(),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

const MAX_CLIENT_ID_LENGTH = 2048;

export type RegisterResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string };

/** Validate RFC 7591 metadata and issue a stateless, sealed client_id (90 days). */
export async function registerClient(input: unknown): Promise<RegisterResult> {
  const parsed = DCR_REQUEST.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_client_metadata", description: "redirect_uris is required (1 to 10 URIs)." };
  const m = parsed.data;
  if (m.token_endpoint_auth_method && m.token_endpoint_auth_method !== "none") {
    return { ok: false, error: "invalid_client_metadata", description: "Only public clients (token_endpoint_auth_method=none) are supported." };
  }
  if (m.grant_types && m.grant_types.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    return { ok: false, error: "invalid_client_metadata", description: "Only authorization_code and refresh_token grants are supported." };
  }
  if (m.response_types && m.response_types.some((r) => r !== "code")) {
    return { ok: false, error: "invalid_client_metadata", description: "Only the code response type is supported." };
  }
  const forms = m.redirect_uris.map(redirectForm);
  if (forms.some((f) => f === null)) {
    return { ok: false, error: "invalid_redirect_uri", description: "Each redirect URI must be https, http://localhost or http://127.0.0.1, or an allowed app scheme, without a fragment." };
  }
  const native = forms.some((f) => f!.kind !== "https");
  const clientName = sanitizeClientName(m.client_name ?? "") || "Unnamed app";
  const ttl = TOKEN_TTL_SEC["mcp.client"];
  const clientId = await seal("mcp.client", { redirect_uris: m.redirect_uris, client_name: clientName, application_type: native ? "native" : "web" }, ttl);
  if (clientId.length > MAX_CLIENT_ID_LENGTH) {
    return { ok: false, error: "invalid_client_metadata", description: "The registration is too large; register fewer or shorter redirect URIs." };
  }
  const now = Math.floor(Date.now() / 1000);
  return {
    ok: true,
    body: {
      client_id: clientId,
      client_id_issued_at: now,
      client_name: clientName,
      redirect_uris: m.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: native ? "native" : "web",
    },
  };
}
