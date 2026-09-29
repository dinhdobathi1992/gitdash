import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { PGlite } from "@electric-sql/pglite";
import { __setDbClientForTests, ensureSchema, getWorkingHabitsRows, upsertPrFacts, upsertPrCommitFacts, markPrCommitsSynced } from "@/lib/db";
import {
  aggregateWorkingHabits, formatWorkingHabitsDigestLine, isBot, isOversizedCommit, type WhCommitRow, type WhPrRow,
} from "@/lib/working-habits";
import { DEFAULT_THRESHOLDS as T } from "@/lib/working-habits-settings";
import { createPgliteClient } from "./setup/pglite";
import { makeCanonical } from "@/lib/identity-links";

const WINDOW = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") };
const pr = (n: number, author: string | null, o: Partial<WhPrRow> = {}): WhPrRow => ({
  repo: "acme/api", pr_number: n, author, merged_at: "2026-09-10T00:00:00.000Z", commit_count: 3,
  commits_synced_at: "2026-09-11T04:47:00.000Z", ...o,
});
let seq = 0;
const c = (author: string | null, o: Partial<WhCommitRow> = {}): WhCommitRow => ({
  repo: "acme/api", sha: `sha${++seq}`, pr_number: 1, author, author_linked: true, files: 1,
  additions: 1, deletions: 1, committed_at: null, ...o,
});
const agg = (prs: WhPrRow[], commits: WhCommitRow[], login?: string) =>
  aggregateWorkingHabits({ prs, commits, thresholds: T, window: WINDOW, logins: login ? [login] : null });

describe("isOversizedCommit", () => {
  it("exactly at the limits is fine; one over is not", () => {
    expect(isOversizedCommit({ files: 10, additions: 150, deletions: 50 }, T)).toEqual([]);
    expect(isOversizedCommit({ files: 11, additions: 1, deletions: 0 }, T)).toEqual(["files"]);
    expect(isOversizedCommit({ files: 1, additions: 200, deletions: 1 }, T)).toEqual(["lines"]);
    expect(isOversizedCommit({ files: 11, additions: 201, deletions: 0 }, T)).toEqual(["files", "lines"]);
  });

  it("unknown file count → lines decide alone", () => {
    expect(isOversizedCommit({ files: null, additions: 100, deletions: 100 }, T)).toEqual([]);
    expect(isOversizedCommit({ files: null, additions: 5000, deletions: 0 }, T)).toEqual(["lines"]);
  });
});

describe("isBot", () => {
  it.each(["dependabot[bot]", "renovate", "github-actions", "Dependabot", "my-app[bot]"])("%s is a bot", (l) => expect(isBot(l)).toBe(true));
  it.each(["alice", "botanist", null])("%s is not", (l) => expect(isBot(l)).toBe(false));
});

describe("aggregateWorkingHabits", () => {
  it("counts per person, excludes bots, sorts by oversized share", () => {
    const r = agg(
      [pr(1, "alice"), pr(2, "bob", { commit_count: 21 }), pr(3, "dependabot[bot]", { commit_count: 50 })],
      [
        c("alice"), c("alice", { files: 30 }), c("alice", { additions: 500 }), c("alice"),
        c("bob"), c("bob"),
        c("renovate[bot]", { additions: 9999 }),
      ],
    );
    expect(r.people.map((p) => [p.login, p.commits, p.oversizedCommits, p.oversizedCommitPct, p.prs, p.oversizedPrs])).toEqual([
      ["alice", 4, 2, 50, 1, 0],
      ["bob", 2, 0, 0, 1, 1],
    ]);
    expect(r.totals).toEqual({ commits: 6, oversizedCommits: 2, prs: 2, oversizedPrs: 1 });
    expect(r.commits.map((x) => x.additions)).toEqual([500, 1]); // largest first
    expect(r.commits[0]).toMatchObject({ reasons: ["lines"], url: expect.stringMatching(/^https:\/\/github\.com\/acme\/api\/commit\/sha\d+$/) });
    expect(r.prs).toEqual([expect.objectContaining({ number: 2, commitCount: 21, url: "https://github.com/acme/api/pull/2" })]);
  });

  it("exactly maxPrCommits is not oversized; unknown commit_count never is", () => {
    const r = agg([pr(1, "a", { commit_count: 20 }), pr(2, "a", { commit_count: null })], []);
    expect(r.totals).toMatchObject({ prs: 2, oversizedPrs: 0 });
  });

  it("counts commits credited via the PR author", () => {
    const r = agg([pr(1, "alice")], [c("alice", { author_linked: false }), c("alice")]);
    expect(r.people[0].viaPrAuthor).toBe(1);
    expect(r.commits).toEqual([]);
  });

  it("coverage covers every merged PR in scope, even with a login filter", () => {
    const r = agg([pr(1, "alice"), pr(2, "bob", { commits_synced_at: null })], [c("alice"), c("bob")], "ALICE");
    expect(r.coverage).toEqual({ mergedPrs: 2, analysedPrs: 1, complete: false, lastSyncedAt: "2026-09-11T04:47:00.000Z" });
    expect(r.people.map((p) => p.login)).toEqual(["alice"]);
    expect(r.totals).toMatchObject({ commits: 1, prs: 1 });
  });

  it("empty input is a complete, empty window", () => {
    const r = agg([], []);
    expect(r.coverage).toEqual({ mergedPrs: 0, analysedPrs: 0, complete: true, lastSyncedAt: null });
    expect(r.people).toEqual([]);
  });

  it("uses the thresholds it is given", () => {
    const r = aggregateWorkingHabits({
      prs: [pr(1, "a")], commits: [c("a", { files: 3 })],
      thresholds: { maxCommitFiles: 2, maxCommitLines: 200, maxPrCommits: 2 }, window: WINDOW,
    });
    expect(r.totals).toMatchObject({ oversizedCommits: 1, oversizedPrs: 1 });
  });
});

