# GitDash Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four low-risk, high-value improvements: deduplicate percentile math, deduplicate repo-summary/run-timing logic, make the Weekly Leadership Digest resilient to missed/repeated cron runs, rate-limit expensive fan-out endpoints, and add a Helm CronJob so scheduled sync works off Vercel.

**Architecture:** All new logic is pure functions in `src/lib` (unit-testable with the existing vitest setup), DB state added through the existing versioned-migration mechanism in `src/lib/db.ts`, and the Helm chart gains one optional template. No API contract changes, no UI changes.

**Tech Stack:** Next.js 16 route handlers, TypeScript strict, vitest (tests in `tests/**`, alias `@` → `src`), Helm 3.

---

## Context for the implementer

- Repo: `/Users/thi/Devops/gitdash`. Package manager is **pnpm** (`corepack enable pnpm`), pinned via `packageManager` in `package.json`.
- Commands: `pnpm run lint`, `pnpm exec tsc --noEmit`, `pnpm test` (vitest run). Tests live in `tests/*.test.ts` and import via `@/lib/...`.
- Commit style (see `git log --oneline`): Conventional Commits, e.g. `feat:`, `fix:`, `refactor:` with a short imperative summary.
- There is no TODO/FIXME culture here — write header comments in the style of the surrounding files (block comment explaining *why*).
- Every task ends with lint + typecheck + tests green, then one commit.

---

### Task 1: Shared percentile helpers (`src/lib/math.ts`)

**Why:** `percentile()` is implemented 6 times with two different algorithms — linear interpolation (`src/lib/optimization.ts:28`, `src/lib/queue-analysis.ts:50`, `src/lib/dora.ts:157`, `src/app/api/github/open-pr-health/route.ts:65`) and ceil-index (`src/lib/github.ts:633`, `src/app/api/github/runner-stats/route.ts:38`). Unify on the interpolation variant (majority, and statistically standard). This changes the ceil-index call sites slightly (sub-one-rank differences on small samples) — that is intentional and acceptable for p50/p95 display metrics.

**Files:**
- Create: `src/lib/math.ts`
- Test: `tests/math.test.ts`
- Modify: `src/lib/optimization.ts`, `src/lib/queue-analysis.ts`, `src/lib/dora.ts`, `src/lib/github.ts`, `src/app/api/github/open-pr-health/route.ts`, `src/app/api/github/runner-stats/route.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/math.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { percentile, percentileOf } from "@/lib/math";

describe("percentile", () => {
  it("returns 0 for empty input", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("returns the only element for single-element input", () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.95)).toBe(42);
  });

  it("returns exact endpoints for p=0 and p=1", () => {
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 1)).toBe(4);
  });

  it("interpolates between closest ranks", () => {
    // idx = 0.5 * (4-1) = 1.5 -> halfway between 2 and 3
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    // idx = 0.95 * 3 = 2.85 -> 3 + (4-3) * 0.85
    expect(percentile([1, 2, 3, 4], 0.95)).toBeCloseTo(3.85);
  });

  it("handles two-element arrays", () => {
    expect(percentile([10, 20], 0.5)).toBe(15);
    expect(percentile([10, 20], 0.95)).toBe(19.5);
  });
});

describe("percentileOf", () => {
  it("sorts a copy without mutating the input", () => {
    const input = [9, 1, 5, 3];
    expect(percentileOf(input, 0.5)).toBe(4);
    expect(input).toEqual([9, 1, 5, 3]);
  });

  it("returns 0 for empty input", () => {
    expect(percentileOf([], 0.9)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/math.test.ts`
Expected: FAIL — cannot resolve `@/lib/math`.

- [ ] **Step 3: Implement `src/lib/math.ts`**

```ts
/**
 * Shared percentile helpers.
 *
 * Every analytics module must use these instead of local copies. Uses
 * linear interpolation between closest ranks (the "linear" method — same
 * as NumPy's default), which is the algorithm 4 of the 6 historical
 * call sites already used.
 */

/**
 * Percentile of an array that is ALREADY sorted ascending. p is in [0, 1].
 * Returns 0 for empty input (matches every historical call site).
 */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Percentile of an unsorted array — copies and sorts first, input is not mutated. */
export function percentileOf(values: number[], p: number): number {
  return percentile([...values].sort((a, b) => a - b), p);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/math.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Replace the interpolation-variant call sites (behavior unchanged)**

`src/lib/optimization.ts` — delete the local `function percentile(arr: number[], p: number)` (line 28, it sorts internally), add to imports at the top:

```ts
import { percentileOf } from "@/lib/math";
```

and change the single call site (line 75):

```ts
    const p95 = percentileOf(waits, 0.95);
