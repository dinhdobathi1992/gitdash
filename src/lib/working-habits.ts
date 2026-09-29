/**
 * Working habits: commit and PR size discipline per engineer.
 *
 * The one place the counting rules live. The API route, the
 * oversized_commit_pct alert and the Monday digest line all go through
 * computeWorkingHabits() → aggregateWorkingHabits(), so they cannot disagree.
 *
 * Rules:
 *  - A commit is oversized when it changes more than maxCommitFiles files OR
 *    more than maxCommitLines lines (additions + deletions). When GitHub
 *    cannot count the files (very large commits), lines alone decide.
 *  - A PR is oversized when it carries more than maxPrCommits commits.
 *  - Only merged PRs count, windowed by merged_at. Commits are the ones inside
 *    those PRs; merge commits and bot authors are excluded.
 */

import type { WorkingHabitsThresholds } from "./working-habits-settings";
import { isBot } from "./bots";
import { noLinks, personKey, type Canonical } from "./identity-links";

// The bot rule moved to bots.ts (shared by every team metric); re-exported for existing importers.
export { BOT_LOGINS, isBot } from "./bots";

export type OversizeReason = "files" | "lines";

/** The limits a commit breaks; empty when it is within both. */
export function isOversizedCommit(
  c: { files: number | null; additions: number; deletions: number },
  t: WorkingHabitsThresholds,
): OversizeReason[] {
  const reasons: OversizeReason[] = [];
  if (c.files !== null && c.files > t.maxCommitFiles) reasons.push("files");
  if (c.additions + c.deletions > t.maxCommitLines) reasons.push("lines");
  return reasons;
}

// ── Input rows (from getWorkingHabitsRows in db.ts) ──────────────────────────

export interface WhPrRow {
  repo: string;
  pr_number: number;
  author: string | null;
  merged_at: string;
  commit_count: number | null;
  commits_synced_at: string | null;
}

export interface WhCommitRow {
  repo: string;
  sha: string;
  pr_number: number;
  author: string | null;
  author_linked: boolean;
  files: number | null;
  additions: number;
  deletions: number;
  committed_at: string | null;
}

// ── Output ───────────────────────────────────────────────────────────────────

export interface WorkingHabitsPerson {
  /** Display login: the person's most active login in this response. */
  login: string;
  /** Every login merged into this person (account links), when more than one is present. */
  linkedLogins?: string[];
  /** Opaque person key, the same in every Team API (see identity-links.ts). */
  personKey?: string;
  commits: number;
  oversizedCommits: number;
  oversizedCommitPct: number;
  /** Commits credited to this person as the PR author (commit email not linked to GitHub). */
  viaPrAuthor: number;
  prs: number;
  oversizedPrs: number;
}

export interface WorkingHabitsCommit {
  sha: string;
  repo: string;
  prNumber: number;
  author: string;
  /** Display login of the person the commit counts for (differs from `author` for a linked alias). */
  person: string;
  /** Commits in the commit's pull request (null when not yet synced). */
  prCommitCount: number | null;
  authorLinked: boolean;
  files: number | null;
  additions: number;
  deletions: number;
  committedAt: string | null;
  reasons: OversizeReason[];
  url: string;
}

export interface WorkingHabitsPr {
  repo: string;
  number: number;
  author: string;
  /** Display login of the person the PR counts for. */
  person: string;
  commitCount: number;
  mergedAt: string;
  url: string;
}

export interface WorkingHabitsCoverage {
  /** Merged PRs in the window (all authors, bots included — this is sync progress). */
  mergedPrs: number;
  /** Of those, PRs whose commits have been stored. */
  analysedPrs: number;
  complete: boolean;
  /** Latest commit sync among the window's PRs. */
  lastSyncedAt: string | null;
}

export interface WorkingHabitsResponse {
  available: boolean;
  thresholds: WorkingHabitsThresholds;
  window: { from: string; to: string };
  coverage: WorkingHabitsCoverage;
  /** The requested repo is not synced by GitDash (no GitHub Actions history). */
  untrackedRepo?: boolean;
  /** Owner scope: no repository of this owner that the viewer can open is synced. */
  noTrackedRepos?: boolean;
  people: WorkingHabitsPerson[];
  commits: WorkingHabitsCommit[];
  prs: WorkingHabitsPr[];
  totals: { commits: number; oversizedCommits: number; prs: number; oversizedPrs: number };
}