describe("aggregateWorkingHabits with account links", () => {
  const canonical = makeCanonical([{ alias_login: "alice-work", primary_login: "alice" }]);

  it("merges linked logins into one person shown by their most active login", () => {
    const r = aggregateWorkingHabits({
      prs: [pr(1, "alice"), pr(2, "Alice-Work", { commit_count: 30 })],
      commits: [c("alice"), c("Alice-Work", { files: 40 }), c("Alice-Work"), c("Alice-Work")],
      thresholds: T, window: WINDOW, canonical,
    });
    expect(r.people).toHaveLength(1);
    expect(r.people[0]).toMatchObject({ login: "Alice-Work", linkedLogins: ["alice", "Alice-Work"], commits: 4, oversizedCommits: 1, prs: 2, oversizedPrs: 1 });
    expect(r.commits[0]).toMatchObject({ author: "Alice-Work", person: "Alice-Work" });
    expect(r.prs[0]).toMatchObject({ author: "Alice-Work", person: "Alice-Work" });
  });

  it("without links every login is its own person", () => {
    const r = agg([pr(1, "alice"), pr(2, "alice-work")], [c("alice"), c("alice-work")]);
    expect(r.people.map((p) => p.login).sort()).toEqual(["alice", "alice-work"]);
    expect(r.people.every((p) => p.linkedLogins === undefined)).toBe(true);
  });

  it("logins narrow to one person's logins", () => {
    const r = aggregateWorkingHabits({
      prs: [pr(1, "alice"), pr(2, "alice-work"), pr(3, "bob")], commits: [c("alice"), c("alice-work"), c("bob")],
      thresholds: T, window: WINDOW, canonical, logins: ["alice", "alice-work"],
    });
    expect(r.people).toHaveLength(1);
    expect(r.totals).toMatchObject({ commits: 2, prs: 2 });
  });
});

describe("formatWorkingHabitsDigestLine", () => {
  it("totals only — no logins", () => {
    const r = agg([pr(1, "alice", { commit_count: 25 }), pr(2, "bob", { commits_synced_at: null })],
      [c("alice", { additions: 900 }), c("alice"), c("bob"), c("bob")]);
    const line = formatWorkingHabitsDigestLine(r, new Date("2026-09-28T04:47:00Z"))!;
    expect(line).toBe(
      "Working habits (7 days to Mon 2026-09-28 04:47 UTC): 25% of 4 commits were over the size limit; " +
      "1 pull request had more than 20 commits; 1 of 2 merged pull requests analysed. Details in Team insights.",
    );
    expect(line).not.toMatch(/alice|bob/);
  });

  it("links to Team insights when the app URL is known", () => {
    const r = agg([pr(1, "alice")], [c("alice")]);
    expect(formatWorkingHabitsDigestLine(r, new Date(), "https://gitdash.example.com/")).toMatch(/Details: https:\/\/gitdash\.example\.com\/team$/);
  });

  it("null without data", () => {
    expect(formatWorkingHabitsDigestLine(agg([], []), new Date())).toBeNull();
  });
});