```

`src/lib/queue-analysis.ts` — delete the local `function percentile(sorted: number[], p: number)` (line 50), add import:

```ts
import { percentile } from "@/lib/math";
```

Call sites (lines 83, 84, 150) already pass sorted arrays — unchanged.

`src/lib/dora.ts` — delete the local `function percentile(sorted: number[], p: number)` (line 157), add import:

```ts
import { percentile } from "@/lib/math";
```

Call sites (lines 208, 209, 419, 420) unchanged.

`src/app/api/github/open-pr-health/route.ts` — delete the local `function percentile(sorted: number[], p: number)` (line 65), add import:

```ts
import { percentile } from "@/lib/math";
```

Call sites (lines 263–266) unchanged.

- [ ] **Step 6: Replace the ceil-index call sites (minor behavior change, intentional)**

`src/lib/github.ts` — delete the local `function percentile(sorted: number[], p: number)` (line 633, the `sorted[Math.ceil(p * sorted.length) - 1]` variant), add import near the other lib imports:

```ts
import { percentile } from "@/lib/math";
```

Call sites (lines 704, 705, 723) unchanged.

`src/app/api/github/runner-stats/route.ts` — delete the local `function percentile(sorted: number[], p: number)` (line 38, ceil-index variant), add import:

```ts
import { percentile } from "@/lib/math";
```

Call site (line 131) unchanged.

- [ ] **Step 7: Full verification**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm run lint`
Expected: all existing tests still pass (`dora.test.ts` exercises the interpolation algorithm through `dora.ts`, so it guards against regressions), typecheck clean, lint clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/math.ts tests/math.test.ts src/lib/optimization.ts src/lib/queue-analysis.ts src/lib/dora.ts src/lib/github.ts src/app/api/github/open-pr-health/route.ts src/app/api/github/runner-stats/route.ts
git commit -m "refactor: consolidate six percentile implementations into lib/math"
```

---

### Task 2: Deduplicate repo-summary construction

**Why:** `getRepoSummary` (`src/lib/github.ts:243-306`) and the inline block inside `getRepoOverview` (`src/lib/github.ts:351-391`, commented "same logic as getRepoSummary") build an identical `RepoSummary` from a runs array. Extract a pure `buildRepoSummary(runs)` and call it from both.

**Files:**
- Modify: `src/lib/github.ts`
- Test: `tests/repo-summary.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/repo-summary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRepoSummary } from "@/lib/github";

const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

const runs = [
  {
    id: 3,
    conclusion: "success" as string | null,
    status: "completed" as string | null,
    created_at: day(0),
    actor: { login: "alice" },
    head_sha: "abcdef1234567890",
    head_commit: { message: "Fix thing\n\nlong body" },
  },
  {
    id: 2,
    conclusion: "failure" as string | null,
    status: "completed" as string | null,
    created_at: day(1),
    actor: null,
    head_sha: null,
    head_commit: null,
  },
  {
    id: 1,
    conclusion: null as string | null,
    status: "in_progress" as string | null,
    created_at: day(2),
    actor: null,
    head_sha: null,
    head_commit: null,
  },
];

