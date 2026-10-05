/**
 * Workload risk math — pure, browser-safe. Turns raw GitHub REST commits and
 * open PRs into per-author counters, then into per-person flags.
 *
 * src/lib/team-workload.ts fetches (`GET /repos/{o}/{r}/commits`,
 * `GET /repos/{o}/{r}/pulls?state=open`) and calls these; the public API
 * playground runs the same functions in the browser. The person key is
 * injected because the production one hashes with node crypto (identity-links.ts).
 */

import { isBot } from "./bots";
import { commitAuthor } from "./bus-factor-core";
import type { Canonical } from "./identity-links";
import { classifyCommitTime, type Workday } from "./team-settings";

export const AFTER_HOURS_THRESHOLD = 0.3; // ≥30% of commits outside the workday
export const WEEKEND_THRESHOLD = 0.25; // ≥25% of commits on Sat/Sun
export const MIN_SAMPLE = 5; // minimum commits before flagging after-hours/weekend risk
export const CONCURRENT_PR_OVERLOAD = 4; // open PRs at once
export const RECENT_DAYS = 14;

export const WORKLOAD_THRESHOLDS = {
  after_hours_pct: AFTER_HOURS_THRESHOLD * 100,
  weekend_pct: WEEKEND_THRESHOLD * 100,
  open_prs: CONCURRENT_PR_OVERLOAD,
  min_sample: MIN_SAMPLE,
};

export interface CommitCounter {
  login: string;
  avatar_url: string;
  total: number;
  afterHours: number;
  weekend: number;
  recent: number;
  prior: number;
  /** Keyed by the git author name — the commit is not linked to a GitHub account. */
  unlinked_name: boolean;
  is_bot: boolean;
}

export interface WorkloadCounters {
  authors: CommitCounter[];
  open_prs: Record<string, number>;
  total_commits: number;
  /** The page cap was reached: older commits in the window were not read. */
  partial: boolean;
  window_days: number;
}

export interface WorkloadPerson {
  login: string;
  avatar_url: string;
  total_commits: number;
  after_hours_pct: number;
  weekend_pct: number;
  open_pr_count: number;
  prior_period_commits: number;
  recent_period_commits: number;
  flags: { after_hours: boolean; weekend: boolean; concurrent_pr_overload: boolean; activity_cliff: boolean };
  risk_score: number;
  is_bot: boolean;
  unlinked_name: boolean;
  /** Logins merged into this row by account links, when more than one is present. */
  linked_logins?: string[];
  /** Opaque person key, the same in every Team API (see identity-links.ts). */
  person_key: string;
}

/** The fields of a `GET /repos/{o}/{r}/commits` item the workload counters read. */
export interface RawCommitForWorkload {
  // GitHub returns `{}` (not null) for some unlinked authors, hence the optionals.
  author?: { login?: string; avatar_url?: string; type?: string } | null;
  commit: {
    author?: { name?: string; date?: string } | null;
    committer?: { date?: string } | null;
  };
}

/**
 * Folds listed commits (one page at a time, any order) into per-author
 * counters keyed by author: totals, after-hours and weekend counts in
 * `workday`'s zone, and recent (last RECENT_DAYS before `now`) vs prior.
 * Commits without a date are skipped.
 */
export function accumulateCommits(
  acc: Map<string, CommitCounter>,
  commits: RawCommitForWorkload[],
  opts: { workday: Workday; now: number },
): void {
  const recentCutoff = opts.now - RECENT_DAYS * 86_400_000;
  for (const c of commits) {
    const login = commitAuthor(c);
    const avatar = c.author?.avatar_url ?? "";
    const dateStr = c.commit.author?.date ?? c.commit.committer?.date;
    if (!dateStr) continue;
    const d = new Date(dateStr);

    let row = acc.get(login);
    if (!row) {
      row = {
        login, avatar_url: avatar, total: 0, afterHours: 0, weekend: 0, recent: 0, prior: 0,
        unlinked_name: !c.author?.login,
        is_bot: isBot(c.author?.login ?? null, c.author?.type),
      };
      acc.set(login, row);
    }
    row.total++;
    if (!row.avatar_url && avatar) row.avatar_url = avatar;

    const t = classifyCommitTime(d, opts.workday);
    if (t.afterHours) row.afterHours++;
    if (t.weekend) row.weekend++;

    if (d.getTime() >= recentCutoff) row.recent++;
    else row.prior++;
  }
}

