/**
 * Contributor profile: one person's pull requests, reviews and commits in an
 * owner's repositories over the last 90 days.
 *
 * Built from three searches that run in parallel instead of walking up to 30
 * repositories one by one (≈360 REST calls, ~25 s cold from Asia):
 *   - GraphQL search: PRs the person authored, with sizes and the reviews each got
 *   - GraphQL search: PRs the person reviewed, with only their own reviews
 *   - REST commit search: their commits (paged, capped)
 * Search covers every repository the token can see, private ones included,
 * and indexes default branches only — the same scope as the old per-repo
 * listCommits call.
 */

import type { getOctokit } from "@/lib/github";
import { withCache } from "@/lib/cache";

type Octokit = ReturnType<typeof getOctokit>;

// ── Response types (re-exported by the route for its consumers) ──────────────

export interface ContributorPrSummary {
  number: number;
  title: string;
  state: string;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  additions: number;
  deletions: number;
  /** Hours from created to merged */
  hours_to_merge: number | null;
  repo_full_name: string;
}

export interface ContributorReviewSummary {
  pr_number: number;
  pr_title: string;
  state: string;
  submitted_at: string;
  /** Hours from PR created to review submitted */
  turnaround_hours: number | null;
  repo_full_name: string;
}

export interface ContributorProfileResponse {
  login: string;
  avatar_url: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  html_url: string;

  // PR metrics (last 90 days)
  prs_opened: number;
  prs_merged: number;
  prs_closed_without_merge: number;
  pr_merge_rate: number; // 0-100
  avg_hours_to_merge: number;
  avg_pr_size: number; // additions + deletions
  recent_prs: ContributorPrSummary[];

  // Review metrics
  reviews_given: number;
  avg_review_turnaround_hours: number;
  recent_reviews: ContributorReviewSummary[];

  // Commit metrics
  total_commits_90d: number;
  /** 52-week contribution calendar: array of { date, count } */
  activity_calendar: { date: string; count: number }[];
  /** Weekly commit counts for last 12 weeks */
  weekly_commits: { week_start: string; count: number }[];
  /** Hour-of-day distribution (0-23, UTC) */
  commit_hour_distribution: number[];
  /** Active days per week (last 4 weeks) */
  active_days_per_week: number[];
  /** Percentage of commits made outside 9-18 UTC */
  after_hours_pct: number;

  /** The person's own PRs: opened → got a review → got an approval → merged. */
  funnel: {
    opened: number;
    reviewed: number;
    approved: number;
    merged: number;
  };

  // Languages touched (from repos contributed to)
  languages: { name: string; count: number }[];

  // Repos contributed to
  repos_contributed: string[];

  /**
   * Recent half vs. prior half of the 90-day window — powers the 1:1 Prep
   * Sheet's "this period vs last period" comparison.
   */
  period_comparison: {
    window_days: number; // each half's length
    prs_opened_recent: number;
    prs_opened_prior: number;
    prs_merged_recent: number;
    prs_merged_prior: number;
    reviews_given_recent: number;
    reviews_given_prior: number;
    avg_hours_to_merge_recent: number;
    avg_hours_to_merge_prior: number;
  };

  /** True if any search failed or GitHub reported incomplete results */
  partial: boolean;
  fetched_requests: number;
  total_requests_attempted: number;
}

// ── Raw inputs (what the searches return, normalised) ────────────────────────

export interface AuthoredPr {
  number: number;
  title: string;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  additions: number;
  deletions: number;
  repo: string;
  language: string | null;
  /** Reviews from other people: [reviewer login, state] */
  reviews: { author: string | null; state: string }[];
}

export interface GivenReview {
  pr_number: number;
  pr_title: string;
  pr_created_at: string;
  repo: string;
  state: string;
  submitted_at: string;
}

export interface CommitPoint {
  date: string; // ISO author date
  repo: string;
  language: string | null;
}

