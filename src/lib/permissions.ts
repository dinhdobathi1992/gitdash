/**
 * Organization-mode access control: fixed groups, feature-flag grants per
 * group, a registry classifying every route, and the single decision function
 * shared by the proxy (src/proxy.ts) and in-handler re-checks.
 *
 * Contract:
 *  - identity = numeric GitHub id of the token in use (src/lib/identity.ts)
 *  - groups   = user_groups rows ∪ {admin} for GITDASH_ADMIN_GITHUB_IDS
 *  - flags    = all flags for admins, else the union of group_flags
 *  - admin routes are always enforced; everything else only when
 *    GITDASH_RBAC_ENFORCE=true (off = today's behaviour for grouped/ungrouped users)
 *  - unregistered API routes are denied (deny by default)
 *  - grants/revokes reach new requests within ACCESS_TTL_SECONDS; if the DB or
 *    GitHub is down, the last known answer is reused for LAST_KNOWN_MAX_MS,
 *    after which requests fail with 503 authz_unavailable (never fail open)
 */

import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_FLAGS, type FeatureFlags } from "./feature-flags";
import { withCache, hashKey } from "./cache";
import { isStandaloneMode } from "./mode";
import { getSession, sessionToken } from "./session";
import { assertOrgModeConfig, parseAdminIds, whoami, type WhoAmI } from "./identity";

// ── Vocabulary ───────────────────────────────────────────────────────────────

export const GROUPS = ["devops", "security", "dev", "pm", "admin"] as const;
export type Group = (typeof GROUPS)[number];
/** Groups whose flags an admin can grant (admin implicitly has all). */
export const GRANTABLE_GROUPS = GROUPS.filter((g) => g !== "admin") as Exclude<Group, "admin">[];

export type FlagKey = keyof FeatureFlags;
export const FLAG_KEYS = Object.keys(DEFAULT_FLAGS) as FlagKey[];

export type AccessClass = "public" | "auth" | "base" | "admin" | `flag:${FlagKey}`;

export function isGroup(v: unknown): v is Group {
  return typeof v === "string" && (GROUPS as readonly string[]).includes(v);
}
export function isFlagKey(v: unknown): v is FlagKey {
  return typeof v === "string" && (FLAG_KEYS as string[]).includes(v);
}

export function rbacEnforced(): boolean {
  return process.env.GITDASH_RBAC_ENFORCE === "true";
}

// ── Route registry ───────────────────────────────────────────────────────────

interface Rule {
  /** Path pattern: `*` = exactly one segment, trailing `**` = any remaining segments (incl. none). */
  pattern: string;
  /** Limit to these methods; omitted = all methods. */
  methods?: string[];
  access: AccessClass;
}

const flag = (k: FlagKey): AccessClass => `flag:${k}`;

/** /api/github routes open to every user with a group (no feature flag). */
export const BASE_GITHUB_ROUTES = [
  "repos", "orgs", "org-repos", "org-overview", "repo-overview", "repo-summary", "workflows",
  "runs", "run-details", "deployments", "issues", "audit-log", "contributor-profile",
  "team-stats", "repo-contributors", "security-alerts", "rate-limit",
] as const;

/**
 * Every route, first match wins. A test (tests/permissions.test.ts) fails if
 * any exported handler under src/app/api is not matched here.
 */
