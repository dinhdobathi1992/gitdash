/**
 * Contributors for Team insights: who merged, who reviewed whom, how fast.
 *
 * Two paths behind GET /api/github/repo-contributors:
 *  - legacy (no `days`): the route's own REST fetch, unchanged; account links
 *    are applied afterwards by applyLinksToLegacy() (approximate for averages).
 *  - windowed (`days=30|90`): fetchPrFactsWindow() reads merged PRs with their
 *    reviews through GraphQL search (separate quota, 50 PRs per query), and
 *    aggregateWindow() turns the facts into exact per-person numbers, the true
 *    PR median and review pairs, with links applied.
 *
 * Facts are link-free and cached per repository; links are applied per
 * request so a link change shows on the next load.
 */

import type { Octokit } from "@octokit/rest";
import type { ContributorRow, RepoContributorsResponse, ReviewerLoadCell } from "@/app/api/github/repo-contributors/route";
import { isBot, normalizeBotLogin } from "./bots";
import { personKey, type Canonical } from "./identity-links";

// ── Legacy post-pass ─────────────────────────────────────────────────────────

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Weighted mean of `value` by `weight`; 0 when nothing carries weight. */
function weighted(rows: ContributorRow[], value: (r: ContributorRow) => number, weight: (r: ContributorRow) => number): number {
  let w = 0;
  let sum = 0;
  for (const r of rows) {
    const wt = weight(r);
    if (wt > 0 && value(r) > 0) {
      w += wt;
      sum += value(r) * wt;
    }
  }
  return w > 0 ? sum / w : 0;
}

/** "Bus factor" of the legacy response: contributors responsible for ≥80% of merged PRs. */
function mergedBusFactor(rows: { prs_merged: number }[], totalMerged: number): number {
  let cumulative = 0;
  let n = 0;
  for (const c of [...rows].sort((a, b) => b.prs_merged - a.prs_merged)) {
    cumulative += c.prs_merged;
    n++;
    if (cumulative >= totalMerged * 0.8) break;
  }
  return n;
}

/**
 * Merge linked logins in a finished legacy response. Counts are summed;
 * averages are weighted (time to merge and size by merged PRs, review
 * turnaround by reviews given, first-pass approval by merged PRs — the legacy
 * output does not say how many PRs were reviewed, so this is an
 * approximation; windowed mode is exact). Matrix cells are re-keyed and a
 * cell whose author and reviewer are now one person is dropped. With no
 * merge to do, the response is returned as is.
 */
