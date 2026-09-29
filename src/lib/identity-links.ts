/**
 * Account links: GitHub logins that belong to one person.
 *
 * An admin links an alias login to a primary login (organization mode only);
 * every team metric then counts the two as one person. Links change numbers,
 * never access — nothing here is consulted for authorization.
 *
 * Links are read uncached (one small indexed query per request) and applied
 * after the data caches, in the handlers, so a change shows on the next load
 * on every replica while cached GitHub facts stay link-free.
 */

import { createHash } from "crypto";
import { isStandaloneMode } from "./mode";

export interface IdentityLink {
  alias_login: string;
  primary_login: string;
}

/** Maps a login to the canonical (lowercase) key of the person it belongs to. */
export type Canonical = (login: string) => string;

/** Identity function (lowercased) — the canonical rule when no links exist. */
export const noLinks: Canonical = (login) => login.toLowerCase();

/**
 * Canonical key for a login: its primary when it is an alias, else itself;
 * case-insensitive and one hop (the schema guarantees a primary is never an alias).
 */
export function makeCanonical(links: IdentityLink[]): Canonical {
  if (!links.length) return noLinks;
  const map = new Map(links.map((l) => [l.alias_login.toLowerCase(), l.primary_login.toLowerCase()]));
  return (login) => {
    const l = login.toLowerCase();
    return map.get(l) ?? l;
  };
}

/**
 * Every link, uncached. Empty in standalone mode or without a database, and
 * on a read failure — links only refine numbers, so a DB hiccup must not take
 * the Team page down with it.
 */
export async function getIdentityLinks(): Promise<IdentityLink[]> {
  if (isStandaloneMode() || !process.env.DATABASE_URL) return [];
  try {
    const { listIdentityLinks } = await import("./db");
    return (await listIdentityLinks()).map(({ alias_login, primary_login }) => ({ alias_login, primary_login }));
  } catch (err) {
    console.warn("[identity-links] read failed, numbers shown without links:", (err as Error)?.message ?? err);
    return [];
  }
}

/** Canonical function for the current links (see getIdentityLinks). */
export async function loadCanonical(): Promise<{ canonical: Canonical; links: IdentityLink[] }> {
  const links = await getIdentityLinks();
  return { canonical: makeCanonical(links), links };
}

/** All logins of the person `login` belongs to (primary + aliases), lowercase, the login itself first. */
export function loginsOf(login: string, links: IdentityLink[]): string[] {
  const c = makeCanonical(links)(login);
  const set = new Set<string>([login.toLowerCase(), c]);
  for (const l of links) if (l.primary_login.toLowerCase() === c) set.add(l.alias_login.toLowerCase());
  return [...set];
}

/** GitHub login rule (same as owners): 1–39 chars, alphanumeric or single hyphens; lowercased. */
export function normalizeLogin(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/.test(s) ? s : null;
}

/**
 * Opaque, stable key for a person (canonical login) — lets the page join rows
 * from different APIs whose display logins differ (a linked alias shows in one
 * source, the main login in another) without revealing the canonical login.
 * Server only (node crypto).
 */
export function personKey(canonicalLogin: string): string {
  return createHash("sha256").update(`gitdash-person:${canonicalLogin.toLowerCase()}`).digest("hex").slice(0, 16);
}
