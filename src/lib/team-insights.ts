/**
 * Team insights engine — pure. Turns the three API responses (contributors,
 * workload, working habits) into everything the Team page shows: KPIs, the
 * "What stands out" findings (worst first), review pairs, the People table,
 * its CSV rows, and account-link suggestions for admins.
 *
 * No network, no React. Copy lives here (and is tested) so the page stays
 * dumb. Account links are already applied by the APIs; this module only joins
 * the three sources on shared logins.
 */

import type { RepoContributorsWindowResponse, ReviewPair, WindowContributorRow } from "./team-contributors";
import type { WorkloadPerson } from "./team-workload";
import type { WorkingHabitsResponse } from "./working-habits";
import type { Workday } from "./team-settings";
import { formatWorkday } from "./team-settings";
import { reviewBusFactor } from "./team-metrics";

// ── Inputs ───────────────────────────────────────────────────────────────────

/** The windowed workload response fields the engine reads. */
export interface WorkloadInput {
  people: WorkloadPerson[];
  partial: boolean;
  total_commits_analysed: number;
  thresholds: { after_hours_pct: number; weekend_pct: number; open_prs: number; min_sample: number };
  workday: Workday;
}

export interface AdminLinkData {
  links: { alias_login: string; primary_login: string }[];
  distinct: { login_a: string; login_b: string }[];
}

export interface TeamInsightsInput {
  contributors: RepoContributorsWindowResponse;
  /** Present only with the workloadRisk grant. */
  workload?: WorkloadInput | null;
  /** Present only with the workingHabits grant (or the viewer's own numbers). */
  habits?: WorkingHabitsResponse | null;
  /** Admins only: stored links and "different people" pairs, for suggestions. */
  admin?: AdminLinkData | null;
  grants: { workload: boolean; habits: boolean };
  showBots: boolean;
  /** "owner/repo" — used in PR references like gitdash#29. */
  repo: string;
}

// ── Outputs ──────────────────────────────────────────────────────────────────

/** Text with logins/refs marked for monospace rendering. */
export type RichText = (string | { mono: string })[];

export type Severity = "high" | "watch" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  title: RichText;
  detail: RichText;
  /** Section anchor the finding points to. */
  href: "#reviews" | "#workload" | "#habits" | "#people";
  cta: string;
  /** Tie-break inside a severity (bigger = worse). */
  magnitude: number;
}

export interface Suggestion {
  a: string;
  b: string;
  /** More active login — the link keeps it as the primary. */
  primary: string;
  alias: string;
  /** Pull requests where one reviewed the other in this window. */
  prs: number;
  title: RichText;
  detail: RichText;
}

export interface Kpis {
  merged: number;
  openedInWindow: number;
  medianHours: number | null;
  humanReviewed: number;
  noHumanReview: number;
  bus: { people: number; share: number; top: string | null } | null;
  selfMerged: number;
}

export interface PairRow extends ReviewPair {
  /** Share of the busiest pair, 0–100, for the bar. */
  width: number;
}

export interface PersonRow {
  key: string;
  login: string;
  avatar_url: string;
  role: "Author" | "Reviewer" | "Author · Reviewer" | "Bot" | "Committer";
  isBot: boolean;
  /** Git author name, not a GitHub account (workload only). */
  unlinkedName: boolean;
  /** Logins merged into this person, when more than one appears on the page. */
  linkedLogins: string[] | null;
  merged: number | null;
  toMergeHours: number | null;
  firstPassPct: number | null;
  selfMerged: number | null;
  reviews: number | null;
  respondsInHours: number | null;
  /** null = not applicable; undefined never — "hidden" is decided by the grants. */
  afterHoursPct: number | null;
  oversizedPct: number | null;
}