export interface ProfileInput {
  user: { login: string; avatar_url: string; name: string | null; bio: string | null; company: string | null; location: string | null; html_url: string };
  prs: AuthoredPr[];
  reviews: GivenReview[];
  commits: CommitPoint[];
  /** Exact commit count from the search (the fetched list may be capped). */
  totalCommits: number;
  partial: boolean;
  requests: { attempted: number; fetched: number };
}

// ── Pure aggregation ─────────────────────────────────────────────────────────

const DAY = 86_400_000;

function weekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (v: number[]) => (v.length ? round1(v.reduce((s, x) => s + x, 0) / v.length) : 0);

export function aggregateContributorProfile(input: ProfileInput, now: Date): ContributorProfileResponse {
  const since = now.getTime() - 90 * DAY;
  const login = input.user.login.toLowerCase();

  const prs: ContributorPrSummary[] = input.prs
    .filter((p) => new Date(p.created_at).getTime() >= since)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((p) => ({
      number: p.number,
      title: p.title,
      state: p.merged_at ? "merged" : p.closed_at ? "closed" : "open",
      created_at: p.created_at,
      merged_at: p.merged_at,
      closed_at: p.closed_at,
      additions: p.additions,
      deletions: p.deletions,
      hours_to_merge: p.merged_at ? round1((new Date(p.merged_at).getTime() - new Date(p.created_at).getTime()) / 3_600_000) : null,
      repo_full_name: p.repo,
    }));

  const reviews: ContributorReviewSummary[] = input.reviews
    .filter((r) => new Date(r.submitted_at).getTime() >= since)
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
    .map((r) => ({
      pr_number: r.pr_number,
      pr_title: r.pr_title,
      state: r.state,
      submitted_at: r.submitted_at,
      turnaround_hours: round1((new Date(r.submitted_at).getTime() - new Date(r.pr_created_at).getTime()) / 3_600_000),
      repo_full_name: r.repo,
    }));

  const merged = prs.filter((p) => p.state === "merged");
  const closedUnmerged = prs.filter((p) => p.state === "closed");
  const mergeHours = (list: ContributorPrSummary[]) => list.map((p) => p.hours_to_merge).filter((h): h is number => h !== null);

  // Commits: calendar, weeks, hours, active days, after-hours share.
  const commitCounts: Record<string, number> = {};
  const hours = Array<number>(24).fill(0);
  const activeDays: Set<string>[] = [new Set(), new Set(), new Set(), new Set()];
  const langCount: Record<string, number> = {};
  const repos = new Set<string>();
  for (const c of input.commits) {
    const d = new Date(c.date);
    if (Number.isNaN(d.getTime())) continue;
    const day = c.date.slice(0, 10);
    commitCounts[day] = (commitCounts[day] ?? 0) + 1;
    hours[d.getUTCHours()]++;
    const weeksAgo = Math.floor((now.getTime() - d.getTime()) / (7 * DAY));
    if (weeksAgo >= 0 && weeksAgo < 4) activeDays[weeksAgo].add(day);
    repos.add(c.repo);
    if (c.language) langCount[c.language] = (langCount[c.language] ?? 0) + 1;
  }
  for (const p of prs) repos.add(p.repo_full_name);
  // Languages from commits; fall back to authored PRs' repositories when there are no commits.
  if (Object.keys(langCount).length === 0) {
    for (const p of input.prs) if (p.language) langCount[p.language] = (langCount[p.language] ?? 0) + 1;
  }

  const calendar: { date: string; count: number }[] = [];
  const calStart = new Date(now);
  calStart.setUTCDate(calStart.getUTCDate() - 364);
  for (let d = new Date(calStart); d <= now; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    calendar.push({ date: key, count: commitCounts[key] ?? 0 });
  }

  const weekMap: Record<string, number> = {};
  for (let i = 11; i >= 0; i--) weekMap[weekStart(new Date(now.getTime() - i * 7 * DAY))] = 0;
  for (const [day, n] of Object.entries(commitCounts)) {
    const w = weekStart(new Date(day));
    if (w in weekMap) weekMap[w] += n;
  }

  const hourTotal = hours.reduce((s, n) => s + n, 0);
  const afterHours = hours.reduce((s, n, h) => (h < 9 || h >= 18 ? s + n : s), 0);

  // Funnel over the person's own PRs, from reviews other people left on them.
  const inWindow = input.prs.filter((p) => new Date(p.created_at).getTime() >= since);
  const others = (p: AuthoredPr) => p.reviews.filter((r) => r.author && r.author.toLowerCase() !== login);

  const half = now.getTime() - 45 * DAY;
  const recentPrs = prs.filter((p) => new Date(p.created_at).getTime() >= half);
  const priorPrs = prs.filter((p) => new Date(p.created_at).getTime() < half);

  return {
    ...input.user,
    prs_opened: prs.length,
    prs_merged: merged.length,
    prs_closed_without_merge: closedUnmerged.length,
    pr_merge_rate: prs.length ? Math.round((merged.length / prs.length) * 100) : 0,
    avg_hours_to_merge: avg(mergeHours(merged)),
    avg_pr_size: merged.length ? Math.round(merged.reduce((s, p) => s + p.additions + p.deletions, 0) / merged.length) : 0,
    recent_prs: prs.slice(0, 20),

    reviews_given: reviews.length,
    avg_review_turnaround_hours: avg(reviews.map((r) => r.turnaround_hours).filter((h): h is number => h !== null && h >= 0)),
    recent_reviews: reviews.slice(0, 20),

    total_commits_90d: Math.max(input.totalCommits, input.commits.length),
    activity_calendar: calendar,
    weekly_commits: Object.entries(weekMap).sort(([a], [b]) => a.localeCompare(b)).map(([week_start, count]) => ({ week_start, count })),
    commit_hour_distribution: hours,
    active_days_per_week: activeDays.map((s) => s.size),
    after_hours_pct: hourTotal ? Math.round((afterHours / hourTotal) * 100) : 0,

    funnel: {
      opened: prs.length,
      reviewed: inWindow.filter((p) => others(p).length > 0).length,
      approved: inWindow.filter((p) => others(p).some((r) => r.state === "APPROVED")).length,
      merged: merged.length,
    },

    languages: Object.entries(langCount).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    repos_contributed: [...repos],
    period_comparison: {
      window_days: 45,
      prs_opened_recent: recentPrs.length,
      prs_opened_prior: priorPrs.length,
      prs_merged_recent: recentPrs.filter((p) => p.state === "merged").length,
      prs_merged_prior: priorPrs.filter((p) => p.state === "merged").length,
      reviews_given_recent: reviews.filter((r) => new Date(r.submitted_at).getTime() >= half).length,
      reviews_given_prior: reviews.filter((r) => new Date(r.submitted_at).getTime() < half).length,
      avg_hours_to_merge_recent: avg(mergeHours(recentPrs.filter((p) => p.state === "merged"))),
      avg_hours_to_merge_prior: avg(mergeHours(priorPrs.filter((p) => p.state === "merged"))),
    },

    partial: input.partial,
    fetched_requests: input.requests.fetched,
    total_requests_attempted: input.requests.attempted,
  };
}

