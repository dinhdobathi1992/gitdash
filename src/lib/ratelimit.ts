/**
 * Simple in-process sliding-window rate limiter.
 * No external dependencies — works across single-instance deployments.
 * For multi-instance deployments, swap out the store for Redis.
 */

interface WindowEntry {
  timestamps: number[];
  /** The window this key is limited over; the sweep keeps an entry until its newest hit leaves it. */
  windowMs: number;
}

const store = new Map<string, WindowEntry>();

/**
 * Check whether `key` has exceeded `limit` requests within `windowMs`.
 * Returns { allowed: true } or { allowed: false, retryAfterMs: number }.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [], windowMs };
    store.set(key, entry);
  } else if (windowMs > entry.windowMs) {
    // One key is meant to have one window; if a caller ever widens it, keep the wider one.
    entry.windowMs = windowMs;
  }

  // Evict timestamps older than the window
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= limit) {
    // Oldest timestamp tells us when a slot will free up
    const oldest = entry.timestamps[0];
    return { allowed: false, retryAfterMs: oldest + windowMs - now };
  }

  entry.timestamps.push(now);
  return { allowed: true };
}

/**
 * Token-hash-keyed limiter for authenticated, cost-bearing routes (v4.1.0).
 *
 * getRateLimitKey() below keys on IP, which is the wrong axis for AI routes:
 * the cost follows the *token*, so one user moving between networks should
 * still be limited. Callers pass hashKey(token) from src/lib/cache.ts —
 * never the raw token.
 *
 * Like the underlying limiter this is in-process, so on a multi-instance
 * deployment it bounds per instance rather than globally. It is one of two
 * guards; the other is the daily token budget in src/lib/ai.ts.
 */
export function aiRateLimit(
  tokenHash: string,
  surface: string,
  limit: number,
): { allowed: boolean; retryAfterMs?: number } {
  return rateLimit(`ai:${surface}:${tokenHash}`, limit, 60_000);
}

/** GITDASH_TRUSTED_PROXY_HOPS as a positive integer; anything else means 1. */
function trustedProxyHops(): number {
  const n = Number(process.env.GITDASH_TRUSTED_PROXY_HOPS);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** "1.2.3.4:5678" -> "1.2.3.4"; "[2001:db8::1]:443" -> "2001:db8::1"; bare IPv6 is left as is. */
function stripPort(entry: string): string {
  const v = entry.trim();
  const bracketed = v.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  const v4 = v.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  return v4 ? v4[1] : v;
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseV4(addr: string): number[] | null {
  const m = IPV4_RE.exec(addr);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/** The eight 16-bit groups of an IPv6 address (zone id dropped, IPv4 tail allowed), or null. */
function parseV6(raw: string): number[] | null {
  let addr = raw.split("%")[0].toLowerCase();
  if (!addr.includes(":")) return null;
  let tail: number[] = [];
  const lastColon = addr.lastIndexOf(":");
  const last = addr.slice(lastColon + 1);
  if (last.includes(".")) {
    const v4 = parseV4(last);
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    addr = addr.slice(0, lastColon + 1);
    if (!addr.endsWith("::")) addr = addr.slice(0, -1);
  }
  const want = 8 - tail.length;
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (s: string) => (s === "" ? [] : s.split(":"));
  const head = groupsOf(halves[0]);
  const rest = halves.length === 2 ? groupsOf(halves[1]) : [];
  const fill = want - head.length - rest.length;
  if (halves.length === 2 ? fill < 0 : fill !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return [...groups.map((g) => parseInt(g, 16)), ...tail];
}

/**
 * The rate-limit identity of an address. IPv4 is used as is. An IPv4-mapped
 * IPv6 address (::ffff:1.2.3.4, in either notation) is the IPv4 address. Any
 * other IPv6 address collapses to its /64 prefix ("2001:db8:1:2::/64"): one
 * subscriber usually holds a whole /64, so per-address keys would let a single
 * client rotate through billions of fresh limits. Anything unparsable is
 * returned unchanged.
 */
export function rateLimitIdentity(ip: string): string {
  if (parseV4(ip)) return ip;
  const g = parseV6(ip);
  if (!g) return ip;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff].join(".");
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

/** Private (RFC 1918, fc00::/7), loopback or link-local: an address no Internet client has. */
function isInternalAddress(ip: string): boolean {
  const v4 = parseV4(ip);
  if (v4) {
    const [a, b] = v4;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const g = parseV6(ip);
  if (!g) return false;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return isInternalAddress(rateLimitIdentity(ip));
  }
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80; // fc00::/7, fe80::/10
}

let warnedInternalHop = false;

/**
 * The client IP, from headers a trusted proxy controls. The leftmost
 * X-Forwarded-For entry is whatever the client sent, so it is trusted only on
 * Vercel, which overwrites the header (and sets x-real-ip). Elsewhere each
 * proxy appends the address it saw, so the trustworthy entry is the one
 * GITDASH_TRUSTED_PROXY_HOPS from the right (default 1: the rightmost, the
 * address the nearest proxy saw). Set it to the number of proxies in front of
 * GitDash that append to X-Forwarded-For.
 *
 * When the chosen entry is a private, loopback or link-local address, there is
 * probably another proxy in front (every client would share that one limit):
 * a one-time warning says so. The selection itself never changes, since
 * trusting more entries than there are proxies would let clients spoof theirs.
 */
export function clientIp(headers: Headers): string {
  const realIp = stripPort(headers.get("x-real-ip") ?? "") || null;
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map(stripPort)
    .filter(Boolean);
  if (process.env.VERCEL) return realIp ?? chain[0] ?? "unknown";
  if (chain.length > 0) {
    const chosen = chain[Math.max(0, chain.length - trustedProxyHops())];
    if (!warnedInternalHop && isInternalAddress(chosen)) {
      warnedInternalHop = true;
      console.warn(
        "[ratelimit] The X-Forwarded-For entry used as the client IP is a private, loopback or link-local address, " +
          "so rate limits may be shared by every client. If more than one proxy in front of GitDash appends to " +
          "X-Forwarded-For, set GITDASH_TRUSTED_PROXY_HOPS to their number.",
      );
    }
    return chosen;
  }
  return realIp ?? "unknown";
}

/**
 * Derive a rate-limit key from the request: `<prefix>:<client identity>`,
 * where the identity is clientIp() with IPv6 collapsed to its /64 (see
 * rateLimitIdentity). clientIp() itself stays exact for security logs.
 */
export function getRateLimitKey(req: Request, prefix: string): string {
  return `${prefix}:${rateLimitIdentity(clientIp(req.headers as Headers))}`;
}

/** Drop entries with no hit inside their own window. */
function sweepRateLimits(now = Date.now()): void {
  for (const [key, entry] of store.entries()) {
    if (entry.timestamps.every((t) => t <= now - entry.windowMs)) store.delete(key);
  }
}

// Periodically evict fully-expired entries to prevent memory growth. Runs
// every 10 minutes; each entry is judged against its own window, so an
// hourly limit is not reset by a sweep after 10 minutes.
if (typeof setInterval !== "undefined") {
  setInterval(() => sweepRateLimits(), 10 * 60 * 1000);
}