describe("getWorkingHabitsRows (SQL)", () => {
  let pg: PGlite;
  beforeEach(async () => {
    pg = new PGlite();
    __setDbClientForTests(createPgliteClient(pg));
    await ensureSchema();
  });
  afterEach(() => __setDbClientForTests(null));

  it("returns merged PRs in the window and their non-merge commits, filtered by login", async () => {
    const base = { author: "alice", created_at: "2026-08-01T00:00:00Z", closed_at: null, first_review_at: null, approved_at: null,
      additions: 1, deletions: 1, review_count: 0, state: "closed", commit_count: 2, changed_files: 1 };
    await upsertPrFacts([
      { ...base, repo: "acme/api", pr_number: 1, merged_at: "2026-09-10T00:00:00Z" },
      { ...base, repo: "acme/api", pr_number: 2, merged_at: "2026-08-10T00:00:00Z" }, // before window
      { ...base, repo: "acme/web", pr_number: 1, merged_at: "2026-09-12T00:00:00Z" },
      { ...base, repo: "other/x", pr_number: 1, merged_at: "2026-09-12T00:00:00Z" },
      { ...base, repo: "acme/api", pr_number: 3, merged_at: null, state: "open" },
    ]);
    const row = (repo: string, sha: string, pr_number: number, author: string, is_merge = false) => ({
      repo, sha, pr_number, author, author_linked: true, files: 1, additions: 1, deletions: 1, is_merge, committed_at: "2026-09-09T00:00:00Z",
    });
    await upsertPrCommitFacts([
      row("acme/api", "a", 1, "Alice"), row("acme/api", "m", 1, "alice", true), row("acme/api", "b", 1, "bob"),
      row("acme/api", "old", 2, "alice"), row("acme/web", "w", 1, "alice"), row("other/x", "x", 1, "alice"),
    ]);
    await markPrCommitsSynced("acme/api", [{ pr_number: 1, total_count: 3 }]);

    const all = await getWorkingHabitsRows(["acme/api", "acme/web"], WINDOW.from, WINDOW.to);
    expect(all.prs.map((p) => `${p.repo}#${p.pr_number}`).sort()).toEqual(["acme/api#1", "acme/web#1"]);
    expect(all.commits.map((x) => x.sha).sort()).toEqual(["a", "b", "w"]);
    expect(all.prs.find((p) => p.repo === "acme/api")?.commits_synced_at).toMatch(/^\d{4}-\d\d-\d\dT/);

    const alice = await getWorkingHabitsRows(["acme/api"], WINDOW.from, WINDOW.to, ["ALICE"]);
    expect(alice.commits.map((x) => x.sha)).toEqual(["a"]);
    expect(alice.prs).toHaveLength(1);
    const both = await getWorkingHabitsRows(["acme/api"], WINDOW.from, WINDOW.to, ["alice", "BOB"]);
    expect(both.commits.map((x) => x.sha).sort()).toEqual(["a", "b"]);

    expect(await getWorkingHabitsRows([], WINDOW.from, WINDOW.to)).toEqual({ prs: [], commits: [] });
  });
});

// ── Route ────────────────────────────────────────────────────────────────────

const access = { isAdmin: false, flags: [] as string[], groups: ["dev"], githubId: 1 };
const computeWorkingHabits = vi.fn();
vi.mock("@/lib/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/session")>()),
  getTokenFromSession: async () => sessionToken,
}));
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  resolveIdentity: async () => ({ identity: { id: 1, login: "Alice" }, allowed: true }),
  resolveAccess: async () => access,
}));
vi.mock("@/lib/repo-access", () => ({
  canSeeRepo: async (_t: string, _o: string, repo: string) => repo !== "hidden",
  canSeeOwner: async (_t: string, o: string) => o === "acme" || o === "emptyco",
}));
vi.mock("@/lib/working-habits", async (orig) => ({
  ...(await orig<typeof import("@/lib/working-habits")>()),
  computeWorkingHabits: (...a: unknown[]) => computeWorkingHabits(...a),
}));
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  listSyncedRepos: async () => [{ repo: "acme/api", last_synced_at: null }, { repo: "acme/web", last_synced_at: null }, { repo: "acme/hidden", last_synced_at: null }, { repo: "zeta/x", last_synced_at: null }],
}));
let storedLinks: { alias_login: string; primary_login: string }[] = [];
vi.mock("@/lib/identity-links", async (orig) => {
  const real = await orig<typeof import("@/lib/identity-links")>();
  return { ...real, loadCanonical: async () => ({ canonical: real.makeCanonical(storedLinks), links: storedLinks }) };
});
vi.mock("@/lib/working-habits-settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/working-habits-settings")>()),
  getThresholds: async () => T,
}));

let sessionToken: string | null = "tok";
const env = { MODE: process.env.MODE, DATABASE_URL: process.env.DATABASE_URL };