export const MAX_LISTED_COMMITS = 200;
/** The alert stays quiet below this many commits in its window (1 of 1 is not 100%). */
export const ALERT_MIN_COMMITS = 5;

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * Pure aggregation. `logins`, when given, narrows people, commits and PRs to
 * those logins (case-insensitive) — one person's own login, or a person and
 * their linked aliases. `canonical` merges linked logins into one person
 * (account links); without it every login is its own person. Coverage always
 * describes the whole scope.
 */
export function aggregateWorkingHabits(input: {
  prs: WhPrRow[];
  commits: WhCommitRow[];
  thresholds: WorkingHabitsThresholds;
  window: { from: Date; to: Date };
  logins?: string[] | null;
  canonical?: Canonical;
}): Omit<WorkingHabitsResponse, "available" | "untrackedRepo"> {
  const { thresholds: t } = input;
  const canonical = input.canonical ?? noLinks;
  const only = input.logins?.length ? new Set(input.logins.map((l) => l.toLowerCase())) : null;
  const keep = (author: string | null): author is string =>
    author !== null && !isBot(author) && (!only || only.has(author.toLowerCase()));

  const analysed = input.prs.filter((p) => p.commits_synced_at !== null);
  const lastSyncedAt = analysed.reduce<string | null>(
    (max, p) => (max === null || p.commits_synced_at! > max ? p.commits_synced_at : max), null,
  );
  const coverage: WorkingHabitsCoverage = {
    mergedPrs: input.prs.length,
    analysedPrs: analysed.length,
    complete: analysed.length === input.prs.length,
    lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null,
  };

  // Person key = canonical login; activity per raw login picks the display login.
  const people = new Map<string, WorkingHabitsPerson>();
  const activity = new Map<string, Map<string, number>>();
  const person = (login: string): WorkingHabitsPerson => {
    const key = canonical(login);
    let p = people.get(key);
    if (!p) {
      p = { login, commits: 0, oversizedCommits: 0, oversizedCommitPct: 0, viaPrAuthor: 0, prs: 0, oversizedPrs: 0 };
      people.set(key, p);
      activity.set(key, new Map());
    }
    const a = activity.get(key)!;
    const seen = [...a.keys()].find((k) => k.toLowerCase() === login.toLowerCase()) ?? login;
    a.set(seen, (a.get(seen) ?? 0) + 1);
    return p;
  };

  const prCommits = new Map(input.prs.map((p) => [`${p.repo}#${p.pr_number}`, p.commit_count]));
  const oversizedCommits: (WorkingHabitsCommit & { key: string })[] = [];
  let commitTotal = 0;
  for (const c of input.commits) {
    if (!keep(c.author)) continue;
    commitTotal++;
    const p = person(c.author);
    p.commits++;
    if (!c.author_linked) p.viaPrAuthor++;
    const reasons = isOversizedCommit(c, t);
    if (reasons.length) {
      p.oversizedCommits++;
      oversizedCommits.push({
        key: canonical(c.author),
        sha: c.sha, repo: c.repo, prNumber: c.pr_number, author: c.author, person: c.author, authorLinked: c.author_linked,
        prCommitCount: prCommits.get(`${c.repo}#${c.pr_number}`) ?? null,
        files: c.files, additions: c.additions, deletions: c.deletions,
        committedAt: c.committed_at ? new Date(c.committed_at).toISOString() : null,
        reasons, url: `https://github.com/${c.repo}/commit/${c.sha}`,
      });
    }
  }

  const oversizedPrs: (WorkingHabitsPr & { key: string })[] = [];
  let prTotal = 0;
  for (const pr of input.prs) {
    if (!keep(pr.author)) continue;
    prTotal++;
    const p = person(pr.author);
    p.prs++;
    if (pr.commit_count !== null && pr.commit_count > t.maxPrCommits) {
      p.oversizedPrs++;
      oversizedPrs.push({
        key: canonical(pr.author),
        repo: pr.repo, number: pr.pr_number, author: pr.author, person: pr.author, commitCount: pr.commit_count,
        mergedAt: new Date(pr.merged_at).toISOString(), url: `https://github.com/${pr.repo}/pull/${pr.pr_number}`,
      });
    }
  }

  for (const [key, p] of people) {
    const logins = [...activity.get(key)!.entries()];
    // Most active login present here is the display name; ties keep first seen.
    p.login = logins.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
    if (logins.length > 1) p.linkedLogins = logins.map(([l]) => l);
    p.personKey = personKey(key);
    p.oversizedCommitPct = pct(p.oversizedCommits, p.commits);
  }
  const display = (key: string) => people.get(key)!.login;
  const strip = <T extends { key: string; person: string }>({ key, ...rest }: T): Omit<T, "key"> =>
    ({ ...rest, person: display(key) }) as Omit<T, "key">;

  const sortedPeople = [...people.values()].sort(
    (a, b) => b.oversizedCommitPct - a.oversizedCommitPct || b.oversizedCommits - a.oversizedCommits || a.login.localeCompare(b.login),
  );
  oversizedCommits.sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions) || (b.files ?? 0) - (a.files ?? 0));
  oversizedPrs.sort((a, b) => b.commitCount - a.commitCount);

  return {
    thresholds: t,
    window: { from: input.window.from.toISOString(), to: input.window.to.toISOString() },
    coverage,
    people: sortedPeople,
    commits: oversizedCommits.slice(0, MAX_LISTED_COMMITS).map(strip),
    prs: oversizedPrs.map(strip),
    totals: {
      commits: commitTotal,
      oversizedCommits: sortedPeople.reduce((s, p) => s + p.oversizedCommits, 0),
      prs: prTotal,
      oversizedPrs: oversizedPrs.length,
    },
  };
}

