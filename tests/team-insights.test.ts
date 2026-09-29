import { describe, it, expect } from "vitest";
import {
  buildTeamInsights, fmtHours, loginStem, pairsToCells, peopleCsvRows, FINDING_RULES,
  type RichText, type TeamInsightsInput, type WorkloadInput,
} from "@/lib/team-insights";
import type { RepoContributorsWindowResponse, WindowContributorRow } from "@/lib/team-contributors";
import type { WorkloadPerson } from "@/lib/team-workload";
import type { WorkingHabitsResponse } from "@/lib/working-habits";
import { DEFAULT_WORKDAY } from "@/lib/team-settings";

const text = (t: RichText) => t.map((x) => (typeof x === "string" ? x : x.mono)).join("");

const crow = (login: string, o: Partial<WindowContributorRow> = {}): WindowContributorRow => ({
  login, avatar_url: `a/${login}`, prs_merged: 0, prs_opened: 0, avg_hours_to_merge: 0, median_hours_to_merge: null, avg_pr_size: 0,
  reviews_given: 0, avg_review_turnaround_hours: 0, first_pass_approval_rate: 0, reviewed_prs: 0, self_merge_count: 0, is_bot: false,
  person_key: `k:${login.toLowerCase()}`, ...o,
});

function contributors(o: Partial<RepoContributorsWindowResponse> = {}): RepoContributorsWindowResponse {
  return {
    contributors: [], reviewer_matrix: [], total_prs_analysed: 0, period_days: 30, bus_factor: 0, partial: false,
    fetched_prs: 0, total_prs_attempted: 0, window_days: 30, prs_merged_total: 0, bot_prs_merged: 0, median_hours_to_merge: null,
    prs_opened_in_window: 0, prs_human_reviewed: 0, prs_no_human_review: 0, prs_self_merged: 0, bot_reviews: 0, linked_self_reviews: 0,
    review_pairs: [], coverage: { partial: false, capped: false, fetched_prs: 0, total_prs: 0, truncated_review_prs: 0 }, ...o,
  };
}

const wperson = (login: string, o: Partial<WorkloadPerson> = {}): WorkloadPerson => ({
  login, avatar_url: "", total_commits: 20, after_hours_pct: 0, weekend_pct: 0, open_pr_count: 0, prior_period_commits: 0,
  recent_period_commits: 20, flags: { after_hours: false, weekend: false, concurrent_pr_overload: false, activity_cliff: false },
  risk_score: 0, is_bot: false, unlinked_name: false, person_key: `k:${login.toLowerCase()}`, ...o,
});
const workload = (people: WorkloadPerson[], o: Partial<WorkloadInput> = {}): WorkloadInput => ({
  people, partial: false, total_commits_analysed: 100, thresholds: { after_hours_pct: 30, weekend_pct: 25, open_prs: 4, min_sample: 5 },
  workday: DEFAULT_WORKDAY, ...o,
});

function habits(o: Partial<WorkingHabitsResponse> = {}): WorkingHabitsResponse {
  return {
    available: true, thresholds: { maxCommitFiles: 10, maxCommitLines: 200, maxPrCommits: 20 },
    window: { from: "", to: "" }, coverage: { mergedPrs: 7, analysedPrs: 7, complete: true, lastSyncedAt: null },
    people: [], commits: [], prs: [], totals: { commits: 0, oversizedCommits: 0, prs: 0, oversizedPrs: 0 }, ...o,
  };
}

const base = (o: Partial<TeamInsightsInput> = {}): TeamInsightsInput => ({
  contributors: contributors(), grants: { workload: true, habits: true }, showBots: false, repo: "dinhdobathi1992/gitdash", ...o,
});

const ids = (i: ReturnType<typeof buildTeamInsights>) => i.findings.map((f) => f.id);

// ── The TeamV2 design's sample data ──────────────────────────────────────────