async function call(qs: string) {
  const { GET } = await import("@/app/api/db/working-habits/route");
  const res = await GET(new NextRequest(`http://localhost/api/db/working-habits?${qs}`));
  return { status: res.status, body: await res.json() };
}

describe("GET /api/db/working-habits", () => {
  beforeEach(() => {
    sessionToken = "tok";
    access.isAdmin = false;
    access.flags = [];
    process.env.MODE = "organization";
    process.env.DATABASE_URL = "postgres://x";
    computeWorkingHabits.mockReset().mockImplementation(async (o) => ({ ...agg([], []), _args: o }));
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("401 without a session", async () => {
    sessionToken = null;
    expect((await call("owner=acme")).status).toBe(401);
  });

  it("400 on bad params", async () => {
    expect((await call("owner=acme&days=7")).status).toBe(400);
    expect((await call("owner=acme&login=bad$login")).status).toBe(400);
    expect((await call("owner=bad$")).status).toBe(400);
  });

  it("without the grant: 403 for the team view or someone else's login", async () => {
    expect((await call("owner=acme&repo=api")).status).toBe(403);
    expect((await call("owner=acme&login=bob")).status).toBe(403);
    expect(computeWorkingHabits).not.toHaveBeenCalled();
  });

  it("without the grant: own numbers only, forced to the viewer's login", async () => {
    const { status, body } = await call("owner=acme&login=alice&days=90");
    expect(status).toBe(200);
    expect(body._args).toMatchObject({ repos: ["acme/api", "acme/web"], logins: ["Alice"] });
    const span = new Date(body._args.to).getTime() - new Date(body._args.from).getTime();
    expect(span).toBe(90 * 86_400_000);
  });

  it("with the grant or as admin: whole team", async () => {
    access.flags = ["workingHabits"];
    expect((await call("owner=acme&repo=api")).body._args).toMatchObject({ repos: ["acme/api"], logins: null });
    access.flags = [];
    access.isAdmin = true;
    expect((await call("owner=acme")).status).toBe(200);
  });

  it("granted views merge linked logins; a profile view reads the person's aliases too", async () => {
    storedLinks = [{ alias_login: "alice-work", primary_login: "alice" }];
    access.flags = ["workingHabits"];
    await call("owner=acme&repo=api");
    const team = computeWorkingHabits.mock.calls.at(-1)![0];
    expect(team.logins).toBeNull();
    expect(team.canonical("Alice-Work")).toBe("alice");
    expect((await call("owner=acme&login=alice")).body._args.logins).toEqual(["alice", "alice-work"]);
    storedLinks = [];
  });

  it("self-view never includes aliases, even when links exist", async () => {
    storedLinks = [{ alias_login: "alice-work", primary_login: "alice" }, { alias_login: "alice", primary_login: "mallory" }];
    await call("owner=acme&login=alice");
    const args = computeWorkingHabits.mock.calls.at(-1)![0];
    expect(args.logins).toEqual(["Alice"]);
    expect(args.canonical("alice-work")).toBe("alice-work");
    storedLinks = [];
  });

  it("owner scope leaves out tracked repos the viewer's token cannot open", async () => {
    access.isAdmin = true;
    expect((await call("owner=acme")).body._args.repos).toEqual(["acme/api", "acme/web"]);
  });

  it("standalone mode sees everything", async () => {
    process.env.MODE = "standalone";
    expect((await call("owner=acme&repo=API")).body._args).toMatchObject({ repos: ["acme/api"] });
  });

  it("404 for a repo or owner the viewer cannot see", async () => {
    access.isAdmin = true;
    expect((await call("owner=acme&repo=hidden")).status).toBe(404);
    expect((await call("owner=zeta")).status).toBe(404);
  });

  it("an untracked repo says so", async () => {
    access.isAdmin = true;
    const { body } = await call("owner=acme&repo=nosync");
    expect(body).toMatchObject({ available: true, untrackedRepo: true, people: [] });
    expect(computeWorkingHabits).not.toHaveBeenCalled();
  });

  it("owner scope with no synced repos says so", async () => {
    access.isAdmin = true;
    const { status, body } = await call("owner=emptyco");
    expect(status).toBe(200);
    expect(body).toMatchObject({ available: true, noTrackedRepos: true, people: [] });
    expect(computeWorkingHabits).not.toHaveBeenCalled();
  });

  it("available:false without a database", async () => {
    access.isAdmin = true;
    delete process.env.DATABASE_URL;
    expect((await call("owner=acme")).body).toMatchObject({ available: false });
  });
});
