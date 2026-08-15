/**
 * Issue and triage health (v4.2.2).
 *
 * GitDash measured the supply side of engineering — PRs, CI, deployments —
 * but nothing about demand. Issues are where work arrives, and a backlog that
 * grows faster than it drains is a leading indicator that no delivery metric
 * will show you.
 *
 * ── The trap this module is built around ──────────────────────────────────
 * GitHub's REST API treats pull requests as issues. `GET /issues` returns
 * both, and every PR arrives carrying a `pull_request` key. Forgetting to
 * filter it is the classic mistake here: a busy repo would report its PR
 * throughput as issue throughput, and every metric below would be wrong in a
 * direction that looks plausible. Filtering happens once, immediately, before
 * anything is computed.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 * Everything here is derived from the issue list itself: three paginated
 * calls, no per-issue fan-out. Time-to-first-response would need one call per
 * issue, so it is deliberately not computed — "issues nobody has commented
 * on" is a cheaper signal for the same underlying worry.
 */

import { getOctokit } from "@/lib/github";

export interface IssueRef {
  number: number;
  title: string;
  age_days: number;
  comments: number;
  html_url: string;
}

export interface LabelCount {
  label: string;
  count: number;
  color: string;
}

export interface IssuesSummary {
  repo: string;
  period_days: number;

  open_count: number;
  opened_in_period: number;
  closed_in_period: number;
  /** opened − closed. Positive means the backlog grew. */
  backlog_delta: number;

  median_days_to_close: number | null;
  p90_days_to_close: number | null;

  /** Open with no activity for 30+ days. */
  stale_count: number;
  /** Open with no labels at all — unrouted work. */
  unlabelled_count: number;
  /** Open, older than 14 days, and nobody has commented even once. */
  unanswered_count: number;

  age_buckets: { label: string; count: number }[];
  top_labels: LabelCount[];
  assignee_load: { login: string; open: number }[];
  /** Open issues nobody has replied to, oldest first. */
  neglected: IssueRef[];
  oldest_open: IssueRef | null;

  /** Issues examined after excluding pull requests. */
  total_analysed: number;
  /** True when the window is larger than the sample fetched. */
  partial: boolean;
}

const MAX_PAGES = 3;
const PER_PAGE = 100;
const STALE_DAYS = 30;
const UNANSWERED_MIN_AGE_DAYS = 14;
const MAX_NEGLECTED = 8;
const MAX_LABELS = 8;
const MAX_ASSIGNEES = 6;

const daysBetween = (from: string, to: string) =>
  (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

/** Linear-interpolation percentile, matching the convention used elsewhere. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

interface RawIssue {
  number: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  comments: number;
  html_url: string;
  /** Present ONLY on pull requests. Its existence is how we tell them apart. */
  pull_request?: unknown;
  labels: (string | { name?: string; color?: string })[];
  assignees?: { login: string }[] | null;
}

function labelEntries(issue: RawIssue): { name: string; color: string }[] {
  return issue.labels
    .map((l) =>
      typeof l === "string"
        ? { name: l, color: "64748b" }
        : { name: l.name ?? "", color: l.color ?? "64748b" },
    )
    .filter((l) => l.name.length > 0);
}

export async function getIssuesSummary(
  token: string,
  owner: string,
  repo: string,
  periodDays = 30,
): Promise<IssuesSummary> {
  const octokit = getOctokit(token);

  const raw: RawIssue[] = [];
  let reachedEnd = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "all",
      per_page: PER_PAGE,
      page,
      sort: "updated",
      direction: "desc",
    });
    raw.push(...(data as unknown as RawIssue[]));
    if (data.length < PER_PAGE) {
      reachedEnd = true;
      break;
    }
  }

  // THE filter. Pull requests are issues in this API; counting them would
  // report PR throughput as issue throughput.
  const issues = raw.filter((i) => !i.pull_request);

  const cutoff = Date.now() - periodDays * 86_400_000;
  const inPeriod = (iso: string) => new Date(iso).getTime() >= cutoff;

  const open = issues.filter((i) => i.state === "open");
  const closedInPeriod = issues.filter((i) => i.closed_at && inPeriod(i.closed_at));
  const openedInPeriod = issues.filter((i) => inPeriod(i.created_at));

  // Time to close, from issues actually resolved in the window.
  const closeDurations = closedInPeriod
    .map((i) => daysBetween(i.created_at, i.closed_at!))
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);

  const stale = open.filter((i) => daysSince(i.updated_at) >= STALE_DAYS);
  const unlabelled = open.filter((i) => labelEntries(i).length === 0);
  const neglected = open
    .filter((i) => i.comments === 0 && daysSince(i.created_at) >= UNANSWERED_MIN_AGE_DAYS)
    .sort((a, b) => daysSince(b.created_at) - daysSince(a.created_at));

  // Age distribution of the open backlog.
  const buckets = [
    { label: "< 1 week", min: 0, max: 7 },
    { label: "1–4 weeks", min: 7, max: 30 },
    { label: "1–3 months", min: 30, max: 90 },
    { label: "> 3 months", min: 90, max: Infinity },
  ];
  const ageBuckets = buckets.map((b) => ({
    label: b.label,
    count: open.filter((i) => {
      const age = daysSince(i.created_at);
      return age >= b.min && age < b.max;
    }).length,
  }));

  const labelCounts = new Map<string, LabelCount>();
  for (const issue of open) {
    for (const l of labelEntries(issue)) {
      const existing = labelCounts.get(l.name);
      if (existing) existing.count++;
      else labelCounts.set(l.name, { label: l.name, count: 1, color: l.color });
    }
  }

  const assigneeCounts = new Map<string, number>();
  for (const issue of open) {
    for (const a of issue.assignees ?? []) {
      assigneeCounts.set(a.login, (assigneeCounts.get(a.login) ?? 0) + 1);
    }
  }

  const toRef = (i: RawIssue): IssueRef => ({
    number: i.number,
    title: i.title,
    age_days: daysSince(i.created_at),
    comments: i.comments,
    html_url: i.html_url,
  });

  const oldestOpen =
    open.length > 0
      ? toRef([...open].sort((a, b) => daysSince(b.created_at) - daysSince(a.created_at))[0])
      : null;

  return {
    repo: `${owner}/${repo}`,
    period_days: periodDays,

    open_count: open.length,
    opened_in_period: openedInPeriod.length,
    closed_in_period: closedInPeriod.length,
    backlog_delta: openedInPeriod.length - closedInPeriod.length,

    median_days_to_close: closeDurations.length ? round1(percentile(closeDurations, 0.5)) : null,
    p90_days_to_close: closeDurations.length ? round1(percentile(closeDurations, 0.9)) : null,

    stale_count: stale.length,
    unlabelled_count: unlabelled.length,
    unanswered_count: neglected.length,

    age_buckets: ageBuckets,
    top_labels: [...labelCounts.values()].sort((a, b) => b.count - a.count).slice(0, MAX_LABELS),
    assignee_load: [...assigneeCounts.entries()]
      .map(([login, openCount]) => ({ login, open: openCount }))
      .sort((a, b) => b.open - a.open)
      .slice(0, MAX_ASSIGNEES),
    neglected: neglected.slice(0, MAX_NEGLECTED).map(toRef),
    oldest_open: oldestOpen,

    total_analysed: issues.length,
    // The list is sorted by recent activity, so hitting the page cap means
    // quiet older issues were not seen.
    partial: !reachedEnd,
  };
}