describe("buildRepoSummary", () => {
  it("exposes the latest run's fields", () => {
    const s = buildRepoSummary(runs);
    expect(s.latest_conclusion).toBe("success");
    expect(s.latest_status).toBe("completed");
    expect(s.latest_actor).toBe("alice");
    expect(s.latest_sha).toBe("abcdef1");
    expect(s.latest_message).toBe("Fix thing");
  });

  it("computes success rate over completed runs only", () => {
    const s = buildRepoSummary(runs);
    // 1 success out of 2 completed (in_progress run excluded)
    expect(s.success_rate).toBe(50);
  });

  it("returns recent run points newest-first", () => {
    const s = buildRepoSummary(runs);
    expect(s.recent_runs.map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it("buckets the 30-day trend by calendar day", () => {
    const s = buildRepoSummary(runs);
    expect(s.trend_30d).toHaveLength(2);
    expect(s.trend_30d.every((t) => t.total === 1)).toBe(true);
    expect(s.trend_30d[1].success).toBe(1); // newest day sorted last
  });

  it("handles an empty runs array", () => {
    const s = buildRepoSummary([]);
    expect(s.latest_conclusion).toBeNull();
    expect(s.success_rate).toBe(0);
    expect(s.recent_runs).toEqual([]);
    expect(s.trend_30d).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/repo-summary.test.ts`
Expected: FAIL — `buildRepoSummary` is not exported from `@/lib/github`.

- [ ] **Step 3: Extract `buildRepoSummary` in `src/lib/github.ts`**

Add this directly above the existing `getRepoSummary` (before line 243). The minimal run shape keeps it usable with both `listWorkflowRunsForRepo` and `listWorkflowRuns` responses:

```ts
/** Minimal shape buildRepoSummary needs — matches GitHub's workflow_run fields. */
export interface SummaryRun {
  id: number;
  conclusion: string | null;
  status: string | null;
  created_at: string;
  actor?: { login: string } | null;
  head_sha?: string | null;
  head_commit?: { message?: string | null } | null;
}

/**
 * Build a RepoSummary from a newest-first runs array. Pure — shared by
 * getRepoSummary (repo-level) and getRepoOverview (per-workflow), which
 * previously duplicated this logic.
 */
export function buildRepoSummary(runs: SummaryRun[]): RepoSummary {
  const latest = runs[0] ?? null;

  const recent_runs: RepoRunPoint[] = runs.slice(0, 10).map((r) => ({
    id: r.id,
    conclusion: r.conclusion ?? null,
    status: r.status ?? null,
    created_at: r.created_at,
  }));

  const completed10 = runs.filter((r) => r.status === "completed").slice(0, 10);
  const successCount = completed10.filter((r) => r.conclusion === "success").length;
  const success_rate = completed10.length
    ? Math.round((successCount / completed10.length) * 100)
    : 0;

  const now = Date.now();
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const buckets: Record<string, { success: number; total: number }> = {};
  for (const r of runs) {
    const ts = new Date(r.created_at).getTime();
    if (ts < cutoff || r.status !== "completed") continue;
    const day = r.created_at.slice(0, 10);
    if (!buckets[day]) buckets[day] = { success: 0, total: 0 };
    buckets[day].total++;
    if (r.conclusion === "success") buckets[day].success++;
  }
  const trend_30d: TrendPoint[] = Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { success, total }]) => ({ date, success, total }));

  return {
    latest_conclusion: latest?.conclusion ?? null,
    latest_status: latest?.status ?? null,
    latest_run_at: latest?.created_at ?? null,
    latest_actor: latest?.actor?.login ?? null,
    latest_sha: latest?.head_sha?.slice(0, 7) ?? null,
    latest_message: latest?.head_commit?.message?.split("\n")[0] ?? null,
    recent_runs,
    trend_30d,
    success_rate,
  };
}
```

- [ ] **Step 4: Slim down `getRepoSummary` (lines 243-306)**

Replace its body after the fetch with a single call. The function becomes:

```ts
export async function getRepoSummary(
  token: string,
  owner: string,
  repo: string
): Promise<RepoSummary> {
  const octokit = getOctokit(token);

  const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    per_page: 30,
  });

  return buildRepoSummary(data.workflow_runs);
}
```

- [ ] **Step 5: Replace the inline duplicate in `getRepoOverview` (lines 351-391)**

Delete the block from the `// Build summary (same logic as getRepoSummary)` comment through the `};` that closes `const summary: RepoSummary = {`, and replace it with:

```ts
        const summary = buildRepoSummary(runs);
```

(The surrounding code — `runs`, then `dur_points` construction, then the `results.push({ ... summary ... })` — stays as-is.)

- [ ] **Step 6: Full verification**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm run lint`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/github.ts tests/repo-summary.test.ts
git commit -m "refactor: extract buildRepoSummary, remove duplicated summary construction"
```

---

### Task 3: Deduplicate run duration/queue-wait computation

**Why:** Identical `duration_ms`/`queue_wait_ms` math exists in `src/lib/sync.ts:58-68` and `src/app/api/webhooks/github/route.ts:104-114`. Extract `computeRunTiming`. Note: `src/lib/github.ts:526-545` is deliberately NOT touched — that variant uses `completed_at` and a different null-fallback contract for the live-runs API.

**Files:**
- Create: `src/lib/run-timing.ts`
- Test: `tests/run-timing.test.ts`
- Modify: `src/lib/sync.ts`, `src/app/api/webhooks/github/route.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/run-timing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeRunTiming } from "@/lib/run-timing";

describe("computeRunTiming", () => {
  const base = {
    created_at: "2026-08-13T10:00:00Z",
    run_started_at: "2026-08-13T10:00:30Z",
    updated_at: "2026-08-13T10:05:00Z",
  };

  it("computes duration and queue wait for completed runs", () => {
    const t = computeRunTiming({ ...base, status: "completed" });
    expect(t.queue_wait_ms).toBe(30_000);
    expect(t.duration_ms).toBe(270_000);
  });

  it("returns null duration for in-progress runs but keeps queue wait", () => {
    const t = computeRunTiming({ ...base, status: "in_progress" });
    expect(t.duration_ms).toBeNull();
    expect(t.queue_wait_ms).toBe(30_000);
  });

  it("returns nulls when run_started_at is missing", () => {
    const t = computeRunTiming({ ...base, status: "completed", run_started_at: null });
    expect(t.duration_ms).toBeNull();
    expect(t.queue_wait_ms).toBeNull();
  });

  it("never returns negative values", () => {
    const t = computeRunTiming({
      status: "completed",
      created_at: "2026-08-13T10:00:30Z",
      run_started_at: "2026-08-13T10:00:00Z",
      updated_at: "2026-08-13T09:59:00Z",
    });
    expect(t.queue_wait_ms).toBe(0);
    expect(t.duration_ms).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/run-timing.test.ts`
Expected: FAIL — cannot resolve `@/lib/run-timing`.

- [ ] **Step 3: Implement `src/lib/run-timing.ts`**

```ts
/**
 * Canonical duration/queue-wait computation for workflow runs.
 *
 * Shared by the DB sync path (src/lib/sync.ts) and webhook ingest
 * (src/app/api/webhooks/github/route.ts) — both must agree byte-for-byte,
 * because webhook rows and synced rows upsert into the same workflow_runs
 * table and feed the same Reports charts.
 *
 * The live-runs API path in src/lib/github.ts intentionally keeps its own
 * variant: it prefers the completed_at field and returns undefined (not
 * null) to match its response type.
 */

export interface RunTimingInput {
  status: string | null;
  run_started_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunTiming {
  /** Execution time for completed runs (updated_at - run_started_at); null otherwise. */
  duration_ms: number | null;
  /** Time between creation and first job start; null if run_started_at is missing. */
  queue_wait_ms: number | null;
}

export function computeRunTiming(r: RunTimingInput): RunTiming {
  const startedAt = r.run_started_at ? new Date(r.run_started_at).getTime() : null;
  const updatedAt = new Date(r.updated_at).getTime();
  const createdAt = new Date(r.created_at).getTime();

  return {
    duration_ms:
      r.status === "completed" && startedAt
        ? Math.max(0, updatedAt - startedAt)
        : null,
    queue_wait_ms: startedAt ? Math.max(0, startedAt - createdAt) : null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/run-timing.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Use it in `src/lib/sync.ts`**

Add to the existing imports from local libs (near line 16):

```ts
import { computeRunTiming } from "@/lib/run-timing";
```

Replace lines 58-68 (the `startedAt` / `updatedAt` / `createdAt` / `durationMs` / `queueWaitMs` block) with:

```ts
      const { duration_ms, queue_wait_ms } = computeRunTiming({
        status: r.status ?? null,
        run_started_at: r.run_started_at ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      });
```

and in the `rows.push({...})` below, change the two fields:

```ts
        duration_ms,
        queue_wait_ms,
```

- [ ] **Step 6: Use it in `src/app/api/webhooks/github/route.ts`**

Add the import (with the other `@/lib` imports at the top):

```ts
import { computeRunTiming } from "@/lib/run-timing";
```

Replace lines 104-114 (the `// 6. Compute duration and queue wait` block) with:

```ts
  // 6. Compute duration and queue wait (same math as the sync path)
  const { duration_ms, queue_wait_ms } = computeRunTiming({
    status: r.status,
    run_started_at: r.run_started_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  });
```

and in `const row: RunUpsertRow = {...}` change:

```ts
    duration_ms,
    queue_wait_ms,
```

(If the payload type marks these fields optional, pass `r.status ?? null` / `r.run_started_at ?? null` — match whatever `tsc` requires; the math is identical.)

- [ ] **Step 7: Full verification**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm run lint`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/run-timing.ts tests/run-timing.test.ts src/lib/sync.ts src/app/api/webhooks/github/route.ts
git commit -m "refactor: extract computeRunTiming shared by sync and webhook ingest"
```

---

### Task 4: Persisted weekly-digest dedupe state

**Why:** The Weekly Leadership Digest fires only when `new Date().getUTCDay() === 1` (`src/app/api/cron/sync/route.ts:80`). A missed Monday (deploy, outage, Vercel Hobby cron hiccup) silently skips the whole week, and a manual re-trigger on Monday double-sends. Add a persisted ISO-week marker via a new `app_meta` key/value table, following the existing versioned-migration pattern in `src/lib/db.ts`.

**Design decisions:**
- Marker updates only when the send actually succeeded or there were zero rules — a fully-failed Monday run stays retryable.
- The Monday guard stays; the week marker only dedupes within/after that Monday.
- DB read failure degrades to the old behavior (`lastWeek = null`), never blocks the daily sync.

**Files:**
- Create: `src/lib/time.ts`
- Test: `tests/time.test.ts`
- Modify: `src/lib/db.ts` (migration v5 + `getMeta`/`setMeta`), `src/app/api/cron/sync/route.ts`

- [ ] **Step 1: Write the failing tests for `isoWeekKey`**

Create `tests/time.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isoWeekKey } from "@/lib/time";

describe("isoWeekKey", () => {
  it("labels a mid-year week correctly", () => {
    // 2026-08-13 is a Thursday in ISO week 33
    expect(isoWeekKey(new Date("2026-08-13T12:00:00Z"))).toBe("2026-W33");
  });

  it("groups Monday and Sunday of the same ISO week", () => {
    const monday = isoWeekKey(new Date("2026-08-10T00:00:00Z"));
    const sunday = isoWeekKey(new Date("2026-08-16T23:59:59Z"));
    expect(monday).toBe(sunday);
    expect(monday).toBe("2026-W33");
  });

  it("assigns Dec 29 2025 to ISO week 2026-W01 (year boundary)", () => {
    expect(isoWeekKey(new Date("2025-12-29T12:00:00Z"))).toBe("2026-W01");
  });

  it("assigns Jan 1 2026 to ISO week 2026-W01", () => {
    expect(isoWeekKey(new Date("2026-01-01T12:00:00Z"))).toBe("2026-W01");
  });

  it("zero-pads single-digit weeks", () => {
    expect(isoWeekKey(new Date("2026-01-05T12:00:00Z"))).toBe("2026-W02");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/time.test.ts`
Expected: FAIL — cannot resolve `@/lib/time`.

- [ ] **Step 3: Implement `src/lib/time.ts`**

```ts
/**
 * ISO-8601 week helpers for scheduled-job dedupe.
 */

/**
 * ISO week key for a date, e.g. "2026-W33". Weeks start on Monday; week 1
 * is the week containing the year's first Thursday. Used to persist "this
 * weekly job already ran for this week" markers so re-runs don't double-send
 * and a single missed day doesn't silently skip the week.
 */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1 ... Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // move to this week's Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/time.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add migration v5 + meta helpers to `src/lib/db.ts`**

Append to the `MIGRATIONS` array (after the version-4 entry ending at line 268):

```ts
  {
    version: 5,
    name: "app_meta",
    up: [
      // Key/value state for scheduled jobs (e.g. "leadership_digest_last_week").
      // Keeps weekly jobs idempotent across missed or repeated cron invocations.
      `CREATE TABLE IF NOT EXISTS app_meta (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )`,
    ],
  },
```

Add these functions after `markDigestSent` (around line 671), before `updateAlertEventDeliveryStatus`:

```ts
// ── App metadata (key/value scheduled-job state) ─────────────────────────────

export async function getMeta(key: string): Promise<string | null> {
  await ensureSchema();
  const rows = await getDb()`SELECT value FROM app_meta WHERE key = ${key}` as { value: string }[];
  return rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await ensureSchema();
  await getDb()`
    INSERT INTO app_meta (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}
```

- [ ] **Step 6: Wire the dedupe into `src/app/api/cron/sync/route.ts`**

Update the imports:

```ts
import { listSyncedRepos, getMeta, setMeta } from "@/lib/db";
import { isoWeekKey } from "@/lib/time";
```

Replace the leadership-digest block (lines 79-89, from `// Monday = 1 ...` through the closing `}` of `if (isMonday)`) with:

```ts
  // Weekly Leadership Digest: Monday guard + persisted ISO-week marker, so a
  // re-run on the same Monday can't double-send and the marker makes skipped
  // weeks visible instead of silently lost. DB read failure degrades to the
  // pre-v4.0.12 behavior (send on Monday regardless).
  const now = new Date();
  const isMonday = now.getUTCDay() === 1;
  const weekKey = isoWeekKey(now);
  const lastWeek = await getMeta("leadership_digest_last_week").catch(() => null);

  let leadershipDigest: Awaited<ReturnType<typeof sendWeeklyLeadershipDigests>> | { skipped: true } = { skipped: true };
  if (isMonday && lastWeek !== weekKey) {
    try {
      leadershipDigest = await sendWeeklyLeadershipDigests(octokit, process.env.GITHUB_TOKEN);
      // Mark the week sent only on success (or when there was nothing to send),
      // so a fully-failed Monday run stays retryable.
      if (leadershipDigest.sent > 0 || leadershipDigest.rules_processed === 0) {
        await setMeta("leadership_digest_last_week", weekKey);
      }
    } catch (e) {
      console.error("[cron] Leadership digest error:", e);
      leadershipDigest = { rules_processed: 0, sent: 0, failures: 1 };
    }
  }
```

Also update the stale header comment (lines 23-26): replace the paragraph starting `* On Mondays (UTC) only, also sends the Weekly Leadership Digest` with:

```ts
 * On Mondays (UTC) only, also sends the Weekly Leadership Digest (v4.0.3)
 * to every "leadership_digest" alert rule. A persisted ISO-week marker
 * (app_meta."leadership_digest_last_week") makes the send idempotent within
 * a week and keeps fully-failed Mondays retryable.
```

- [ ] **Step 7: Full verification**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm run lint`
Expected: PASS, clean. (The migration runs lazily via `ensureSchema()` — no manual SQL step needed.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/time.ts tests/time.test.ts src/lib/db.ts src/app/api/cron/sync/route.ts
git commit -m "feat: persist weekly leadership digest cadence in app_meta (idempotent cron)"
```

---

### Task 5: Rate-limit expensive fan-out endpoints

**Why:** Only `/api/auth/setup` and `/api/auth/login` are rate-limited today. Authenticated users can spam org-wide fan-outs (`org-overview`, `org-health-scorecard`, `bus-factor`), each of which fires dozens of GitHub API calls per miss. Add a subject-keyed limiter (token hash, not IP — IPs are spoofable and shared behind NAT) and apply it to the three expensive routes. Cache hits remain cheap, so legitimate UI use is unaffected.

**Files:**
- Modify: `src/lib/ratelimit.ts`
- Test: `tests/ratelimit.test.ts`
- Modify: `src/app/api/github/org-overview/route.ts`, `src/app/api/github/org-health-scorecard/route.ts`, `src/app/api/github/bus-factor/route.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/ratelimit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { apiRateLimit } from "@/lib/ratelimit";

describe("apiRateLimit", () => {
  const req = new Request("http://localhost/api/x", {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });

  it("allows requests under the budget and blocks over it", () => {
    for (let i = 0; i < 5; i++) {
      expect(apiRateLimit(req, "t:over", { limit: 5, windowMs: 60_000 }).allowed).toBe(true);
    }
    const blocked = apiRateLimit(req, "t:over", { limit: 5, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("keys by subject when provided, independent of IP", () => {
    const a = apiRateLimit(req, "t:sub", { limit: 1, windowMs: 60_000, subject: "hashA" });
    const b = apiRateLimit(req, "t:sub", { limit: 1, windowMs: 60_000, subject: "hashB" });
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    const aAgain = apiRateLimit(req, "t:sub", { limit: 1, windowMs: 60_000, subject: "hashA" });
    expect(aAgain.allowed).toBe(false);
  });

  it("keeps separate budgets per prefix", () => {
    const x = apiRateLimit(req, "t:px", { limit: 1, windowMs: 60_000 });
    const y = apiRateLimit(req, "t:py", { limit: 1, windowMs: 60_000 });
    expect(x.allowed).toBe(true);
    expect(y.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/ratelimit.test.ts`
Expected: FAIL — `apiRateLimit` is not exported.

- [ ] **Step 3: Add `apiRateLimit` to `src/lib/ratelimit.ts`**

Append after `getRateLimitKey` (line 49):

```ts
/**
 * Rate-limit check for expensive API routes. Prefer `subject` = SHA-256 token
 * hash (from cache.hashKey) for authenticated routes: x-forwarded-for is
 * spoofable without a trusted proxy and shared behind NAT. Falls back to IP
 * when no subject is given.
 */
export function apiRateLimit(
  req: Request,
  prefix: string,
  opts: { limit: number; windowMs: number; subject?: string | null },
): { allowed: boolean; retryAfterMs?: number } {
  const key = opts.subject ? `${prefix}:sub:${opts.subject}` : getRateLimitKey(req, prefix);
  return rateLimit(key, opts.limit, opts.windowMs);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/ratelimit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Apply to the three expensive routes**

The guard is identical in all three — insert it right after the token/validation checks and before any cache/compute work:

```ts
  const rl = apiRateLimit(req, "<PREFIX>", {
    limit: <LIMIT>,
    windowMs: 60_000,
    subject: hashKey(token),
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before retrying." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)) },
      },
    );
  }
```

Per-route values (add `import { apiRateLimit } from "@/lib/ratelimit";` to each; all three already import `hashKey` from `@/lib/cache`):

| Route file | `<PREFIX>` | `<LIMIT>` | Insert after |
| --- | --- | --- | --- |
| `src/app/api/github/org-overview/route.ts` | `github:org-overview` | `30` | the `limit` validation (~line 51), before `try {` |
| `src/app/api/github/org-health-scorecard/route.ts` | `github:org-health-scorecard` | `20` | the `limit` validation (~line 45), before `try {` |
| `src/app/api/github/bus-factor/route.ts` | `github:bus-factor` | `20` | the `repo` validation (~line 25), before `try {` |

- [ ] **Step 6: Full verification**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm run lint`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ratelimit.ts tests/ratelimit.test.ts src/app/api/github/org-overview/route.ts src/app/api/github/org-health-scorecard/route.ts src/app/api/github/bus-factor/route.ts
git commit -m "feat: rate-limit expensive org-wide fan-out endpoints by token hash"
```

---

### Task 6: Helm CronJob for scheduled sync

**Why:** `/api/cron/sync` is only triggered by Vercel Cron (`vercel.json`). Docker/Kubernetes deploys of the Helm chart silently never sync — the chart has no CronJob. Add an opt-in `cron.enabled` CronJob that calls the in-cluster service with `wget` (busybox wget ships in node:20-alpine; curl does not).

**Files:**
- Create: `helm/gitdash/templates/cronjob.yaml`
- Modify: `helm/gitdash/values.yaml`, `README.md`

- [ ] **Step 1: Add values**

Append to `helm/gitdash/values.yaml` (after the `serviceAccount:` block, before `terminationGracePeriodSeconds`):

```yaml
# ── Scheduled sync (Kubernetes equivalent of vercel.json crons) ───────────────
cron:
  # Vercel deploys run the sync via vercel.json crons — leave this disabled
  # there. For Kubernetes deploys, enable this AND ensure GITHUB_TOKEN and
  # CRON_SECRET are present in the chart secret (or injected via extraEnv).
  enabled: false
  schedule: "17 3 * * *"
  # Hard cap on how long one sync job may run before Kubernetes kills it
  activeDeadlineSeconds: 600
  # How many finished Job objects to keep for debugging
  historyLimit: 3
```

- [ ] **Step 2: Create `helm/gitdash/templates/cronjob.yaml`**

```yaml
{{- if .Values.cron.enabled }}
apiVersion: batch/v1
kind: CronJob
metadata:
  name: {{ include "gitdash.fullname" . }}-sync
  namespace: {{ include "gitdash.namespace" . }}
  labels:
    {{- include "gitdash.labels" . | nindent 4 }}
spec:
  schedule: {{ .Values.cron.schedule | quote }}
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: {{ .Values.cron.historyLimit }}
  failedJobsHistoryLimit: {{ .Values.cron.historyLimit }}
  jobTemplate:
    spec:
      activeDeadlineSeconds: {{ .Values.cron.activeDeadlineSeconds }}
      template:
        metadata:
          labels:
            {{- include "gitdash.selectorLabels" . | nindent 12 }}
        spec:
          restartPolicy: Never
          {{- with .Values.imagePullSecrets }}
          imagePullSecrets:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          securityContext:
            {{- toYaml .Values.podSecurityContext | nindent 12 }}
          containers:
            - name: sync
              image: {{ include "gitdash.image" . }}
              imagePullPolicy: {{ .Values.image.pullPolicy }}
              # busybox wget ships with node:20-alpine (curl does not).
              command:
                - /bin/sh
                - -c
                - |
                  wget -qO- --header="Authorization: Bearer $CRON_SECRET" \
                    "http://{{ include "gitdash.fullname" . }}:{{ .Values.service.port }}/api/cron/sync"
              envFrom:
                - configMapRef:
                    name: {{ include "gitdash.configmapName" . }}
                - secretRef:
                    name: {{ include "gitdash.secretName" . }}
              securityContext:
                {{- toYaml .Values.containerSecurityContext | nindent 16 }}
              resources:
                requests:
                  cpu: 50m
                  memory: 64Mi
                limits:
                  cpu: 100m
                  memory: 128Mi
{{- end }}
```

- [ ] **Step 3: Verify with helm**

Run:

```bash
helm lint helm/gitdash
helm template gitdash helm/gitdash --set cron.enabled=true | grep -A5 "kind: CronJob"
helm template gitdash helm/gitdash | grep -c "kind: CronJob" || true
```

Expected: lint passes; the first template render contains a CronJob named `<fullname>-sync` with schedule `"17 3 * * *"`; the second render (cron disabled by default) outputs `0`.

- [ ] **Step 4: Document in README**

In `README.md`, in the "Optional: Historical DB + Webhooks" section, replace the bullet about `/api/cron/sync` with:

```markdown
- `/api/cron/sync` re-syncs every previously-synced repo daily. On Vercel this is wired via `vercel.json` crons; on Kubernetes set `cron.enabled: true` in `helm/gitdash/values.yaml` (requires `GITHUB_TOKEN` and `CRON_SECRET` in the chart secret)
```

- [ ] **Step 5: Full verification**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm run lint && helm lint helm/gitdash`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add helm/gitdash/templates/cronjob.yaml helm/gitdash/values.yaml README.md
git commit -m "feat: add optional Helm CronJob for scheduled sync (parity with Vercel crons)"
```

---

## Rollback

Every task is an independent commit — `git revert <sha>` per task. Notes:

- Task 4: reverting drops the `app_meta` table usage; the table itself is harmless to leave.
- Task 6: default `cron.enabled: false` — zero impact unless explicitly enabled.
- Task 1's behavior change (ceil-index → interpolation in `github.ts` job-stats and `runner-stats`) is the only metric-visible change: p50/p95 values on small samples shift by at most one rank.

## Out of scope (follow-up plans)

- Route-level test coverage for middleware/webhook HMAC, `db.ts` alert evaluation.
- Splitting `docs/page.tsx` (3187 lines) and `db.ts`.
- Multi-replica cache/rate-limit sharing (Redis/DB-backed).
- `updateAlertRule` single-statement transaction.