/** Per-author counters for one list of commits (see accumulateCommits). */
export function countCommitsByAuthor(
  commits: RawCommitForWorkload[],
  opts: { workday: Workday; now: number },
): CommitCounter[] {
  const acc = new Map<string, CommitCounter>();
  accumulateCommits(acc, commits, opts);
  return [...acc.values()];
}

/** Open PRs per author login from `GET /pulls?state=open`; PRs without a user are skipped. */
export function countOpenPrsByAuthor(prs: { user?: { login: string } | null }[]): Record<string, number> {
  const open_prs: Record<string, number> = {};
  for (const pr of prs) {
    const login = pr.user?.login;
    if (!login) continue;
    open_prs[login] = (open_prs[login] ?? 0) + 1;
  }
  return open_prs;
}

/** The counters object for one commit window and the open-PR page. */
export function buildWorkloadCounters(
  authors: CommitCounter[],
  openPrs: Record<string, number>,
  opts: { windowDays: number; partial: boolean },
): WorkloadCounters {
  return {
    authors,
    open_prs: openPrs,
    total_commits: authors.reduce((s, a) => s + a.total, 0),
    partial: opts.partial,
    window_days: opts.windowDays,
  };
}

/**
 * Per-person workload from counters, logins merged through `canonical`
 * (never for `unlinked_name` rows). `cliff: false` turns the activity-cliff
 * flag off — used when the commit window was cut short (partial).
 * `personKey` maps the grouping key to the opaque person key.
 */
export function computeWorkloadPeople(
  counters: WorkloadCounters,
  canonical: Canonical,
  opts: { cliff?: boolean; personKey: (groupKey: string) => string },
): WorkloadPerson[] {
  const cliff = opts.cliff ?? true;
  const groups = new Map<string, CommitCounter[]>();
  for (const a of counters.authors) {
    if (a.total < 1) continue;
    const key = a.unlinked_name ? `name:${a.login}` : a.is_bot ? `bot:${a.login.toLowerCase()}` : canonical(a.login);
    const g = groups.get(key);
    if (g) g.push(a);
    else groups.set(key, [a]);
  }

  return [...groups.entries()]
    .map(([key, rows]): WorkloadPerson => {
      const lead = rows.reduce((best, r) => (r.total > best.total ? r : best));
      const sum = (f: (r: CommitCounter) => number) => rows.reduce((s, r) => s + f(r), 0);
      const total = sum((r) => r.total);
      const afterHours = sum((r) => r.afterHours);
      const weekend = sum((r) => r.weekend);
      const recent = sum((r) => r.recent);
      const prior = sum((r) => r.prior);
      const afterHoursPct = total > 0 ? Math.round((afterHours / total) * 100) : 0;
      const weekendPct = total > 0 ? Math.round((weekend / total) * 100) : 0;
      const openPrCount = sum((r) => counters.open_prs[r.login] ?? 0);

      const flags = {
        after_hours: total >= MIN_SAMPLE && afterHoursPct / 100 >= AFTER_HOURS_THRESHOLD,
        weekend: total >= MIN_SAMPLE && weekendPct / 100 >= WEEKEND_THRESHOLD,
        concurrent_pr_overload: openPrCount >= CONCURRENT_PR_OVERLOAD,
        // Meaningfully active in the baseline window, silent in the recent one.
        activity_cliff: cliff && prior >= 3 && recent === 0,
      };
      return {
        login: lead.login,
        avatar_url: lead.avatar_url || (rows.find((r) => r.avatar_url)?.avatar_url ?? ""),
        total_commits: total,
        after_hours_pct: afterHoursPct,
        weekend_pct: weekendPct,
        open_pr_count: openPrCount,
        prior_period_commits: prior,
        recent_period_commits: recent,
        flags,
        risk_score: Object.values(flags).filter(Boolean).length,
        is_bot: lead.is_bot,
        unlinked_name: lead.unlinked_name,
        ...(rows.length > 1 ? { linked_logins: rows.map((r) => r.login) } : {}),
        person_key: opts.personKey(key),
      };
    })
    .sort((a, b) => b.risk_score - a.risk_score || b.total_commits - a.total_commits);
}