export interface TeamInsights {
  kpis: Kpis;
  findings: Finding[];
  /** One line when some source is partial; null when everything loaded. */
  coverage: string | null;
  pairs: {
    mode: "list" | "heatmap";
    rows: PairRow[];
    cells: { author: string; reviewer: string; count: number }[];
    botReviews: number;
    footnote: string;
  };
  people: PersonRow[];
  suggestions: Suggestion[];
  botLine: { text: string; count: number } | null;
  meta: { people: number; prs: number };
}

// ── Thresholds (the one place to tune them) ──────────────────────────────────

export const FINDING_RULES = {
  /** After hours is "high" at this multiple of the threshold. */
  afterHoursHighFactor: 1.5,
  singleReviewerMinReviewed: 3,
  noReviewShare: 0.5,
  noReviewHighShare: 0.75,
  noReviewMinMerged: 4,
  oversizedShare: 0.4,
  oversizedHighShare: 0.6,
  /** Human reviewers needed before the pairs list becomes a heatmap. */
  heatmapReviewers: 4,
  suggestionStemMin: 5,
};

const RANK: Record<Severity, number> = { high: 3, watch: 2, info: 1 };

// ── Helpers ──────────────────────────────────────────────────────────────────

const lc = (s: string) => s.toLowerCase();
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const fmtInt = (n: number) => n.toLocaleString("en-US");
const repoShort = (full: string) => full.split("/").pop() ?? full;