// ── Step timing (Server-Timing header) ───────────────────────────────────────

/** One measured step of a profile build: `name;dur=ms;desc="…"` in Server-Timing. */
export interface StepTiming {
  name: string;
  ms: number;
  desc?: string;
}

/** Time an async step and record it; the step's result or error passes through unchanged. */
async function timed<T>(steps: StepTiming[] | undefined, name: string, fn: () => Promise<T>, desc?: (v: T) => string): Promise<T> {
  const t = performance.now();
  try {
    const v = await fn();
    steps?.push({ name, ms: performance.now() - t, desc: desc?.(v) });
    return v;
  } catch (e) {
    steps?.push({ name, ms: performance.now() - t, desc: "failed" });
    throw e;
  }
}

/** Render steps as a Server-Timing header value (names are fixed identifiers; desc is quoted). */
export function serverTiming(steps: StepTiming[]): string {
  return steps
    .map((s) => `${s.name};dur=${s.ms.toFixed(1)}${s.desc ? `;desc="${s.desc.replace(/["\\]/g, "")}"` : ""}`)
    .join(", ");
}

// ── Fetching ─────────────────────────────────────────────────────────────────

/** GraphQL search pages to read (100 PRs each). */
const PR_PAGES = 3;
/** REST commit-search pages to read (100 commits each); the total is exact regardless. */
const COMMIT_PAGES = 5;

