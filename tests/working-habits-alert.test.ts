import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { createPgliteClient } from "./setup/pglite";

const dispatchAlert = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/notifier", async (orig) => ({
  ...(await orig<typeof import("@/lib/notifier")>()),
  dispatchAlert: (...a: unknown[]) => dispatchAlert(...(a as [])),
}));

import {
  __setDbClientForTests, ensureSchema, evaluateAlertRulesForRepo, createAlertRule, updateSyncCursor,
  updatePrSyncCursor, upsertPrFacts, upsertPrCommitFacts, markPrCommitsSynced,
} from "@/lib/db";

const REPO = "acme/api";
let pg: PGlite;

async function seed(opts: { commits: number; oversized: number; synced?: boolean; backfill?: boolean }) {
  await updateSyncCursor(REPO, 1);
  await updatePrSyncCursor(REPO, null, opts.backfill ?? true);
  const merged = new Date(Date.now() - 3_600_000).toISOString();
  await upsertPrFacts([{
    repo: REPO, pr_number: 1, author: "alice", created_at: merged, merged_at: merged, closed_at: merged,
    first_review_at: null, approved_at: null, additions: 1, deletions: 1, review_count: 0, state: "closed",
    commit_count: opts.commits, changed_files: 1,
  }]);
  await upsertPrCommitFacts(Array.from({ length: opts.commits }, (_, i) => ({
    repo: REPO, sha: `s${i}`, pr_number: 1, author: "alice", author_linked: true,
    files: i < opts.oversized ? 50 : 1, additions: 1, deletions: 1, is_merge: false, committed_at: null,
  })));
  if (opts.synced ?? true) await markPrCommitsSynced(REPO, [{ pr_number: 1, total_count: opts.commits }]);
}

const rule = (metric: string, threshold: number) =>
  createAlertRule({ scope: `repo:${REPO}`, metric, threshold, window_hours: 24, channel: "browser", destination: null, enabled: true });

async function firedEvents() {
  return (await pg.query<{ metric: string; value: number; sample_size: number }>(
    `SELECT metric, value::float AS value, sample_size FROM alert_events ORDER BY id`)).rows;
}

beforeEach(async () => {
  pg = new PGlite();
  __setDbClientForTests(createPgliteClient(pg));
  await ensureSchema();
  dispatchAlert.mockClear();
});
afterEach(() => __setDbClientForTests(null));

describe("oversized_commit_pct evaluation", () => {
  it("fires at the threshold with the shared calculation's share", async () => {
    await seed({ commits: 10, oversized: 4 });
    await rule("oversized_commit_pct", 40);
    expect(await evaluateAlertRulesForRepo(REPO, { only: ["oversized_commit_pct"] })).toBe(1);
    expect(await firedEvents()).toEqual([{ metric: "oversized_commit_pct", value: 40, sample_size: 10 }]);
    expect(dispatchAlert).toHaveBeenCalledOnce();
  });

  it("stays quiet below the threshold", async () => {
    await seed({ commits: 10, oversized: 3 });
    await rule("oversized_commit_pct", 40);
    expect(await evaluateAlertRulesForRepo(REPO, { only: ["oversized_commit_pct"] })).toBe(0);
  });

  it("skips with fewer than 5 commits", async () => {
    await seed({ commits: 4, oversized: 4 });
    await rule("oversized_commit_pct", 1);
    expect(await evaluateAlertRulesForRepo(REPO, { only: ["oversized_commit_pct"] })).toBe(0);
  });

  it("skips while the window is not fully analysed", async () => {
    await seed({ commits: 10, oversized: 10, synced: false });
    await rule("oversized_commit_pct", 1);
    expect(await evaluateAlertRulesForRepo(REPO, { only: ["oversized_commit_pct"] })).toBe(0);
  });

  it("skips while the PR backfill is incomplete", async () => {
    await seed({ commits: 10, oversized: 10, backfill: false });
    await rule("oversized_commit_pct", 1);
    expect(await evaluateAlertRulesForRepo(REPO, { only: ["oversized_commit_pct"] })).toBe(0);
  });

  it("the default call (03:17 run sync) skips it; `only` runs just it", async () => {
    await seed({ commits: 10, oversized: 10 });
    await rule("oversized_commit_pct", 1);
    await rule("success_streak", 0);
    expect(await evaluateAlertRulesForRepo(REPO)).toBe(1);
    expect((await firedEvents()).map((e) => e.metric)).toEqual(["success_streak"]);
    expect(await evaluateAlertRulesForRepo(REPO, { only: ["oversized_commit_pct"] })).toBe(1);
    expect((await firedEvents()).map((e) => e.metric)).toEqual(["success_streak", "oversized_commit_pct"]);
  });
});

describe("GET /api/cron/sync-commit-facts", () => {
  const env = { CRON_SECRET: process.env.CRON_SECRET, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
  afterEach(() => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const call = async (auth?: string) => {
    const { GET } = await import("@/app/api/cron/sync-commit-facts/route");
    return GET(new NextRequest("http://localhost/api/cron/sync-commit-facts", auth ? { headers: { authorization: auth } } : undefined));
  };

  it("401 without the cron bearer, or when CRON_SECRET is unset", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call("Bearer undefined")).status).toBe(401);
  });

  it("500 when GITHUB_TOKEN is missing", async () => {
    process.env.CRON_SECRET = "s3cret";
    delete process.env.GITHUB_TOKEN;
    expect((await call("Bearer s3cret")).status).toBe(500);
  });

  it("runs with nothing tracked", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.GITHUB_TOKEN = "ghp_test";
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ repos_synced: 0, repos_failed: 0, total_prs_synced: 0 });
  });
});