function designSample(): TeamInsightsInput {
  const commit = (sha: string, pr: number, files: number, add: number, del: number) => ({
    sha, repo: "dinhdobathi1992/gitdash", prNumber: pr, author: "dinhdobathi1992", person: "dinhdobathi1992", authorLinked: true,
    files, additions: add, deletions: del, committedAt: null, reasons: ["files" as const], url: "", prCommitCount: null,
  });
  return base({
    admin: { links: [], distinct: [] },
    contributors: contributors({
      contributors: [
        crow("dinhdobathi1992", { prs_merged: 30, median_hours_to_merge: 0.8, first_pass_approval_rate: 86, reviewed_prs: 14 }),
        crow("dinhdobathi3", { reviews_given: 14, avg_review_turnaround_hours: 0.4 }),
        crow("github-advanced-security[bot]", { reviews_given: 3, is_bot: true }),
      ],
      prs_merged_total: 30, prs_opened_in_window: 30, median_hours_to_merge: 0.8, prs_human_reviewed: 14, prs_no_human_review: 16,
      bot_reviews: 3,
      review_pairs: [
        { author: "dinhdobathi1992", reviewer: "dinhdobathi3", prs: 14, bot: false, author_bot: false },
        { author: "dinhdobathi1992", reviewer: "github-advanced-security[bot]", prs: 3, bot: true, author_bot: false },
      ],
      coverage: { partial: false, capped: false, fetched_prs: 30, total_prs: 30, truncated_review_prs: 0 },
    }),
    workload: workload([wperson("dinhdobathi1992", {
      after_hours_pct: 41, weekend_pct: 35, open_pr_count: 1, risk_score: 2,
      flags: { after_hours: true, weekend: true, concurrent_pr_overload: false, activity_cliff: false },
    })]),
    habits: habits({
      people: [{ login: "dinhdobathi1992", commits: 20, oversizedCommits: 13, oversizedCommitPct: 65, viaPrAuthor: 0, prs: 7, oversizedPrs: 0, personKey: "k:dinhdobathi1992" }],
      commits: [
        commit("f315f6b", 29, 219, 14473, 8005), commit("db1be54", 29, 65, 3, 10869), commit("d751eb7", 31, 48, 3437, 3758),
        commit("5f198d8", 29, 43, 8572, 0), commit("c8a366a", 34, 36, 2584, 19), commit("3b7b7a7", 29, 15, 2035, 0),
        commit("dbab99f", 29, 18, 1742, 0), commit("01a9a98", 29, 4, 177, 1169), commit("a8922db", 32, 5, 726, 478),
        commit("f4c1434", 31, 6, 164, 379), commit("4498059", 35, 10, 267, 44), commit("9a5be85", 30, 3, 208, 32),
        commit("a07ac95", 31, 21, 0, 0),
      ],
      totals: { commits: 20, oversizedCommits: 13, prs: 7, oversizedPrs: 0 },
    }),
  });
}