const AUTHORED_QUERY = `
query ($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title createdAt mergedAt closedAt additions deletions
        repository { nameWithOwner primaryLanguage { name } }
        reviews(first: 30) { nodes { author { login } state } }
      }
    }
  }
}`;

const REVIEWED_QUERY = `
query ($q: String!, $login: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title createdAt
        repository { nameWithOwner }
        reviews(author: $login, first: 20) { nodes { state submittedAt } }
      }
    }
  }
}`;

interface SearchPage<N> { search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (N | Record<string, never>)[] } }
interface AuthoredNode {
  number: number; title: string; createdAt: string; mergedAt: string | null; closedAt: string | null;
  additions: number; deletions: number;
  repository: { nameWithOwner: string; primaryLanguage: { name: string } | null };
  reviews: { nodes: { author: { login: string } | null; state: string }[] };
}
interface ReviewedNode {
  number: number; title: string; createdAt: string;
  repository: { nameWithOwner: string };
  reviews: { nodes: { state: string; submittedAt: string | null }[] };
}

/** Reads up to `pages` pages of a GraphQL search; returns the PR nodes and whether it stopped short on an error. */
async function searchPrs<N extends { number: number }>(
  octokit: Octokit, query: string, vars: Record<string, string>, pages: number, counter: { attempted: number; fetched: number },
): Promise<{ nodes: N[]; failed: boolean; pages: number }> {
  const nodes: N[] = [];
  let read = 0;
  let cursor: string | null = null;
  for (let i = 0; i < pages; i++) {
    counter.attempted++;
    let page: SearchPage<N>;
    try {
      page = await octokit.graphql<SearchPage<N>>(query, { ...vars, cursor });
    } catch {
      return { nodes, failed: true, pages: read };
    }
    counter.fetched++;
    read++;
    for (const n of page.search.nodes) if ("number" in n) nodes.push(n as N);
    if (!page.search.pageInfo.hasNextPage) break;
    cursor = page.search.pageInfo.endCursor;
  }
  return { nodes, failed: false, pages: read };
}

/** Commit search: first page for the total, then the remaining pages in parallel. */
async function searchCommits(
  octokit: Octokit, q: string, counter: { attempted: number; fetched: number },
): Promise<{ commits: CommitPoint[]; total: number; failed: boolean; incomplete: boolean }> {
  type Item = { commit: { author: { date?: string } | null; committer: { date?: string } | null }; repository: { full_name: string; language?: string | null } };
  const toPoint = (it: Item): CommitPoint => ({
    date: it.commit.author?.date ?? it.commit.committer?.date ?? "",
    repo: it.repository.full_name,
    language: it.repository.language ?? null,
  });
  const page = (n: number) => octokit.rest.search.commits({ q, sort: "author-date", order: "desc", per_page: 100, page: n });

  counter.attempted++;
  let first;
  try {
    first = await page(1);
  } catch {
    return { commits: [], total: 0, failed: true, incomplete: false };
  }
  counter.fetched++;
  const total = first.data.total_count;
  const commits = (first.data.items as unknown as Item[]).map(toPoint);
  const more = Math.min(COMMIT_PAGES, Math.ceil(total / 100)) - 1;
  let failed = false;
  if (more > 0) {
    counter.attempted += more;
    const rest = await Promise.allSettled(Array.from({ length: more }, (_, i) => page(i + 2)));
    for (const r of rest) {
      if (r.status === "fulfilled") {
        counter.fetched++;
        commits.push(...(r.value.data.items as unknown as Item[]).map(toPoint));
      } else failed = true;
    }
  }
  return { commits, total, failed, incomplete: first.data.incomplete_results };
}