export const REGISTRY: Rule[] = [
  // Public: framework, probes, machine-authenticated endpoints, sign-in
  { pattern: "/_next/**", access: "public" },
  { pattern: "/favicon.ico", access: "public" },
  { pattern: "/docs/**", access: "public" },
  // MCP: endpoints, OAuth server, metadata and the MCP GitHub callback. Each
  // authenticates on its own (bearer token, PKCE, transaction cookie).
  { pattern: "/mcp/**", access: "public" },
  { pattern: "/oauth/**", access: "public" },
  { pattern: "/.well-known/**", access: "public" },
  { pattern: "/api/auth/callback/mcp", access: "public" },
  { pattern: "/api/health", access: "public" },
  { pattern: "/api/webhooks/**", access: "public" },
  { pattern: "/api/cron/**", access: "public" },
  { pattern: "/login", access: "public" },
  { pattern: "/setup", access: "public" },
  { pattern: "/api/auth/login", access: "public" },
  { pattern: "/api/auth/callback", access: "public" },
  { pattern: "/api/auth/setup", access: "public" },

  // Signed in, no group needed
  { pattern: "/pending", access: "auth" },
  { pattern: "/api/auth/me", access: "auth" },
  { pattern: "/api/auth/logout", access: "auth" },

  // Admin (always enforced)
  { pattern: "/admin/**", access: "admin" },
  { pattern: "/api/admin/**", access: "admin" },
  { pattern: "/api/settings/**", access: "admin" },
  // Alert events and rules are readable by everyone with access (the handler
  // strips rule destinations — Slack webhooks, emails — for non-admins);
  // creating, editing, deleting and test-sending rules is admin only.
  { pattern: "/api/alerts", methods: ["GET"], access: "base" },
  { pattern: "/api/alerts/**", access: "admin" },
  { pattern: "/api/db/sync", access: "admin" },

  // Feature-flag gated
  { pattern: "/api/github/repo-dora", access: flag("dora") },
  { pattern: "/api/github/open-pr-health", access: flag("prLifecycle") },
  { pattern: "/api/github/job-stats", access: flag("performanceTab") },
  { pattern: "/api/github/bus-factor", access: flag("busFactor") },
  { pattern: "/api/github/security-scan", access: flag("securityScan") },
  { pattern: "/repos/*/*/security", access: flag("securityScan") },
  { pattern: "/api/github/billing/**", access: flag("costAnalytics") },
  { pattern: "/cost-analytics", access: flag("costAnalytics") },
  { pattern: "/api/github/runner-stats", access: flag("runnerUtilization") },
  { pattern: "/api/github/org-health-scorecard", access: flag("healthScorecard") },
  { pattern: "/org/*/health", access: flag("healthScorecard") },
  { pattern: "/api/github/team-workload-risk", access: flag("workloadRisk") },
  { pattern: "/api/ai/insights", access: flag("aiInsights") },
  { pattern: "/api/ai/root-cause", access: flag("aiInsights") },
  { pattern: "/api/ai/anomaly-explanation", access: flag("aiInsights") },
  { pattern: "/api/github/create-issue", access: flag("githubIssueFromAnomaly") },

  // Base: any user with at least one group. Listed one by one (no wildcard) so
  // a new /api/github route is denied until someone classifies it.
  ...BASE_GITHUB_ROUTES.map((r): Rule => ({ pattern: `/api/github/${r}`, access: "base" })),
  { pattern: "/api/db/runs", access: "base" },
  { pattern: "/api/db/trends", access: "base" },
  // Base because engineers may read their own numbers; the handler requires
  // the workingHabits grant for anyone else's.
  { pattern: "/api/db/working-habits", access: "base" },
  { pattern: "/api/ai/status", access: "base" },
  { pattern: "/api/demo", access: "base" },
];

function matches(pattern: string, path: string): boolean {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "**") return true;
    if (i >= s.length) return false;
    if (p[i] !== "*" && p[i] !== s[i]) return false;
  }
  return p.length === s.length;
}

/**
 * Classify a request. Unmatched API routes are "unregistered" (denied); any
 * other unmatched path is a page and counts as "base" — pages only render a
 * shell, their data comes from (classified) API routes.
 */
export function classify(pathname: string, method = "GET"): AccessClass | "unregistered" {
  const m = method.toUpperCase();
  for (const rule of REGISTRY) {
    if (rule.methods && !rule.methods.includes(m)) continue;
    if (matches(rule.pattern, pathname)) return rule.access;
  }
  return pathname === "/api" || pathname.startsWith("/api/") ? "unregistered" : "base";
}

// ── Access resolution ────────────────────────────────────────────────────────

export interface Access {
  githubId: number;
  groups: Group[];
  flags: FlagKey[];
  isAdmin: boolean;
}

export const ACCESS_TTL_SECONDS = 60;
export const LAST_KNOWN_MAX_MS = 10 * 60_000;

/** Raised when identity or permissions cannot be determined and no recent answer exists. */
export class AuthzUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("authorization data unavailable");
    this.name = "AuthzUnavailableError";
    this.cause = cause;
  }
}

const lastKnown = new Map<string, { value: unknown; at: number }>();
const LAST_KNOWN_MAX_ENTRIES = 5_000;

