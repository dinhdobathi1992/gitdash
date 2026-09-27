/**
 * Who is behind a GitHub token, and are they allowed into this GitDash
 * deployment? Organization mode only.
 *
 * Identity always comes from GitHub (`GET /user`) for the token actually in
 * use — never from values stored in the session cookie — so a session can
 * never pair one account's token with another account's permissions.
 */

import { getOctokit } from "./github";
import { withCache, hashKey } from "./cache";
import { isStandaloneMode } from "./mode";

export interface GitHubIdentity {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
}

export interface WhoAmI {
  identity: GitHubIdentity;
  /** False when GITDASH_ALLOWED_ORGS is set and the account is in none of them. */
  allowed: boolean;
}

/** Identity + org check is re-validated at most this often per token (in-process only). */
export const WHOAMI_TTL_SECONDS = 60;

// ── Configuration ────────────────────────────────────────────────────────────

/** GITDASH_ALLOWED_ORGS: comma-separated org logins. Empty = no restriction. */
export function allowedOrgs(raw = process.env.GITDASH_ALLOWED_ORGS): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * GITDASH_ADMIN_GITHUB_IDS: comma-separated numeric GitHub user ids that are
 * always admins. Throws on anything that is not a positive integer — a login
 * name here by mistake must fail loudly, not silently leave zero admins.
 */
export function parseAdminIds(raw = process.env.GITDASH_ADMIN_GITHUB_IDS): number[] {
  const parts = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ids = parts.map((p) => {
    if (!/^\d+$/.test(p) || Number(p) <= 0) {
      throw new Error(
        `GITDASH_ADMIN_GITHUB_IDS must contain numeric GitHub user ids (got "${p}"). ` +
          "Find yours with: gh api user --jq .id",
      );
    }
    return Number(p);
  });
  return ids;
}

let configChecked = false;

/**
 * Organization mode needs a database (users, groups, grants) and at least one
 * bootstrap admin. Fail loudly at first use instead of locking everyone out.
 * No-op in standalone mode.
 */
export function assertOrgModeConfig(): void {
  if (configChecked || isStandaloneMode()) return;
  if (!process.env.DATABASE_URL) {
    throw new Error("[GitDash] Organization mode requires DATABASE_URL (users, groups and grants live in Postgres).");
  }
  if (parseAdminIds().length === 0) {
    throw new Error(
      "[GitDash] Organization mode requires GITDASH_ADMIN_GITHUB_IDS (at least one numeric GitHub user id).",
    );
  }
  if (allowedOrgs().length === 0) {
    console.warn("[GitDash] GITDASH_ALLOWED_ORGS is not set — any GitHub account can sign in (it will land on /pending).");
  }
  configChecked = true;
}

// ── GitHub lookups ───────────────────────────────────────────────────────────

/**
 * True if the token's user is an active member of at least one allowed org
 * (or no restriction is configured). Needs `read:org` (classic PAT / OAuth) or
 * "Members: read" (fine-grained PAT); a 403/404 counts as "not a member".
 */
export async function isInAllowedOrgs(token: string): Promise<boolean> {
  const orgs = allowedOrgs();
  if (orgs.length === 0) return true;
  const octokit = getOctokit(token);
  for (const org of orgs) {
    try {
      const { data } = await octokit.rest.orgs.getMembershipForAuthenticatedUser({ org });
      if (data.state === "active") return true;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 403 && status !== 404) throw err;
      // 403 often carries an org policy reason (e.g. "forbids access via a
      // personal access token (classic) if the token's lifetime is greater
      // than 366 days") — log it for the admin; the user gets a generic error.
      if (status === 403) {
        const reason = (err as { message?: string }).message?.split(".")[0] ?? "forbidden";
        console.warn(`[auth] org membership check for "${org}" refused by GitHub: ${reason}`);
      }
    }
  }
  return false;
}

/** Fresh (uncached) identity + org check — used at login. */
export async function lookupWhoAmI(token: string): Promise<WhoAmI> {
  const { data } = await getOctokit(token).rest.users.getAuthenticated();
  const identity: GitHubIdentity = {
    id: data.id,
    login: data.login,
    name: data.name ?? null,
    avatar_url: data.avatar_url,
    email: data.email ?? null,
  };
  return { identity, allowed: await isInAllowedOrgs(token) };
}

/**
 * Identity + org check for the token in use, cached per token in memory for
 * WHOAMI_TTL_SECONDS (never in the shared cache). A revoked token (401) or a
 * removed org membership takes effect within that window.
 */
export function whoami(token: string): Promise<WhoAmI> {
  return withCache(`whoami:${hashKey(token)}`, WHOAMI_TTL_SECONDS, () => lookupWhoAmI(token));
}