/** How long an owner's account type is remembered; it practically never changes. */
export const OWNER_TYPE_TTL = 86_400;

/**
 * `org:acme` for organizations, `user:alice` for personal accounts. Cached in
 * memory for a day and across users: the account type is public and identical
 * for every token, so the key and value hold no per-user data. In-memory only —
 * the shared Postgres layer is opted into from route files, never from libs.
 */
async function ownerQualifier(octokit: Octokit, owner: string): Promise<string> {
  return withCache(`github/owner-qualifier:${owner.toLowerCase()}`, OWNER_TYPE_TTL, async () => {
    const { data } = await octokit.rest.users.getByUsername({ username: owner });
    return data.type === "Organization" ? `org:${owner}` : `user:${owner}`;
  });
}

export async function buildContributorProfile(
  octokit: Octokit, owner: string, login: string, now = new Date(), steps?: StepTiming[],
): Promise<ContributorProfileResponse> {
  const sinceDate = new Date(now.getTime() - 90 * DAY).toISOString().slice(0, 10);
  const counter = { attempted: 2, fetched: 2 }; // user + owner lookups

  // The person's profile is only needed at the end, so it runs alongside the
  // searches; only the owner qualifier (usually cached) gates them.
  const userPromise = timed(steps, "user", () => octokit.rest.users.getByUsername({ username: login }));
  userPromise.catch(() => {}); // awaited below; avoid an unhandled rejection while the searches run
  const scope = await timed(steps, "owner", () => ownerQualifier(octokit, owner));

  const [userRes, authored, reviewed, commits] = await Promise.all([
    userPromise,
    timed(steps, "prs", () => searchPrs<AuthoredNode>(octokit, AUTHORED_QUERY, { q: `type:pr author:${login} ${scope} created:>=${sinceDate} sort:created-desc` }, PR_PAGES, counter), (r) => `${r.pages} pages, ${r.nodes.length} PRs`),
    timed(steps, "reviews", () => searchPrs<ReviewedNode>(octokit, REVIEWED_QUERY, { q: `type:pr reviewed-by:${login} -author:${login} ${scope} updated:>=${sinceDate} sort:updated-desc`, login }, PR_PAGES, counter), (r) => `${r.pages} pages, ${r.nodes.length} PRs`),
    timed(steps, "commits", () => searchCommits(octokit, `author:${login} ${scope} author-date:>=${sinceDate}`, counter), (r) => `${r.commits.length} of ${r.total}`),
  ]);

  const u = userRes.data;
  return aggregateContributorProfile({
    user: { login: u.login, avatar_url: u.avatar_url, name: u.name ?? null, bio: u.bio ?? null, company: u.company ?? null, location: u.location ?? null, html_url: u.html_url },
    prs: authored.nodes.map((n) => ({
      number: n.number,
      title: n.title,
      created_at: n.createdAt,
      merged_at: n.mergedAt,
      closed_at: n.closedAt,
      additions: n.additions,
      deletions: n.deletions,
      repo: n.repository.nameWithOwner,
      language: n.repository.primaryLanguage?.name ?? null,
      reviews: n.reviews.nodes.map((r) => ({ author: r.author?.login ?? null, state: r.state })),
    })),
    reviews: reviewed.nodes.flatMap((n) =>
      n.reviews.nodes
        .filter((r): r is { state: string; submittedAt: string } => !!r.submittedAt)
        .map((r) => ({ pr_number: n.number, pr_title: n.title, pr_created_at: n.createdAt, repo: n.repository.nameWithOwner, state: r.state, submitted_at: r.submittedAt })),
    ),
    commits: commits.commits.filter((c) => c.date),
    totalCommits: commits.total,
    partial: authored.failed || reviewed.failed || commits.failed || commits.incomplete,
    requests: counter,
  }, now);
}
