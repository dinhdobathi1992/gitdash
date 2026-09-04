---
type: brainstorm
date: 2026-08-25
project: gitdash
version_at_time: 4.2.8
status: awaiting-decision
---

# GitDash — next release direction (v4.3 / v5)

## Contract

**Outcome.** An agreed theme for the next release, chosen against verified
current-state evidence rather than the README's description of itself.

**Constraints.**
- Next.js 16 App Router, React 19, TS strict, Tailwind v4. Not up for renegotiation.
- Primary deploy target Vercel (`vercel.json` crons, `vercel.yml`). Serverless
  constrains any caching/state design.
- Postgres is *optional*. Every feature must degrade to live-GitHub-only.
- Single maintainer. Release cadence must stay sustainable.
- MIT, self-hosted. No feature may assume a paid backend.

**Non-goals.**
- README rewrite as an end in itself (separate track; see Finding 4).
- Auth/session rework — `iron-session` + AES-256-GCM is sound.
- Rewriting the visualization layer.

**Acceptance criteria.**
- A named theme with an ordered scope list.
- Every scope item traceable to evidence below.
- Load-bearing assumption named per option, plus its first failure mode.

---

## Verified current state

Read from source, not README. 157 TS files, ~8.2k LOC in `src/lib`, 20 test files.

**Actual surface** — 20 UI pages, 50 API routes:

| Area | Built |
|---|---|
| DORA | `dora.ts` (569), `github-dora.ts`, `/repo-dora` |
| Workflows | runs, jobs, steps, runners, queue, triggers, anomaly, optimization |
| Team | contributors, bus factor, workload risk, 1:1 prep, contributor briefs |
| Org | org overview, org health scorecard, leadership narrative/digest |
| Cost | `cost.ts`, Enhanced Billing |
| Alerts | 8 metrics, rules + events, email via Resend/SMTP/SendGrid |
| AI | insights, root-cause, anomaly-explanation, snapshots (631 LOC) |
| Security | security scan, security alerts, audit log |

### Finding 1 — half the alert engine reads a table nothing writes to

`pr_facts` is created by migration v2 and read by alert-rule evaluation. Its
only writer, `upsertPrFacts` (`src/lib/db.ts:396`), **has zero callers.**

`syncRepo` (`src/lib/sync.ts:35`) fetches only `listWorkflowRunsForRepo` and
calls `upsertRuns`. No PR fetch anywhere in the sync path. `/api/db/sync` and
`/api/cron/sync` both route through `syncRepo`.

Affected metrics — 4 of 8:
- `pr_throughput_drop`
- `review_response_p90`
- `pr_abandon_rate`
- `unreviewed_pr_age`

Failure is **silent**. The read path guards with `if (row && row.prior_count > 0)`
and leaves `value` unset — the rule does not fire and reports no error. An
operator configuring "alert me when review response degrades" gets permanent
all-clear from an empty table.

This is worse than a crash: an alerting system whose silence is indistinguishable
between "healthy" and "no data".

### Finding 2 — release cadence shows no pre-release verification loop

27 releases across 4 days (4.0.0 on 2026-08-13 → 4.2.8 on 2026-08-16). The last
three are all externally-reported regressions:

- 4.2.8 — every page left a blank band at wide viewports (layout)
- 4.2.7 — security panel blamed the token for features simply disabled (logic)
- 4.2.6 — deployments empty-state copy

These are cross-cutting consistency defects, not deep logic bugs. They escape
because nothing checks them before tag. 20 test files exercise `lib` computation
well; nothing exercises rendered-page consistency.

### Finding 3 — in-process cache is near-inert on the primary deploy target

`src/lib/cache.ts` is a module-level `Map`, self-documented: *"Not shared across
serverless instances — treat as a request-coalescing layer, not a distributed
cache."*

Accurate and honest. But org-scale fan-out (`org-health-scorecard`,
`org-overview`) is exactly the workload that needs a cache, and on Vercel each
invocation gets a cold `Map`. Bounded concurrency (`pLimit`) protects GitHub's
secondary rate limits; it does not reduce total call volume. Any org-scale
feature in the next release inherits this ceiling.

### Finding 4 — the most differentiated work is the least visible

Absent from the README entirely: org health scorecard, bus factor, team workload
risk, 1:1 prep sheets, weekly leadership digest, leadership narrative,
contributor briefs, issues analytics, AI root-cause, anomaly explanation.