describe("design sample (TeamV2)", () => {
  const i = buildTeamInsights(designSample());

  it("What stands out reproduces the design's text, worst first, suggestion last", () => {
    expect(i.findings.map((f) => [f.severity, text(f.title), text(f.detail)])).toEqual([
      ["high", "Every review comes from one person",
        "dinhdobathi3 reviewed 14 of 14 pull requests that got a human review. If they're away, nothing gets reviewed."],
      ["high", "13 of 20 commits are bigger than your limit",
        "6 of them are in gitdash#29, including the largest: 219 files, +14,473 −8,005"],
      ["watch", "41% of commits land after hours", "dinhdobathi1992 · 35% on weekends · outside 08:00–19:00 Asia/Saigon"],
      ["watch", "16 of 30 merged without a human review",
        "Bot reviews and reviews between linked accounts don't count. Nobody else read this code before it merged."],
      ["info", "Are dinhdobathi1992 and dinhdobathi3 the same person?",
        "If they are, every review here is a self-review and the numbers above overstate how much of your code another person checked."],
    ]);
    expect(i.findings.map((f) => f.href)).toEqual(["#reviews", "#habits", "#workload", "#reviews", "#people"]);
  });

  it("KPIs, pairs, people and the bot line", () => {
    expect(i.kpis).toMatchObject({ merged: 30, openedInWindow: 30, humanReviewed: 14, noHumanReview: 16, bus: { people: 1, top: "dinhdobathi3" }, selfMerged: 0 });
    expect(fmtHours(i.kpis.medianHours)).toBe("48m");
    expect(i.pairs.mode).toBe("list");
    expect(i.pairs.rows).toEqual([{ author: "dinhdobathi1992", reviewer: "dinhdobathi3", prs: 14, bot: false, author_bot: false, width: 100 }]);
    expect(i.pairs.footnote).toBe("16 of the 30 merged pull requests got no human review. Bot reviews (3) never count toward the bus factor.");
    expect(i.people.map((p) => [p.login, p.role, p.merged, p.reviews, p.afterHoursPct, p.oversizedPct])).toEqual([
      ["dinhdobathi1992", "Author", 30, null, 41, 65],
      ["dinhdobathi3", "Reviewer", null, 14, null, null],
    ]);
    expect(i.botLine?.text).toBe("1 bot hidden · github-advanced-security[bot] left 3 reviews");
    expect(i.meta).toEqual({ people: 2, prs: 30 });
  });

  it("with bots on: bot rows and pairs shown, still excluded from team numbers", () => {
    const on = buildTeamInsights({ ...designSample(), showBots: true });
    expect(on.people.at(-1)).toMatchObject({ login: "github-advanced-security[bot]", role: "Bot", isBot: true });
    expect(on.pairs.rows.map((r) => r.reviewer)).toEqual(["dinhdobathi3", "github-advanced-security[bot]"]);
    expect(on.kpis).toEqual(i.kpis);
    expect(on.botLine?.text).toBe("Showing 1 bot. Bots never count toward the team numbers.");
  });
});

// ── Each finding at its threshold ────────────────────────────────────────────