// ── Data access (shared by the API route, the alert and the digest) ──────────

/** Rows from the database, thresholds from settings, then the pure aggregation. */
export async function computeWorkingHabits(opts: {
  repos: string[];
  from: Date;
  to: Date;
  /** Narrow to these logins (a person, or a person and their linked aliases); null = everyone. */
  logins?: string[] | null;
  /** Merge linked logins into one person (account links). */
  canonical?: Canonical;
}) {
  const [{ getWorkingHabitsRows }, { getThresholds }] = await Promise.all([
    import("./db"),
    import("./working-habits-settings"),
  ]);
  const [rows, thresholds] = await Promise.all([
    getWorkingHabitsRows(opts.repos, opts.from, opts.to, opts.logins ?? null),
    getThresholds(),
  ]);
  return aggregateWorkingHabits({
    prs: rows.prs, commits: rows.commits, thresholds, window: { from: opts.from, to: opts.to },
    logins: opts.logins, canonical: opts.canonical,
  });
}

// ── Monday digest line ───────────────────────────────────────────────────────

export const DIGEST_WINDOW_DAYS = 7;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Sun 2026-09-27 04:47 UTC" — the date makes a stalled sync visible in the digest. */
const utcStamp = (d: Date) =>
  `${WEEKDAYS[d.getUTCDay()]} ${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;

/**
 * One aggregate line for the leadership digest: totals only, never names —
 * the digest leaves GitDash by email/Slack, outside the workingHabits grant.
 * Covers the 7 days up to the org's latest commit sync. Null with no data.
 */
export async function computeWorkingHabitsDigestLine(org: string): Promise<string | null> {
  const { listSyncedRepos, getLatestCommitSyncAt } = await import("./db");
  const prefix = `${org.toLowerCase()}/`;
  const repos = (await listSyncedRepos()).map((r) => r.repo).filter((r) => r.toLowerCase().startsWith(prefix));
  const to = await getLatestCommitSyncAt(repos);
  if (!to) return null;
  const from = new Date(to.getTime() - DIGEST_WINDOW_DAYS * 86_400_000);
  const r = await computeWorkingHabits({ repos, from, to });
  return formatWorkingHabitsDigestLine(r, to, process.env.NEXT_PUBLIC_APP_URL);
}

export function formatWorkingHabitsDigestLine(
  r: Pick<WorkingHabitsResponse, "totals" | "coverage" | "thresholds">,
  to: Date,
  appUrl?: string,
): string | null {
  if (r.totals.commits === 0 && r.totals.prs === 0) return null;
  const pctOver = pct(r.totals.oversizedCommits, r.totals.commits);
  const prs = r.totals.oversizedPrs === 1 ? "1 pull request" : `${r.totals.oversizedPrs} pull requests`;
  return (
    `Working habits (7 days to ${utcStamp(to)}): ${pctOver}% of ${r.totals.commits} commits were over the size limit; ` +
    `${prs} had more than ${r.thresholds.maxPrCommits} commits; ` +
    `${r.coverage.analysedPrs} of ${r.coverage.mergedPrs} merged pull requests analysed. ` +
    (appUrl ? `Details: ${appUrl.replace(/\/+$/, "")}/team` : "Details in Team insights.")
  );
}