The README sells "GitHub Actions Metrics Dashboard". The codebase contains an
engineering-leadership product. Positioning trails implementation by ~2 minor
versions.

### Finding 5 — all 13 feature flags default true

`DEFAULT_FLAGS` in `feature-flags.ts` enables every capability, client-side
(`localStorage`). Every user meets every surface at once, including thinner
ones. No staged rollout path exists for a new capability.

---

## Options

### A — Trust: make what exists actually work

Fix the `pr_facts` write path (PR sync in `syncRepo`). Add data provenance to
every DB-backed metric — sample size, window, explicit "insufficient data"
instead of silence. Alert rules surface when they cannot evaluate. Add a pre-tag
consistency check covering the Finding-2 class.

- **Depends on:** users are lost to features that quietly misinform, not to
  features that are missing.
- **Fails first if:** nobody has adopted alerts/reports yet — then this fixes a
  path no one walks.
- **Cost:** small. Contained in `sync.ts`, `db.ts`, alerts UI.
- **Abandon cost:** near zero. Every piece is independently valuable.

### B — Breadth: multi-provider (GitLab / Bitbucket)

Abstract the VCS layer, add a second provider.

- **Depends on:** the ceiling on adoption is GitHub-only, not depth.
- **Fails first if:** the GitHub coupling is leakier than it looks — Octokit
  types thread through `github.ts` (832 LOC) into 20+ routes, and DORA, cost,
  and security scan are all GitHub-Actions-shaped. Worst case: a long refactor
  that stalls GitHub feature work, ships a shallow second provider, and moves no
  adoption.
- **Cost:** largest of the four.
- **Abandon cost:** highest — a half-done abstraction is worse than none.

### C — Depth: name the engineering-leadership product

Promote the existing leadership layer from buried routes to the product's spine.
Org-first navigation, the weekly digest as a first-class artifact, scorecard and
bus factor as the landing surface. Reposition README and `/docs` to match.

- **Depends on:** the user is an eng manager or CTO, not a CI engineer.
- **Fails first if:** self-hosted deployment is IC-driven and managers never
  install infrastructure — the audience that installs is not the audience this
  serves.
- **Cost:** moderate, and mostly surfacing rather than building. Requires
  Finding 3 resolved for org-scale pages to be usable.
- **Abandon cost:** low — repositioning reverts cheaply, and the underlying
  computation stays valuable either way.

### D — AI out of optional

Make AI insights the headline instead of a hidden opt-in.

- **Depends on:** AI analysis is the differentiator.
- **Fails first if:** it is the most commoditized claim available in 2026, and
  the bring-your-own-key wall is structural — the feature cannot be demoed
  without the user first configuring a provider. Weakest wedge of the four.
- **Cost:** low build, high positioning risk.

---

## Recommendation

**A as a gate, then C as the theme.** Not a compromise — an ordering.

A is non-negotiable and small. Shipping any new capability on top of an alerting
system where half the metrics silently never fire compounds the problem: more
surface, same trust deficit. The `pr_facts` gap is a defect where the product
actively misinforms an operator, and it is contained.

C is then the highest-return theme because it builds almost nothing new. The
leadership layer already exists and is already the most differentiated code in
the repo (Finding 4). The work is surfacing, sharpening, and positioning — and
its load-bearing assumption is cheap to test and cheap to abandon.

B is rejected for this release: highest cost, highest abandon cost, and its
assumption is the least verifiable without adoption data GitDash does not have.
D is rejected as a theme; it stays a supporting feature.

Finding 3 (shared cache) is a **prerequisite of C, not a theme** — org-scale
pages are the ones that need it. Scope it inside C, not before it.

Finding 5 (flags default true) becomes the delivery mechanism for C: ship new
leadership surfaces behind flags defaulting false, promote once proven.

---

## Unresolved

1. **Adoption data.** Is anyone running `/alerts` and `/reports` in production
   with `DATABASE_URL` set? This decides whether A is urgent or merely correct.
   Nothing in the repo answers it.
2. **Audience.** Who installs GitDash — the CI engineer or the eng manager? C's
   entire assumption rests here, and it is not resolvable from source.
3. **Cache backend for C.** Neon Postgres is already an optional dependency;
   reusing it for a shared cache avoids adding Redis, but it is optional, so the
   no-DB path still degrades to uncached. Unresolved by design until C is chosen.