/** Duration for tiles and cells: 48m, 5h, 3d. */
export function fmtHours(h: number | null): string {
  if (h === null || !Number.isFinite(h) || h < 0) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

/** Heatmap cells from pair rows — the same numbers the list shows (PRs, not events). */
export function pairsToCells(rows: ReviewPair[]): { author: string; reviewer: string; count: number }[] {
  return rows.map((r) => ({ author: r.author, reviewer: r.reviewer, count: r.prs }));
}

/** Stem for the identity heuristic: lowercase without digits, `-` and `_`. */
export function loginStem(login: string): string {
  return lc(login).replace(/\[bot\]$/, "").replace(/[\d_-]/g, "");
}

// ── Engine ───────────────────────────────────────────────────────────────────

export function buildTeamInsights(input: TeamInsightsInput): TeamInsights {
  const { contributors: c, showBots, grants } = input;
  const workload = grants.workload ? input.workload ?? null : null;
  const habits = grants.habits ? input.habits ?? null : null;
  const humanRows = c.contributors.filter((r) => !r.is_bot);
  const botRows = c.contributors.filter((r) => r.is_bot);

  // ── KPIs ──
  const reviewers = humanRows.filter((r) => r.reviews_given > 0).sort((a, b) => b.reviews_given - a.reviews_given);
  const bus = reviewBusFactor(reviewers.map((r) => r.reviews_given));
  const kpis: Kpis = {
    merged: c.prs_merged_total,
    openedInWindow: c.prs_opened_in_window,
    medianHours: c.median_hours_to_merge,
    humanReviewed: c.prs_human_reviewed,
    noHumanReview: c.prs_no_human_review,
    bus: bus ? { ...bus, top: reviewers[0]?.login ?? null } : null,
    selfMerged: c.prs_self_merged,
  };

  // ── Coverage ──
  // Errors/rate limits, or the page cap (only the latest PRs read): ratios would mislead.
  const partialContrib = c.coverage.partial || c.coverage.capped;
  const partialWorkload = !!workload?.partial;
  const partialHabits = !!habits && habits.available && !habits.coverage.complete;
  const coverageBits: string[] = [];
  if (c.coverage.partial) coverageBits.push(`Based on ${fmtInt(c.coverage.fetched_prs)} of ${plural(c.coverage.total_prs, "pull request")}`);
  else if (c.coverage.capped) coverageBits.push(`Based on the latest ${fmtInt(c.coverage.fetched_prs)} of ${plural(c.coverage.total_prs, "pull request")}`);
  if (partialWorkload) coverageBits.push(`workload counts the latest ${plural(workload!.total_commits_analysed, "commit")} only`);
  if (partialHabits) coverageBits.push(`working habits analysed ${habits!.coverage.analysedPrs} of ${plural(habits!.coverage.mergedPrs, "merged pull request")} so far`);
  const truncated = c.coverage.truncated_review_prs;
  const truncatedNote = truncated
    ? `${plural(truncated, "pull request")} had more than 100 reviews; the first 100 were counted.`
    : null;
  const coverage = coverageBits.length
    ? `${coverageBits.join(" · ")} — some data could not be loaded, so findings that depend on it are left out.${truncatedNote ? ` ${truncatedNote}` : ""}`
    : truncatedNote;

  // ── Findings ──
  const findings: Finding[] = [];

  if (workload && !partialWorkload) {
    const t = workload.thresholds;
    const flagged = workload.people
      .filter((p) => p.flags.after_hours && !p.is_bot)
      .sort((a, b) => b.after_hours_pct - a.after_hours_pct);
    for (const p of flagged.slice(0, 3)) {
      findings.push({
        id: `after-hours:${lc(p.login)}`,
        severity: p.after_hours_pct >= t.after_hours_pct * FINDING_RULES.afterHoursHighFactor ? "high" : "watch",
        title: [`${p.after_hours_pct}% of commits land after hours`],
        detail: [{ mono: p.login }, ` · ${p.weekend_pct}% on weekends · outside ${formatWorkday(workload.workday)}`],
        href: "#workload",
        cta: "See workload",
        magnitude: p.after_hours_pct,
      });
    }
  }

  if (!partialContrib && bus && bus.people === 1 && kpis.humanReviewed >= FINDING_RULES.singleReviewerMinReviewed) {
    const top = reviewers[0];
    const only = reviewers.length === 1;
    const topShare = Math.round((top.reviews_given / reviewers.reduce((s, r) => s + r.reviews_given, 0)) * 100);
    findings.push({
      id: "single-reviewer",
      severity: "high",
      title: [only ? "Every review comes from one person" : `${topShare}% of reviews come from one person`],
      detail: [
        { mono: top.login },
        ` reviewed ${top.reviews_given} of ${plural(kpis.humanReviewed, "pull request")} that got a human review. If they're away, ${only ? "nothing gets reviewed" : "reviews slow down"}.`,
      ],
      href: "#reviews",
      cta: "See reviews",
      magnitude: top.reviews_given / Math.max(1, kpis.humanReviewed),
    });
  }

  const noReviewShare = kpis.merged ? kpis.noHumanReview / kpis.merged : 0;
  if (!partialContrib && kpis.merged >= FINDING_RULES.noReviewMinMerged && noReviewShare >= FINDING_RULES.noReviewShare) {
    findings.push({
      id: "no-review",
      severity: noReviewShare >= FINDING_RULES.noReviewHighShare ? "high" : "watch",
      title: [`${kpis.noHumanReview} of ${kpis.merged} merged without a human review`],
      detail: ["Bot reviews and reviews between linked accounts don't count. Nobody else read this code before it merged."],
      href: "#reviews",
      cta: "See reviews",
      magnitude: noReviewShare,
    });
  }

  if (habits && habits.available && !habits.untrackedRepo) {
    const tot = habits.totals;
    const share = tot.commits ? tot.oversizedCommits / tot.commits : 0;
    if (!partialHabits && tot.commits > 0 && share >= FINDING_RULES.oversizedShare) {
      const byPr = new Map<string, number>();
      for (const x of habits.commits) byPr.set(`${x.repo}#${x.prNumber}`, (byPr.get(`${x.repo}#${x.prNumber}`) ?? 0) + 1);
      const [topPr, topCount] = [...byPr.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
      const largest = habits.commits[0];
      const prRef = (ref: string) => `${repoShort(ref.split("#")[0])}#${ref.split("#")[1]}`;
      const detail: RichText = [];
      if (topPr) {
        detail.push(`${topCount} of them ${topCount === 1 ? "is" : "are"} in `, { mono: prRef(topPr) });
        if (largest && `${largest.repo}#${largest.prNumber}` === topPr) {
          detail.push(`, including the largest: ${largest.files === null ? "? files" : plural(largest.files, "file")}, +${fmtInt(largest.additions)} −${fmtInt(largest.deletions)}`);
        } else if (largest) {
          detail.push(`. Largest: `, { mono: largest.sha.slice(0, 7) }, `, ${largest.files === null ? "? files" : plural(largest.files, "file")}, +${fmtInt(largest.additions)} −${fmtInt(largest.deletions)}`);
        }
      }
      findings.push({
        id: "oversized-commits",
        severity: share >= FINDING_RULES.oversizedHighShare ? "high" : "watch",
        title: [`${tot.oversizedCommits} of ${tot.commits} commits are bigger than your limit`],
        detail,
        href: "#habits",
        cta: "See commits",
        magnitude: share,
      });
    }
    if (tot.oversizedPrs > 0) {
      const top = habits.prs[0];
      findings.push({
        id: "oversized-prs",
        severity: "watch",
        title: [`${plural(tot.oversizedPrs, "pull request")} ${tot.oversizedPrs === 1 ? "has" : "have"} more than ${habits.thresholds.maxPrCommits} commits`],
        detail: top ? ["The largest is ", { mono: `${repoShort(top.repo)}#${top.number}` }, ` with ${top.commitCount} commits.`] : [],
        href: "#habits",
        cta: "See commits",
        magnitude: tot.oversizedPrs,
      });
    }
  }

  if (kpis.selfMerged > 0) {
    const who = humanRows.filter((r) => r.self_merge_count > 0).sort((a, b) => b.self_merge_count - a.self_merge_count);
    const detail: RichText = [];
    who.slice(0, 3).forEach((r, i) => {
      if (i) detail.push(", ");
      detail.push({ mono: r.login }, ` ${r.self_merge_count}`);
    });
    if (who.length > 3) detail.push(` and ${who.length - 3} more`);
    findings.push({
      id: "self-merge",
      severity: "watch",
      title: [`${plural(kpis.selfMerged, "pull request")} merged by ${kpis.selfMerged === 1 ? "its" : "their"} own author`],
      detail,
      href: "#people",
      cta: "See people",
      magnitude: kpis.selfMerged,
    });
  }

  findings.sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.magnitude - a.magnitude);

  // ── Pairs ──
  const isBotPair = (p: ReviewPair) => p.bot || p.author_bot;
  const visiblePairs = c.review_pairs.filter((p) => showBots || !isBotPair(p));
  const maxPrs = Math.max(1, ...visiblePairs.map((p) => p.prs));
  const humanReviewerCount = new Set(c.review_pairs.filter((p) => !isBotPair(p)).map((p) => lc(p.reviewer))).size;
  const pairs: TeamInsights["pairs"] = {
    mode: humanReviewerCount >= FINDING_RULES.heatmapReviewers ? "heatmap" : "list",
    rows: visiblePairs.map((p) => ({ ...p, width: Math.round((p.prs / maxPrs) * 100) })),
    cells: pairsToCells(visiblePairs),
    botReviews: c.bot_reviews,
    footnote:
      `${kpis.noHumanReview} of the ${kpis.merged} merged pull requests got no human review. ` +
      `Bot reviews (${c.bot_reviews}) never count toward the bus factor.`,
  };

  // ── People ──
  const people = joinPeople(c.contributors, workload?.people ?? null, habits, grants)
    .filter((p) => showBots || !p.isBot)
    .sort((a, b) => Number(a.isBot) - Number(b.isBot) || (b.merged ?? -1) - (a.merged ?? -1) || (b.reviews ?? -1) - (a.reviews ?? -1) || a.login.localeCompare(b.login));

  // ── Bots ──
  let botLine: TeamInsights["botLine"] = null;
  if (botRows.length) {
    const reviews = botRows.reduce((s, b) => s + b.reviews_given, 0);
    const text = showBots
      ? `Showing ${plural(botRows.length, "bot")}. Bots never count toward the team numbers.`
      : botRows.length === 1
        ? `1 bot hidden · ${botRows[0].login} left ${plural(reviews, "review")}`
        : `${botRows.length} bots hidden · they left ${plural(reviews, "review")}`;
    botLine = { text, count: botRows.length };
  }

  // ── Suggestions ──
  const suggestions = input.admin ? suggestLinks(c, input.admin) : [];
  for (const s of suggestions) {
    findings.push({
      id: `identity:${s.a}+${s.b}`,
      severity: "info",
      title: s.title,
      detail: s.detail,
      href: "#people",
      cta: "",
      magnitude: s.prs,
    });
  }

  return {
    kpis,
    findings,
    coverage,
    pairs,
    people,
    suggestions,
    botLine,
    meta: { people: humanRows.length, prs: kpis.merged },
  };
}

function joinPeople(
  contributors: WindowContributorRow[],
  workload: WorkloadPerson[] | null,
  habits: WorkingHabitsResponse | null,
  grants: { workload: boolean; habits: boolean },
): PersonRow[] {
  // Every Team API tags rows with the same opaque person key (canonical login,
  // hashed), so a linked person joins even when each source shows a different login.
  const rows = new Map<string, PersonRow & { logins: Set<string> }>();
  const row = (key: string | undefined, login: string, avatar: string, isBot: boolean, linked?: string[] | null) => {
    const k = key ?? `login:${lc(login)}`;
    let r = rows.get(k);
    if (!r) {
      r = {
        key: k, login, avatar_url: avatar, role: "Committer", isBot, unlinkedName: false, linkedLogins: null,
        merged: null, toMergeHours: null, firstPassPct: null, selfMerged: null, reviews: null, respondsInHours: null,
        afterHoursPct: null, oversizedPct: null, logins: new Set(),
      };
      rows.set(k, r);
    }
    if (!r.avatar_url && avatar) r.avatar_url = avatar;
    for (const l of linked?.length ? linked : [login]) r.logins.add(l);
    return r;
  };

  for (const c of contributors) {
    const r = row(c.person_key, c.login, c.avatar_url, c.is_bot, c.linked_logins);
    r.login = c.login;
    if (c.prs_merged > 0) {
      r.merged = c.prs_merged;
      r.toMergeHours = c.median_hours_to_merge;
      r.firstPassPct = c.reviewed_prs > 0 ? c.first_pass_approval_rate : null;
      r.selfMerged = c.self_merge_count;
    }
    if (c.reviews_given > 0) {
      r.reviews = c.reviews_given;
      r.respondsInHours = c.is_bot || !c.avg_review_turnaround_hours ? null : c.avg_review_turnaround_hours;
    }
  }
  if (grants.workload) {
    for (const w of (workload ?? []).filter((x) => !x.unlinked_name)) {
      row(w.person_key, w.login, w.avatar_url, w.is_bot, w.linked_logins).afterHoursPct = w.after_hours_pct;
    }
  }
  if (grants.habits && habits) {
    for (const h of habits.people) {
      row(h.personKey, h.login, "", false, h.linkedLogins).oversizedPct = h.commits > 0 ? h.oversizedCommitPct : null;
    }
  }

  const out: PersonRow[] = [];
  for (const { logins, ...r } of rows.values()) {
    const names = [...new Map([...logins].map((l) => [lc(l), l])).values()];
    r.linkedLogins = names.length > 1 ? names : null;
    r.role = r.isBot ? "Bot" : r.merged && r.reviews ? "Author · Reviewer" : r.merged ? "Author" : r.reviews ? "Reviewer" : "Committer";
    out.push(r);
  }
  // Commits keyed by a git author name are not a GitHub account: shown as-is, never joined.
  if (grants.workload) {
    for (const w of (workload ?? []).filter((x) => x.unlinked_name)) {
      out.push({
        key: `name:${w.login}`, login: w.login, avatar_url: "", role: "Committer", isBot: false, unlinkedName: true, linkedLogins: null,
        merged: null, toMergeHours: null, firstPassPct: null, selfMerged: null, reviews: null, respondsInHours: null,
        afterHoursPct: w.after_hours_pct, oversizedPct: null,
      });
    }
  }
  return out;
}

/**
 * Pairs that may be one person: same login stem (≥ 5 chars) and one reviewed
 * the other's pull requests in this window; never already linked, dismissed,
 * bots or git author names.
 */
function suggestLinks(c: RepoContributorsWindowResponse, admin: AdminLinkData): Suggestion[] {
  const linked = new Map(admin.links.map((l) => [lc(l.alias_login), lc(l.primary_login)]));
  const canon = (l: string) => linked.get(lc(l)) ?? lc(l);
  const dismissed = new Set(admin.distinct.map((d) => `${lc(d.login_a)}|${lc(d.login_b)}`));
  const activity = new Map(c.contributors.map((r) => [lc(r.login), r.prs_merged + r.reviews_given]));

  const byPair = new Map<string, { a: string; b: string; prs: number }>();
  for (const p of c.review_pairs) {
    if (p.bot || p.author_bot) continue;
    const [a, b] = [p.author, p.reviewer].sort((x, y) => lc(x).localeCompare(lc(y)));
    if (lc(a) === lc(b)) continue;
    const stem = loginStem(a);
    if (stem.length < FINDING_RULES.suggestionStemMin || stem !== loginStem(b)) continue;
    if (canon(a) === canon(b) || dismissed.has(`${lc(a)}|${lc(b)}`)) continue;
    const k = `${lc(a)}|${lc(b)}`;
    const e = byPair.get(k);
    if (e) e.prs += p.prs;
    else byPair.set(k, { a, b, prs: p.prs });
  }

  return [...byPair.values()]
    .sort((x, y) => y.prs - x.prs)
    .map(({ a, b, prs }) => {
      const aFirst = (activity.get(lc(a)) ?? 0) >= (activity.get(lc(b)) ?? 0);
      const [primary, alias] = aFirst ? [a, b] : [b, a];
      const all = prs >= c.prs_human_reviewed;
      return {
        a, b, primary, alias, prs,
        title: ["Are ", { mono: primary }, " and ", { mono: alias }, " the same person?"],
        detail: [
          all
            ? "If they are, every review here is a self-review and the numbers above overstate how much of your code another person checked."
            : `If they are, ${plural(prs, "review")} here ${prs === 1 ? "is a self-review" : "are self-reviews"} and the numbers above overstate how much of your code another person checked.`,
        ],
      };
    });
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** People table as CSV rows. Columns for a section the viewer is not granted are absent, not empty. */
export function peopleCsvRows(people: PersonRow[], grants: { workload: boolean; habits: boolean }): Record<string, string | number>[] {
  const v = (n: number | null) => (n === null ? "" : n);
  return people.map((p) => ({
    login: p.login,
    role: p.role,
    linked_logins: p.linkedLogins?.join(" ") ?? "",
    merged: v(p.merged),
    to_merge_median_hours: v(p.toMergeHours),
    first_pass_ok_pct: v(p.firstPassPct),
    self_merged: v(p.selfMerged),
    reviews: v(p.reviews),
    responds_in_hours: v(p.respondsInHours),
    ...(grants.workload ? { after_hours_pct: v(p.afterHoursPct) } : {}),
    ...(grants.habits ? { oversized_commit_pct: v(p.oversizedPct) } : {}),
  }));
}