describe("findings fire at their threshold and not below", () => {
  const afterHours = (pct: number, flagged = true) => buildTeamInsights(base({
    workload: workload([wperson("amy", { after_hours_pct: pct, flags: { after_hours: flagged, weekend: false, concurrent_pr_overload: false, activity_cliff: false } })]),
  }));
  it("after hours: follows the workload flag; high at 1.5× the threshold", () => {
    expect(ids(afterHours(29, false))).toEqual([]);
    expect(afterHours(30).findings[0]).toMatchObject({ id: "after-hours:amy", severity: "watch" });
    expect(afterHours(44).findings[0].severity).toBe("watch");
    expect(afterHours(45).findings[0].severity).toBe("high");
  });

  const reviews = (reviewed: number, reviewers: [string, number][]) => buildTeamInsights(base({
    contributors: contributors({
      contributors: [crow("amy", { prs_merged: reviewed }), ...reviewers.map(([l, n]) => crow(l, { reviews_given: n }))],
      prs_merged_total: reviewed, prs_human_reviewed: reviewed,
    }),
  }));
  it("single reviewer: bus factor 1 and at least 3 human-reviewed PRs", () => {
    expect(ids(reviews(2, [["bob", 2]]))).toEqual([]);
    expect(text(reviews(3, [["bob", 3]]).findings[0].title)).toBe("Every review comes from one person");
    expect(text(reviews(3, [["bob", 3], ["cy", 1]]).findings[0].title)).toBe("75% of reviews come from one person");
    // Today's 50% rule (reviewBusFactor): two equal reviewers are a bus factor of 1.
    expect(text(reviews(4, [["bob", 2], ["cy", 2]]).findings[0].title)).toBe("50% of reviews come from one person");
    expect(ids(reviews(6, [["bob", 2], ["cy", 2], ["di", 2]]))).toEqual([]);
  });

  const noReview = (merged: number, none: number) => buildTeamInsights(base({
    contributors: contributors({ contributors: [crow("amy", { prs_merged: merged })], prs_merged_total: merged, prs_no_human_review: none, prs_human_reviewed: merged - none }),
  }));
  it("no review: ≥ 50% of ≥ 4 merged; high at 75%", () => {
    expect(ids(noReview(3, 3))).toEqual([]);
    expect(ids(noReview(10, 4))).toEqual([]);
    expect(noReview(10, 5).findings[0]).toMatchObject({ id: "no-review", severity: "watch" });
    expect(noReview(4, 3).findings[0].severity).toBe("high");
  });

  const oversized = (over: number, of: number, o: Partial<WorkingHabitsResponse> = {}) => buildTeamInsights(base({
    habits: habits({ totals: { commits: of, oversizedCommits: over, prs: 1, oversizedPrs: 0 }, ...o }),
  }));
  it("oversized commits: ≥ 40%; high at 60%", () => {
    expect(ids(oversized(3, 10))).toEqual([]);
    expect(oversized(4, 10).findings[0]).toMatchObject({ id: "oversized-commits", severity: "watch" });
    expect(oversized(6, 10).findings[0].severity).toBe("high");
    expect(ids(oversized(4, 10, { untrackedRepo: true }))).toEqual([]);
  });

  it("PRs over the commit limit: one is enough", () => {
    const i = buildTeamInsights(base({
      habits: habits({
        totals: { commits: 1, oversizedCommits: 0, prs: 2, oversizedPrs: 1 },
        prs: [{ repo: "o/gitdash", number: 7, author: "amy", person: "amy", commitCount: 25, mergedAt: "", url: "" }],
      }),
    }));
    expect(i.findings.map((f) => [text(f.title), text(f.detail)])).toEqual([["1 pull request has more than 20 commits", "The largest is gitdash#7 with 25 commits."]]);
    expect(ids(buildTeamInsights(base({ habits: habits({ totals: { commits: 1, oversizedCommits: 0, prs: 2, oversizedPrs: 0 } }) })))).toEqual([]);
  });

  it("self-merge: one is enough, naming who", () => {
    const i = buildTeamInsights(base({
      contributors: contributors({ contributors: [crow("amy", { prs_merged: 3, self_merge_count: 2 })], prs_merged_total: 3, prs_self_merged: 2, prs_human_reviewed: 3 }),
    }));
    expect(i.findings.map((f) => [f.id, text(f.title), text(f.detail)])).toEqual([["self-merge", "2 pull requests merged by their own author", "amy 2"]]);
    expect(ids(buildTeamInsights(base({ contributors: contributors({ prs_merged_total: 3, prs_human_reviewed: 3 }) })))).toEqual([]);
  });

  it("nothing stands out → no findings", () => {
    expect(buildTeamInsights(base()).findings).toEqual([]);
  });
});

// ── Grants, coverage ─────────────────────────────────────────────────────────

describe("grants", () => {
  it("without a grant, its data never shows — findings, columns or CSV headers", () => {
    const s = designSample();
    const i = buildTeamInsights({ ...s, grants: { workload: false, habits: false } });
    expect(i.findings.some((f) => f.href === "#workload" || f.href === "#habits")).toBe(false);
    expect(i.people.every((p) => p.afterHoursPct === null && p.oversizedPct === null)).toBe(true);
    const csv = peopleCsvRows(i.people, { workload: false, habits: false });
    expect(Object.keys(csv[0])).not.toContain("after_hours_pct");
    expect(Object.keys(csv[0])).not.toContain("oversized_commit_pct");
    const full = peopleCsvRows(buildTeamInsights(s).people, { workload: true, habits: true });
    expect(Object.keys(full[0])).toEqual(expect.arrayContaining(["after_hours_pct", "oversized_commit_pct"]));
  });

  it("suggestions only for admins", () => {
    const s = designSample();
    expect(buildTeamInsights({ ...s, admin: null }).suggestions).toEqual([]);
    expect(buildTeamInsights(s).suggestions).toMatchObject([{ primary: "dinhdobathi1992", alias: "dinhdobathi3", prs: 14 }]);
  });
});

