import { describe, it, expect } from "vitest";
import {
  accumulateCommits, buildWorkloadCounters, computeWorkloadPeople, countCommitsByAuthor, countOpenPrsByAuthor,
  type RawCommitForWorkload,
} from "@/lib/team-workload-core";
import { computeWorkload } from "@/lib/team-workload";
import { noLinks, personKey } from "@/lib/identity-links";
import { LEGACY_UTC_WORKDAY } from "@/lib/team-settings";

const NOW = Date.parse("2026-09-30T12:00:00Z"); // Wednesday
const DAY = 86_400_000;

function commit(login: string | null, iso: string, opts: { name?: string; type?: string } = {}): RawCommitForWorkload {
  return {
    author: login ? { login, avatar_url: `https://example.com/${login}`, ...(opts.type ? { type: opts.type } : {}) } : null,
    commit: { author: { name: opts.name ?? login ?? "unknown", date: iso }, committer: { date: iso } },
  };
}

describe("countCommitsByAuthor", () => {
  it("counts after-hours, weekend, recent and prior per author in the workday zone (UTC 09–18)", () => {
    const commits = [
      commit("ana", "2026-09-29T20:00:00Z"), // Tue, after hours, recent
      commit("ana", "2026-09-29T10:00:00Z"), // Tue, in hours, recent
      commit("ana", "2026-09-27T10:00:00Z"), // Sun, weekend, recent
      commit("ana", new Date(NOW - 20 * DAY).toISOString()), // prior
      commit(null, "2026-09-29T10:00:00Z", { name: "Build Laptop" }),
      commit("dependabot[bot]", "2026-09-29T10:00:00Z", { type: "Bot" }),
      { author: null, commit: { author: { name: "no date" }, committer: null } }, // skipped
    ];
    const rows = countCommitsByAuthor(commits, { workday: LEGACY_UTC_WORKDAY, now: NOW });
    const ana = rows.find((r) => r.login === "ana")!;
    expect(ana).toMatchObject({ total: 4, afterHours: 1, weekend: 1, recent: 3, prior: 1, unlinked_name: false, is_bot: false });
    expect(rows.find((r) => r.login === "Build Laptop")).toMatchObject({ unlinked_name: true, total: 1 });
    expect(rows.find((r) => r.login === "dependabot[bot]")?.is_bot).toBe(true);
    expect(rows).toHaveLength(3);
  });
});

describe("accumulateCommits", () => {
  it("folding page by page equals counting all commits at once", () => {
    const all = Array.from({ length: 30 }, (_, i) => commit(i % 3 ? "ana" : "bo", new Date(NOW - i * 0.7 * DAY).toISOString()));
    const acc = new Map();
    accumulateCommits(acc, all.slice(0, 10), { workday: LEGACY_UTC_WORKDAY, now: NOW });
    accumulateCommits(acc, all.slice(10), { workday: LEGACY_UTC_WORKDAY, now: NOW });
    expect([...acc.values()]).toEqual(countCommitsByAuthor(all, { workday: LEGACY_UTC_WORKDAY, now: NOW }));
  });
});

describe("countOpenPrsByAuthor", () => {
  it("counts per login and skips PRs without a user", () => {
    expect(countOpenPrsByAuthor([{ user: { login: "a" } }, { user: { login: "a" } }, { user: null }, { user: { login: "b" } }])).toEqual({ a: 2, b: 1 });
  });
});

describe("buildWorkloadCounters", () => {
  it("assembles counters with total commits and window metadata", () => {
    const authors = countCommitsByAuthor([commit("ana", "2026-09-29T10:00:00Z"), commit("bo", "2026-09-29T10:00:00Z")], { workday: LEGACY_UTC_WORKDAY, now: NOW });
    const c = buildWorkloadCounters(authors, { bo: 1 }, { windowDays: 42, partial: true });
    expect(c).toMatchObject({ total_commits: 2, open_prs: { bo: 1 }, partial: true, window_days: 42 });
    expect(c.authors).toHaveLength(2);
  });
});

describe("computeWorkloadPeople", () => {
  const counters = buildWorkloadCounters(
    countCommitsByAuthor([
      ...Array.from({ length: 6 }, (_, i) => commit("ana", new Date(Date.parse("2026-09-29T20:00:00Z") - i * DAY).toISOString())),
      ...Array.from({ length: 4 }, (_, i) => commit("cy", new Date(NOW - (20 + i) * DAY).toISOString())),
    ], { workday: LEGACY_UTC_WORKDAY, now: NOW }),
    { bo: 4 },
    { windowDays: 42, partial: false },
  );

  it("flags after-hours, weekend and activity cliff, sorted by risk", () => {
    const people = computeWorkloadPeople(counters, noLinks, { personKey: (k) => `key:${k}` });
    expect(people[0].login).toBe("ana");
    expect(people[0].flags.after_hours).toBe(true);
    expect(people.find((p) => p.login === "cy")?.flags.activity_cliff).toBe(true);
    expect(people.find((p) => p.login === "ana")?.person_key).toBe("key:ana");
  });

  it("cliff: false disables the activity-cliff flag", () => {
    const people = computeWorkloadPeople(counters, noLinks, { cliff: false, personKey: (k) => k });
    expect(people.find((p) => p.login === "cy")?.flags.activity_cliff).toBe(false);
  });

  it("computeWorkload is computeWorkloadPeople with the production person key", () => {
    expect(computeWorkload(counters, noLinks)).toEqual(computeWorkloadPeople(counters, noLinks, { personKey }));
  });
});