export function applyLinksToLegacy(res: RepoContributorsResponse, canonical: Canonical): RepoContributorsResponse {
  const groups = new Map<string, ContributorRow[]>();
  for (const r of res.contributors) {
    const k = canonical(r.login);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const selfCell = res.reviewer_matrix.some((c) => canonical(c.author) === canonical(c.reviewer));
  if ([...groups.values()].every((g) => g.length === 1) && !selfCell) return res;

  const displayOf = new Map<string, string>();
  const contributors: ContributorRow[] = [];
  for (const [key, rows] of groups) {
    if (rows.length === 1) {
      displayOf.set(key, rows[0].login);
      contributors.push(rows[0]);
      continue;
    }
    const lead = rows.reduce((best, r) =>
      r.prs_merged + r.reviews_given > best.prs_merged + best.reviews_given ? r : best);
    displayOf.set(key, lead.login);
    const sum = (f: (r: ContributorRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    contributors.push({
      login: lead.login,
      avatar_url: lead.avatar_url,
      prs_merged: sum((r) => r.prs_merged),
      prs_opened: sum((r) => r.prs_opened),
      avg_hours_to_merge: round1(weighted(rows, (r) => r.avg_hours_to_merge, (r) => r.prs_merged)),
      avg_pr_size: Math.round(weighted(rows, (r) => r.avg_pr_size, (r) => r.prs_merged)),
      reviews_given: sum((r) => r.reviews_given),
      avg_review_turnaround_hours: round1(weighted(rows, (r) => r.avg_review_turnaround_hours, (r) => r.reviews_given)),
      first_pass_approval_rate: Math.round(weighted(rows, (r) => r.first_pass_approval_rate, (r) => r.prs_merged)),
      self_merge_count: sum((r) => r.self_merge_count),
      comment_count: sum((r) => r.comment_count),
    });
  }
  contributors.sort((a, b) => b.prs_merged - a.prs_merged);

  const display = (login: string) => displayOf.get(canonical(login)) ?? login;
  const cells = new Map<string, ReviewerLoadCell>();
  for (const c of res.reviewer_matrix) {
    if (canonical(c.author) === canonical(c.reviewer)) continue;
    const author = display(c.author);
    const reviewer = display(c.reviewer);
    const k = `${author}::${reviewer}`;
    const cell = cells.get(k);
    if (cell) cell.count += c.count;
    else cells.set(k, { author, reviewer, count: c.count });
  }

  return {
    ...res,
    contributors,
    reviewer_matrix: [...cells.values()],
    bus_factor: contributors.length ? mergedBusFactor(contributors, res.total_prs_analysed) : 0,
  };
}

// ── Windowed facts (GraphQL) ─────────────────────────────────────────────────

export const WINDOW_DAYS = [30, 90] as const;
export type WindowDays = (typeof WINDOW_DAYS)[number];

/** PRs per search page, and the page cap (search returns at most 1,000 results). */
export const SEARCH_PAGE_SIZE = 50;
export const MAX_SEARCH_PAGES = 10;
/** Reviews read per PR (GraphQL cost counts connections, not nodes: 100 costs the same as 20). A PR with more is counted from its first 100. */
export const REVIEWS_PER_PR = 100;
/** Stop paging when the GraphQL budget left drops below this. */
export const MIN_GRAPHQL_REMAINING = 500;

export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";

/** One merged PR, trimmed to what the numbers need (no titles or bodies). Logins lowercase. */
export interface PrFact {
  number: number;
  author: string | null;
  created_at: string;
  merged_at: string;
  merged_by: string | null;
  size: number;
  reviews: { reviewer: string; state: ReviewState; submitted_at: string | null }[];
  /** More reviews exist than were read. */
  reviews_truncated?: boolean;
}

export interface PrFactsWindow {
  facts: PrFact[];
  /** Display login and avatar per lowercase login seen in the facts. */
  people: Record<string, { login: string; avatar_url: string; bot: boolean }>;
  /** Merged PRs the search reports for the window (the facts may be fewer). */
  total_merged: number;
  /** PRs opened in the window (a different set of PRs than the merged ones). */
  opened_in_window: number;
  /** A page failed, GitHub rate-limited us, or the GraphQL budget ran low: retry soon. */
  partial: boolean;
  /** The page cap was reached: only the most recent merged PRs are in the facts (a retry would not change it). */
  capped: boolean;
  /** PRs with more reviews than were read (the first REVIEWS_PER_PR, in order, are known). */
  truncated_review_prs: number;
  window_days: WindowDays;
  /** GraphQL points spent (sum of rateLimit.cost). */
  graphql_cost: number;
}

const WINDOW_QUERY = `
query ($q: String!, $opened: String!, $cursor: String, $first: Boolean!) {
  rateLimit { cost remaining }
  opened: search(query: $opened, type: ISSUE, first: 0) @include(if: $first) { issueCount }
  search(query: $q, type: ISSUE, first: ${SEARCH_PAGE_SIZE}, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number createdAt mergedAt additions deletions
        author { login avatarUrl __typename }
        mergedBy { login __typename }
        reviews(first: ${REVIEWS_PER_PR}) {
          totalCount
          nodes { author { login avatarUrl __typename } state submittedAt }
        }
      }
    }
  }
}`;

interface GqlActor { login: string; avatarUrl?: string; __typename?: string }
interface GqlPr {
  number: number; createdAt: string; mergedAt: string | null; additions: number; deletions: number;
  author: GqlActor | null; mergedBy: GqlActor | null;
  reviews: { totalCount: number; nodes: { author: GqlActor | null; state: ReviewState; submittedAt: string | null }[] };
}
interface GqlPage {
  rateLimit?: { cost: number; remaining: number };
  opened?: { issueCount: number };
  search: { issueCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (GqlPr | Record<string, never>)[] };
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Merged PRs of the last `days` days with their reviews. Never waits on a
 * rate limit: a limited or failing page ends the fetch with `partial` set, so
 * the page answers at once with what it has.
 */
/** Days per search slice: a 90-day window is read as three 30-day slices in parallel. */
export const SLICE_DAYS = 30;

/**
 * Merged PRs of the last `days` days with their reviews. Search pages depend
 * on the previous page's cursor, so a long window is split into 30-day slices
 * fetched in parallel (each ~2 s per page on GitHub). Never waits on a rate
 * limit: a limited or failing page ends its slice with `partial` set, so the
 * page answers at once with what it has.
 */
export async function fetchPrFactsWindow(
  octokit: Octokit, owner: string, repo: string, days: WindowDays, now = new Date(),
): Promise<PrFactsWindow> {
  const scope = `repo:${owner}/${repo} is:pr`;
  const since = isoDate(new Date(now.getTime() - days * 86_400_000));
  const out: PrFactsWindow = {
    facts: [], people: {}, total_merged: 0, opened_in_window: 0, partial: false, capped: false, truncated_review_prs: 0,
    window_days: days, graphql_cost: 0,
  };
  const see = (a: GqlActor | null): string | null => {
    if (!a?.login) return null;
    const login = normalizeBotLogin(a.login, a.__typename);
    const key = login.toLowerCase();
    if (!out.people[key]) out.people[key] = { login, avatar_url: a.avatarUrl ?? "", bot: isBot(login, a.__typename) };
    else if (!out.people[key].avatar_url && a.avatarUrl) out.people[key].avatar_url = a.avatarUrl;
    return key;
  };

  // Non-overlapping date ranges, oldest first; the newest is open-ended.
  const sliceCount = Math.max(1, Math.round(days / SLICE_DAYS));
  const ranges = Array.from({ length: sliceCount }, (_, i) => {
    const from = isoDate(new Date(now.getTime() - (days - i * SLICE_DAYS) * 86_400_000));
    if (i === sliceCount - 1) return `merged:>=${from}`;
    const to = isoDate(new Date(now.getTime() - (days - (i + 1) * SLICE_DAYS + 1) * 86_400_000));
    return `merged:${from}..${to}`;
  });
  const pagesPerSlice = Math.ceil(MAX_SEARCH_PAGES / sliceCount);

  async function slice(range: string, withOpened: boolean) {
    const nodes: GqlPr[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < pagesPerSlice; page++) {
      let data: GqlPage;
      try {
        data = await octokit.graphql<GqlPage>(WINDOW_QUERY, {
          q: `${scope} is:merged ${range}`, opened: `${scope} created:>=${since}`, cursor, first: withOpened && page === 0,
          // Read by the throttling hook in github.ts: answer now with partial data, never wait.
          request: { noRateLimitWait: true },
        });
      } catch (err) {
        console.warn(`[team-contributors] ${owner}/${repo} ${range}: page ${page + 1} failed, returning partial data:`, (err as Error)?.message ?? err);
        out.partial = true;
        break;
      }
      out.graphql_cost += data.rateLimit?.cost ?? 0;
      if (page === 0) out.total_merged += data.search.issueCount;
      if (withOpened && page === 0) out.opened_in_window = data.opened?.issueCount ?? 0;
      for (const n of data.search.nodes) if ("number" in n && n.mergedAt) nodes.push(n as GqlPr);
      if (!data.search.pageInfo.hasNextPage) break;
      if (page === pagesPerSlice - 1) {
        out.capped = true;
        break;
      }
      const remaining = data.rateLimit?.remaining;
      if (remaining !== undefined && remaining < MIN_GRAPHQL_REMAINING) {
        out.partial = true;
        break;
      }
      cursor = data.search.pageInfo.endCursor;
    }
    return nodes;
  }

  const sliced = await Promise.all(ranges.map((r, i) => slice(r, i === ranges.length - 1)));
  const seenPr = new Set<number>();
  for (const n of sliced.flat()) {
    if (seenPr.has(n.number)) continue; // a PR merged on a boundary day could appear twice
    seenPr.add(n.number);
    const truncated = n.reviews.totalCount > n.reviews.nodes.length;
    if (truncated) out.truncated_review_prs++;
    out.facts.push({
      number: n.number,
      author: see(n.author),
      created_at: n.createdAt,
      merged_at: n.mergedAt!,
      merged_by: see(n.mergedBy),
      size: (n.additions ?? 0) + (n.deletions ?? 0),
      reviews: n.reviews.nodes.flatMap((r) => {
        const reviewer = see(r.author);
        return reviewer ? [{ reviewer, state: r.state, submitted_at: r.submittedAt }] : [];
      }),
      ...(truncated ? { reviews_truncated: true } : {}),
    });
  }
  console.info(`[team-contributors] ${owner}/${repo} ${days}d: ${out.facts.length}/${out.total_merged} PRs in ${ranges.length} slice(s), ${out.graphql_cost} GraphQL points${out.partial ? ", partial" : ""}${out.capped ? ", capped" : ""}`);
  return out;
}

// ── Windowed aggregation (pure) ──────────────────────────────────────────────

export interface WindowContributorRow extends Omit<ContributorRow, "comment_count"> {
  /** Median hours open → merged of this person's merged PRs. */
  median_hours_to_merge: number | null;
  /** This person's merged PRs that got at least one human review (weights first-pass approval). */
  reviewed_prs: number;
  is_bot: boolean;
  /** Logins merged into this row by account links, when more than one is present here. */
  linked_logins?: string[];
  /** Opaque person key, the same in every Team API — joins rows whose display logins differ. */
  person_key: string;
}

export interface ReviewPair {
  author: string;
  reviewer: string;
  /** Pull requests (not review events) where `reviewer` reviewed `author`. */
  prs: number;
  /** The reviewer is a bot. */
  bot: boolean;
  /** The author is a bot (dependabot PRs etc.) — shown only with bots on. */
  author_bot: boolean;
}

export interface RepoContributorsWindowResponse extends Omit<RepoContributorsResponse, "contributors"> {
  contributors: WindowContributorRow[];
  window_days: WindowDays;
  /** Human-authored merged PRs in the window (bots never count toward team numbers). */
  prs_merged_total: number;
  /** Merged PRs by bots, shown only as a count. */
  bot_prs_merged: number;
  /** True median hours open → merged across human-authored PRs. */
  median_hours_to_merge: number | null;
  /** PRs opened in the window — a different set than the merged ones. */
  prs_opened_in_window: number;
  prs_human_reviewed: number;
  prs_no_human_review: number;
  prs_self_merged: number;
  /** PRs a bot reviewed (one per PR and bot). Never counts toward the bus factor. */
  bot_reviews: number;
  /** Reviews between logins linked to one person (self-reviews, not human review). */
  linked_self_reviews: number;
  review_pairs: ReviewPair[];
  coverage: { partial: boolean; capped: boolean; fetched_prs: number; total_prs: number; truncated_review_prs: number };
}

const HUMAN_STATES = new Set<ReviewState>(["APPROVED", "CHANGES_REQUESTED", "COMMENTED"]);

function median(v: number[]): number | null {
  const s = v.filter((x) => x >= 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const hoursBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;

/**
 * Per-person numbers, KPIs and review pairs from windowed facts, with account
 * links applied through `canonical`. Human review: submitted, state APPROVED /
 * CHANGES_REQUESTED / COMMENTED, reviewer not a bot and not the author (after
 * links). A merged person's display login is their most active login here.
 */
export function aggregateWindow(w: PrFactsWindow, canonical: Canonical): RepoContributorsWindowResponse {
  interface Acc {
    logins: Map<string, number>;
    bot: boolean;
    merged: number;
    mergeHours: number[];
    sizes: number[];
    reviewsGiven: number;
    turnarounds: number[];
    reviewedPrs: number;
    firstPass: number;
    selfMerges: number;
  }
  const accs = new Map<string, Acc>();
  const personOf = (login: string): string => (w.people[login]?.bot ? login : canonical(login));
  const acc = (login: string): Acc => {
    const key = personOf(login);
    let a = accs.get(key);
    if (!a) {
      a = { logins: new Map(), bot: !!w.people[login]?.bot, merged: 0, mergeHours: [], sizes: [], reviewsGiven: 0, turnarounds: [], reviewedPrs: 0, firstPass: 0, selfMerges: 0 };
      accs.set(key, a);
    }
    a.logins.set(login, (a.logins.get(login) ?? 0) + 1);
    return a;
  };
  /** A linked login that changed a number (self-merge, self-review) without activity of its own. */
  const touch = (login: string) => {
    const a = accs.get(personOf(login));
    if (a && !a.logins.has(login)) a.logins.set(login, 0);
  };

  const pairs = new Map<string, { author: string; reviewer: string; prs: number; bot: boolean; author_bot: boolean }>();
  let humanMerged = 0;
  let botMerged = 0;
  let humanReviewed = 0;
  let selfMerged = 0;
  let botReviews = 0;
  let linkedSelfReviews = 0;
  const teamHours: number[] = [];

  for (const pr of w.facts) {
    const authorBot = pr.author ? !!w.people[pr.author]?.bot : false;
    if (pr.author) {
      const a = acc(pr.author);
      a.merged++;
      const h = hoursBetween(pr.created_at, pr.merged_at);
      a.mergeHours.push(h);
      if (pr.size > 0) a.sizes.push(pr.size);
      if (!authorBot) teamHours.push(h);
      if (pr.merged_by && personOf(pr.merged_by) === personOf(pr.author)) {
        a.selfMerges++;
        if (!authorBot) selfMerged++;
        touch(pr.merged_by);
      }
    }
    if (authorBot) botMerged++;
    else humanMerged++;

    const authorKey = pr.author ? personOf(pr.author) : null;
    const submitted = pr.reviews
      .filter((r) => r.submitted_at !== null)
      .sort((x, y) => x.submitted_at!.localeCompare(y.submitted_at!));
    const humanReviews = submitted.filter((r) => {
      if (!HUMAN_STATES.has(r.state) || w.people[r.reviewer]?.bot) return false;
      if (authorKey !== null && personOf(r.reviewer) === authorKey) {
        if (r.reviewer !== pr.author) {
          linkedSelfReviews++;
          touch(r.reviewer);
        }
        return false;
      }
      return true;
    });

    // One count per PR and reviewer (person), humans and bots alike.
    const seen = new Set<string>();
    for (const r of submitted) {
      const bot = !!w.people[r.reviewer]?.bot;
      const rKey = personOf(r.reviewer);
      if (seen.has(rKey)) continue;
      const counts = bot ? r.state !== "PENDING" : humanReviews.includes(r);
      if (!counts) continue;
      seen.add(rKey);
      // Reviews of bot-authored PRs appear only as dimmed pairs: they never count
      // toward a person's reviews, the bus factor or the single-reviewer finding,
      // which are all measured over human-authored PRs.
      if (!authorBot) {
        const ra = acc(r.reviewer);
        ra.reviewsGiven++;
        if (!bot) ra.turnarounds.push(hoursBetween(pr.created_at, r.submitted_at!));
        else botReviews++;
      }
      if (pr.author) {
        const pk = `${authorKey}::${rKey}`;
        const p = pairs.get(pk);
        if (p) p.prs++;
        else pairs.set(pk, { author: pr.author, reviewer: r.reviewer, prs: 1, bot, author_bot: authorBot });
      }
    }

    if (humanReviews.length) {
      if (!authorBot) humanReviewed++;
      if (pr.author) {
        const a = accs.get(authorKey!)!;
        a.reviewedPrs++;
        if (humanReviews[0].state === "APPROVED") a.firstPass++;
      }
    }
  }

  const displayOf = new Map<string, string>();
  const contributors: WindowContributorRow[] = [];
  for (const [key, a] of accs) {
    const logins = [...a.logins.entries()];
    const lead = logins.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
    const shown = w.people[lead]?.login ?? lead;
    displayOf.set(key, shown);
    contributors.push({
      login: shown,
      avatar_url: w.people[lead]?.avatar_url ?? "",
      prs_merged: a.merged,
      prs_opened: 0,
      avg_hours_to_merge: round1(mean(a.mergeHours.filter((h) => h > 0))),
      median_hours_to_merge: (() => { const m = median(a.mergeHours); return m === null ? null : round1(m); })(),
      avg_pr_size: Math.round(mean(a.sizes)),
      reviews_given: a.reviewsGiven,
      avg_review_turnaround_hours: round1(mean(a.turnarounds.filter((h) => h > 0))),
      first_pass_approval_rate: a.reviewedPrs ? Math.round((a.firstPass / a.reviewedPrs) * 100) : 0,
      reviewed_prs: a.reviewedPrs,
      self_merge_count: a.selfMerges,
      is_bot: a.bot,
      ...(logins.length > 1 ? { linked_logins: logins.map(([l]) => w.people[l]?.login ?? l) } : {}),
      person_key: personKey(key),
    });
  }
  contributors.sort((a, b) => b.prs_merged - a.prs_merged || b.reviews_given - a.reviews_given || a.login.localeCompare(b.login));

  const display = (login: string) => displayOf.get(personOf(login)) ?? w.people[login]?.login ?? login;
  const review_pairs: ReviewPair[] = [...pairs.values()]
    .map((p) => ({ author: display(p.author), reviewer: display(p.reviewer), prs: p.prs, bot: p.bot, author_bot: p.author_bot }))
    .sort((a, b) => b.prs - a.prs || a.reviewer.localeCompare(b.reviewer));
  const reviewer_matrix: ReviewerLoadCell[] = review_pairs
    .filter((p) => !p.bot && !p.author_bot)
    .map((p) => ({ author: p.author, reviewer: p.reviewer, count: p.prs }));

  const humans = contributors.filter((c) => !c.is_bot);
  const mergedHours = median(teamHours);
  return {
    contributors,
    reviewer_matrix,
    total_prs_analysed: w.facts.length,
    period_days: w.window_days,
    bus_factor: humans.length ? mergedBusFactor(humans, humanMerged) : 0,
    partial: w.partial,
    fetched_prs: w.facts.length,
    total_prs_attempted: Math.max(w.total_merged, w.facts.length),
    window_days: w.window_days,
    prs_merged_total: humanMerged,
    bot_prs_merged: botMerged,
    median_hours_to_merge: mergedHours === null ? null : round1(mergedHours),
    prs_opened_in_window: w.opened_in_window,
    prs_human_reviewed: humanReviewed,
    prs_no_human_review: humanMerged - humanReviewed,
    prs_self_merged: selfMerged,
    bot_reviews: botReviews,
    linked_self_reviews: linkedSelfReviews,
    review_pairs,
    coverage: {
      partial: w.partial, capped: w.capped, fetched_prs: w.facts.length,
      total_prs: Math.max(w.total_merged, w.facts.length), truncated_review_prs: w.truncated_review_prs,
    },
  };
}