/** Run `load`; on failure, reuse its last success for up to LAST_KNOWN_MAX_MS. */
async function withLastKnown<T>(key: string, load: () => Promise<T>, rethrow?: (err: unknown) => boolean): Promise<T> {
  try {
    const value = await load();
    lastKnown.delete(key); // re-insert to keep Map order = recency
    lastKnown.set(key, { value, at: Date.now() });
    if (lastKnown.size > LAST_KNOWN_MAX_ENTRIES) {
      const oldest = lastKnown.keys().next().value;
      if (oldest !== undefined) lastKnown.delete(oldest);
    }
    return value;
  } catch (err) {
    if (rethrow?.(err)) throw err;
    const prev = lastKnown.get(key);
    if (prev && Date.now() - prev.at <= LAST_KNOWN_MAX_MS) return prev.value as T;
    throw new AuthzUnavailableError(err);
  }
}

async function loadAccess(githubId: number): Promise<Access> {
  const db = await import("./db");
  const dbGroups = (await db.getUserGroups(githubId)).filter(isGroup);
  const groups = new Set<Group>(dbGroups);
  if (parseAdminIds().includes(githubId)) groups.add("admin");
  const isAdmin = groups.has("admin");
  const flags = isAdmin
    ? [...FLAG_KEYS]
    : [...new Set((await db.getGroupFlags([...groups])).filter(isFlagKey))];
  return { githubId, groups: [...groups].sort(), flags: flags.sort(), isAdmin };
}

/** Groups and granted flags for a GitHub user (cached ACCESS_TTL_SECONDS, in-process only). */
export function resolveAccess(githubId: number): Promise<Access> {
  return withLastKnown(`perm:${githubId}`, () =>
    withCache(`perm:${githubId}`, ACCESS_TTL_SECONDS, () => loadAccess(githubId)),
  );
}

/**
 * Identity for a token. A 401 (revoked/expired token) always propagates;
 * other failures fall back to the last known identity.
 */
export function resolveIdentity(token: string): Promise<WhoAmI> {
  return withLastKnown(`who:${hashKey(token)}`, () => whoami(token), (err) => (err as { status?: number }).status === 401);
}

/** Test hook. */
export function __resetAccessForTests(): void {
  lastKnown.clear();
}

// ── Decision ─────────────────────────────────────────────────────────────────

export type Decision =
  | { ok: true }
  | { ok: false; code: "no_groups" | "forbidden" | "unregistered"; flag?: FlagKey };

export function decide(cls: AccessClass | "unregistered", access: Access | null, enforce: boolean): Decision {
  if (cls === "public" || cls === "auth") return { ok: true };
  if (cls === "unregistered") return { ok: false, code: "unregistered" };
  if (cls === "admin") return access?.isAdmin ? { ok: true } : { ok: false, code: "forbidden" };
  if (!enforce) return { ok: true };
  if (!access || access.groups.length === 0) return { ok: false, code: "no_groups" };
  if (cls === "base") return { ok: true };
  const f = cls.slice("flag:".length) as FlagKey;
  return access.flags.includes(f) ? { ok: true } : { ok: false, code: "forbidden", flag: f };
}

// ── In-handler re-check ──────────────────────────────────────────────────────

/**
 * Defense in depth for write and admin handlers: repeat the proxy's decision
 * with the same inputs. Returns a response to send on denial, or null to
 * proceed. No-op in standalone mode.
 */
export async function requireAccess(req: NextRequest | null, cls?: AccessClass): Promise<NextResponse | null> {
  if (isStandaloneMode()) return null;
  assertOrgModeConfig();
  const token = sessionToken(await getSession());
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { identity, allowed } = await resolveIdentity(token);
    if (!allowed) return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    const access = await resolveAccess(identity.id);
    const target = cls ?? (req ? classify(req.nextUrl.pathname, req.method) : "unregistered");
    const d = decide(target, access, rbacEnforced());
    if (d.ok) return null;
    return NextResponse.json({ error: "Forbidden", code: d.code, flag: d.flag }, { status: 403 });
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Service unavailable", code: "authz_unavailable" }, { status: 503 });
  }
}

/**
 * The signed-in GitHub identity for the current request (organization mode),
 * for attributing admin changes in the audit log. Throws when there is no
 * session; callers run it after requireAccess() has already passed.
 */
export async function currentIdentity(): Promise<{ id: number; login: string }> {
  const token = sessionToken(await getSession());
  if (!token) throw new Error("no session");
  const { identity } = await resolveIdentity(token);
  return { id: identity.id, login: identity.login };
}

/** True for admins in organization mode; always true in standalone (single user, no roles). */
export async function isCurrentUserAdmin(): Promise<boolean> {
  if (isStandaloneMode()) return true;
  const { id } = await currentIdentity();
  return (await resolveAccess(id)).isAdmin;
}