describe("partial data", () => {
  it("suppresses ratio findings from the partial source and says so once", () => {
    const s = designSample();
    const i = buildTeamInsights({
      ...s,
      contributors: { ...s.contributors, coverage: { partial: true, capped: false, fetched_prs: 30, total_prs: 80, truncated_review_prs: 0 } },
      workload: { ...s.workload!, partial: true, total_commits_analysed: 2000 },
      habits: { ...s.habits!, coverage: { mergedPrs: 7, analysedPrs: 5, complete: false, lastSyncedAt: null } },
    });
    expect(ids(i)).toEqual(["identity:dinhdobathi1992+dinhdobathi3"]);
    expect(i.coverage).toBe(
      "Based on 30 of 80 pull requests · workload counts the latest 2,000 commits only · working habits analysed 5 of 7 merged pull requests so far — some data could not be loaded, so findings that depend on it are left out.",
    );
    expect(buildTeamInsights(s).coverage).toBeNull();
  });
});

// ── Pairs, people, suggestions ───────────────────────────────────────────────

describe("capped and truncated contributors", () => {
  it("the page cap suppresses ratio findings like partial data; truncated reviews are only a note", () => {
    const s = designSample();
    const capped = buildTeamInsights({ ...s, contributors: { ...s.contributors, coverage: { ...s.contributors.coverage, capped: true, total_prs: 900 } } });
    expect(ids(capped)).not.toContain("single-reviewer");
    expect(capped.coverage).toMatch(/^Based on the latest 30 of 900 pull requests/);
    const trunc = buildTeamInsights({ ...s, contributors: { ...s.contributors, coverage: { ...s.contributors.coverage, truncated_review_prs: 2 } } });
    expect(ids(trunc)).toContain("single-reviewer");
    expect(trunc.coverage).toBe("2 pull requests had more than 100 reviews; the first 100 were counted.");
  });
});

describe("pairs", () => {
  it("pairs on bot-authored PRs are hidden with bots off and never count toward the heatmap", () => {
    const pairs = [
      { author: "dependabot[bot]", reviewer: "b", prs: 5, bot: false, author_bot: true },
      ...["b", "c", "d"].map((r) => ({ author: "a", reviewer: r, prs: 1, bot: false, author_bot: false })),
      { author: "dependabot[bot]", reviewer: "e", prs: 1, bot: false, author_bot: true },
    ];
    const off = buildTeamInsights(base({ contributors: contributors({ review_pairs: pairs }) }));
    expect(off.pairs.rows.map((r) => r.author)).toEqual(["a", "a", "a"]);
    expect(off.pairs.mode).toBe("list");
    const on = buildTeamInsights(base({ showBots: true, contributors: contributors({ review_pairs: pairs }) }));
    expect(on.pairs.rows).toHaveLength(5);
  });

  it("heatmap from 4 human reviewers; heatmap and list show the same numbers", () => {
    const pairs = ["b", "c", "d", "e"].map((r, n) => ({ author: "a", reviewer: r, prs: n + 1, bot: false, author_bot: false }));
    const i = buildTeamInsights(base({ contributors: contributors({ review_pairs: [...pairs, { author: "a", reviewer: "x[bot]", prs: 9, bot: true, author_bot: false }] }) }));
    expect(i.pairs.mode).toBe("heatmap");
    expect(i.pairs.cells).toEqual(pairsToCells(i.pairs.rows));
    expect(i.pairs.cells.reduce((s, c) => s + c.count, 0)).toBe(i.pairs.rows.reduce((s, r) => s + r.prs, 0));
    expect(i.pairs.rows.some((r) => r.bot)).toBe(false);
    const three = buildTeamInsights(base({ contributors: contributors({ review_pairs: pairs.slice(0, 3) }) }));
    expect(three.pairs.mode).toBe("list");
  });
});

