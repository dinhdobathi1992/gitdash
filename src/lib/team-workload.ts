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
import { personKey, type Canonical } from "./identity-links";
import type { Workday } from "./team-settings";
import {
  accumulateCommits, buildWorkloadCounters, computeWorkloadPeople, countOpenPrsByAuthor,
  type CommitCounter, type WorkloadCounters, type WorkloadPerson,
} from "./team-workload-core";

// Thresholds, types and the per-person math live in team-workload-core.ts
// (pure, shared with the public API playground). Re-exported for existing importers.
export {
  AFTER_HOURS_THRESHOLD, WEEKEND_THRESHOLD, MIN_SAMPLE, CONCURRENT_PR_OVERLOAD, RECENT_DAYS, WORKLOAD_THRESHOLDS,
} from "./team-workload-core";
export type { CommitCounter, WorkloadCounters, WorkloadPerson } from "./team-workload-core";

/** Commit pages (100 each) read per window: the legacy 42-day view, and 30/90-day windows. */
export const PAGE_CAP: Record<number, number> = { 42: 5, 30: 10, 90: 20 };

/** Raw per-author counters for the last `windowDays` days (see file header). */
export async function fetchCommitCounters(
  octokit: Octokit,
  owner: string,
  repo: string,
  opts: { windowDays: number; workday: Workday; maxPages?: number; now?: number },
): Promise<WorkloadCounters> {
  const now = opts.now ?? Date.now();
  const windowStart = new Date(now - opts.windowDays * 86_400_000);
  const maxPages = opts.maxPages ?? PAGE_CAP[opts.windowDays] ?? 5;
  const authors = new Map<string, CommitCounter>();
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
    accumulateCommits(authors, data, { workday: opts.workday, now });
    if (data.length < 100) break;
    if (page === maxPages) partial = true;
  }

  // ── Open PRs — one call, grouped by author for the concurrent-load signal ──
  let open_prs: Record<string, number> = {};
  try {
    const { data: openPrs } = await octokit.rest.pulls.list({ owner, repo, state: "open", per_page: 100 });
    open_prs = countOpenPrsByAuthor(openPrs);
  } catch {
    // Non-fatal — workload risk without concurrent-PR data is still useful.
  }

  return buildWorkloadCounters([...authors.values()], open_prs, { windowDays: opts.windowDays, partial });
}

/**
 * Per-person workload from counters, logins merged through `canonical`
 * (never for `unlinked_name` rows). `cliff: false` turns the activity-cliff
 * flag off — used when the commit window was cut short (partial).
 */
export function computeWorkload(counters: WorkloadCounters, canonical: Canonical, opts: { cliff?: boolean } = {}): WorkloadPerson[] {
  return computeWorkloadPeople(counters, canonical, { ...opts, personKey });
}
