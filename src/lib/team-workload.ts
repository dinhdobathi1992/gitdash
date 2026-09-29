/**
 * Workload risk for one repo: after-hours and weekend commit share, activity
 * cliffs and open-PR overload, per person.
 *
 * Split in two so account links can be applied after the cache:
 *  - fetchCommitCounters(): one paginated commit fetch + one open-PR call,
 *    grouped by commit author into raw counters (cached, link-free). Hours and
 *    weekdays are read in the org workday's time zone (team-settings.ts), so
 *    the counters depend on the workday and its key is part of the cache key.
 *  - computeWorkload(): sums counters by canonical login before any
 *    percentage or flag, so a linked person is judged on all their commits.
 *
 * Commits whose author email is not linked to a GitHub account are keyed by
 * the git author name (`unlinked_name`); a name is not a login, so those rows
 * are never merged or suggested.
 */

import type { Octokit } from "@octokit/rest";
import { isBot } from "./bots";
import { personKey, type Canonical } from "./identity-links";
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

/** Commit pages (100 each) read per window: the legacy 42-day view, and 30/90-day windows. */
export const PAGE_CAP: Record<number, number> = { 42: 5, 30: 10, 90: 20 };

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

/** Raw per-author counters for the last `windowDays` days (see file header). */
export async function fetchCommitCounters(
  octokit: Octokit,
  owner: string,
  repo: string,
  opts: { windowDays: number; workday: Workday; maxPages?: number; now?: number },
): Promise<WorkloadCounters> {
  const now = opts.now ?? Date.now();
  const windowStart = new Date(now - opts.windowDays * 86_400_000);
  const recentCutoff = now - RECENT_DAYS * 86_400_000;
  const maxPages = opts.maxPages ?? PAGE_CAP[opts.windowDays] ?? 5;
  const authorMap = new Map<string, CommitCounter>();
  let partial = false;

  for (let page = 1; page <= maxPages; page++) {
    const { data } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      since: windowStart.toISOString(),
      per_page: 100,
      page,
    });
    if (data.length === 0) break;

    for (const c of data) {
      const login = c.author?.login ?? c.commit?.author?.name ?? "unknown";
      const avatar = c.author?.avatar_url ?? "";
      const dateStr = c.commit.author?.date ?? c.commit.committer?.date;
      if (!dateStr) continue;
      const d = new Date(dateStr);

      let acc = authorMap.get(login);
      if (!acc) {
        acc = {
          login, avatar_url: avatar, total: 0, afterHours: 0, weekend: 0, recent: 0, prior: 0,
          unlinked_name: !c.author?.login,
          is_bot: isBot(c.author?.login ?? null, (c.author as { type?: string } | null)?.type),
        };
        authorMap.set(login, acc);
      }
      acc.total++;
      if (!acc.avatar_url && avatar) acc.avatar_url = avatar;

      const t = classifyCommitTime(d, opts.workday);
      if (t.afterHours) acc.afterHours++;
      if (t.weekend) acc.weekend++;

      if (d.getTime() >= recentCutoff) acc.recent++;
      else acc.prior++;
    }

    if (data.length < 100) break;
    if (page === maxPages) partial = true;
  }

  // ── Open PRs — one call, grouped by author for the concurrent-load signal ──
  const open_prs: Record<string, number> = {};
  try {
    const { data: openPrs } = await octokit.rest.pulls.list({ owner, repo, state: "open", per_page: 100 });
    for (const pr of openPrs) {
      const login = pr.user?.login;
      if (!login) continue;
      open_prs[login] = (open_prs[login] ?? 0) + 1;
    }
  } catch {
    // Non-fatal — workload risk without concurrent-PR data is still useful.
  }

  const authors = [...authorMap.values()];
  return { authors, open_prs, total_commits: authors.reduce((s, a) => s + a.total, 0), partial, window_days: opts.windowDays };
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

/**
 * Per-person workload from counters, logins merged through `canonical`
 * (never for `unlinked_name` rows). `cliff: false` turns the activity-cliff
 * flag off — used when the commit window was cut short (partial).
 */
export function computeWorkload(counters: WorkloadCounters, canonical: Canonical, opts: { cliff?: boolean } = {}): WorkloadPerson[] {
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
        person_key: personKey(key),
      };
    })
    .sort((a, b) => b.risk_score - a.risk_score || b.total_commits - a.total_commits);
}