describe("people", () => {
  it("joins sources on the person key, even when each shows a different linked login; git author names stay apart", () => {
    const i = buildTeamInsights(base({
      contributors: contributors({ contributors: [crow("amy", { prs_merged: 2, reviews_given: 1, person_key: "P1" })] }),
      workload: workload([wperson("amy-work", { after_hours_pct: 12, person_key: "P1" }), wperson("Amy Laptop", { unlinked_name: true, after_hours_pct: 50 })]),
      habits: habits({ people: [{ login: "amy-work", commits: 4, oversizedCommits: 1, oversizedCommitPct: 25, viaPrAuthor: 0, prs: 1, oversizedPrs: 0, personKey: "P1" }] }),
    }));
    // Each source shows a single, different login for the linked person; the shared key joins them.
    expect(i.people.map((p) => [p.login, p.role, p.linkedLogins, p.afterHoursPct, p.oversizedPct, p.unlinkedName])).toEqual([
      ["amy", "Author · Reviewer", ["amy", "amy-work"], 12, 25, false],
      ["Amy Laptop", "Committer", null, 50, null, true],
    ]);
  });
});

describe("suggestions", () => {
  const withPair = (a: string, b: string, admin = { links: [] as { alias_login: string; primary_login: string }[], distinct: [] as { login_a: string; login_b: string }[] }) =>
    buildTeamInsights(base({
      admin,
      contributors: contributors({ contributors: [crow(a, { prs_merged: 5 }), crow(b, { reviews_given: 5 })], review_pairs: [{ author: a, reviewer: b, prs: 5, bot: false, author_bot: false }], prs_human_reviewed: 5 }),
    })).suggestions;

  it("stem rule: same letters without digits, - and _, at least 5 chars", () => {
    expect(loginStem("dinh_do-ba-thi92")).toBe("dinhdobathi");
    expect(withPair("dinhdobathi1992", "dinhdobathi3")).toHaveLength(1);
    expect(withPair("anna1", "anna2")).toEqual([]); // stem "anna" < 5
    expect(withPair("alice", "bob-alice")).toEqual([]);
  });

  it("never for a linked or dismissed pair", () => {
    expect(withPair("dinhdobathi1992", "dinhdobathi3", { links: [{ alias_login: "dinhdobathi3", primary_login: "dinhdobathi1992" }], distinct: [] })).toEqual([]);
    expect(withPair("dinhdobathi1992", "dinhdobathi3", { links: [], distinct: [{ login_a: "dinhdobathi1992", login_b: "dinhdobathi3" }] })).toEqual([]);
  });

  it("needs a review between the two in the window", () => {
    const s = buildTeamInsights(base({
      admin: { links: [], distinct: [] },
      contributors: contributors({ contributors: [crow("dinhdobathi1992", { prs_merged: 3 }), crow("dinhdobathi3", { prs_merged: 1 })] }),
    }));
    expect(s.suggestions).toEqual([]);
  });
});

describe("performance", () => {
  it("200 people in well under 5 ms", () => {
    const rows = Array.from({ length: 200 }, (_, n) => crow(`user${n}x`, { prs_merged: n % 7, reviews_given: n % 5 }));
    const pairs = rows.slice(1).map((r, n) => ({ author: rows[n].login, reviewer: r.login, prs: 1 + (n % 3), bot: false, author_bot: false }));
    const input = base({ admin: { links: [], distinct: [] }, contributors: contributors({ contributors: rows, review_pairs: pairs, prs_merged_total: 600, prs_human_reviewed: 300 }) });
    buildTeamInsights(input);
    const t = performance.now();
    for (let k = 0; k < 10; k++) buildTeamInsights(input);
    expect((performance.now() - t) / 10).toBeLessThan(5);
  });
});

it("FINDING_RULES stay in one place", () => {
  expect(FINDING_RULES.noReviewShare).toBe(0.5);
});
