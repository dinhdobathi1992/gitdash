# Reproducing GitDash metrics from the GitHub REST API

GitDash exposes no public API. This guide is the substitute: it lists every GitHub REST call GitDash makes for its
metrics, the exact formulas and constants it applies, and the places where it samples or caps data. Your application
calls GitHub directly with **your own token**; nothing here calls GitDash.

Version documented: GitDash 4.7.1 (`package.json:3`), working tree including the in-progress extraction of pure metric math into `src/lib/pr-health.ts` and `src/lib/workflow-run-stats.ts` (behavior unchanged; line numbers follow the extracted files). Every constant is cited with a footnote marker and resolved to `path:line`
in the reference list at the end, so the doc can be kept in sync with source.

**Two ways to use this guide**

| Mode | What you do | Result |
|---|---|---|
| **Parity** | Copy GitDash's sample sizes (60 closed PRs, 20 PR details, 30 runs, ...) exactly | Numbers match GitDash screens |
| **Full** | Follow `Link: rel="next"` and fetch the whole window | Better numbers, will not match GitDash |

GitDash mostly reads a **single page** and never follows `Link` headers (exceptions are called out). That is a
sampling choice, not a GitHub limit. [^pr-list-60]

---

## 1. Token, permissions and rate limits

### 1.1 Token choice

| Option | Use when | Notes |
|---|---|---|
| Fine-grained PAT | One person or one org, read-only | Select the repositories explicitly; org owners may require approval of the PAT |
| GitHub App installation token | Product used by many customers | Per-installation quota, no user seat. Install with the read permissions below |
| Classic PAT | Quick start only | `repo` for private repos (`public_repo` for public only); add `read:org` for org billing and org listings |

GitDash itself signs each user in with their own PAT. Its security code notes that a plain `repo` scope reads
Dependabot, code-scanning and secret-scanning alerts.[^sec-scope] GitHub returns 403 both for a missing permission and
for a disabled feature; GitDash tells them apart by message text (section 9).[^sec-403]

### 1.2 Minimum read permissions per metric

Repository permissions for a fine-grained PAT or App (all **Read-only**). `Metadata: read` is always implied. The
permission names below are GitHub's documented endpoint-to-permission mapping, **not** something derived from GitDash
code: confirm against "Permissions required for fine-grained personal access tokens" in the GitHub docs before
shipping.

| Metric | Fine-grained permission(s) | Classic scope |
|---|---|---|
| DORA, PR-based (PRs, reviews, releases) | Pull requests, Contents | `repo` |
| DORA, deployment-based | Deployments | `repo` |
| DORA / CI health (runs, jobs, workflows) | Actions | `repo` |
| PR health | Pull requests | `repo` |
| Bus factor | Contents | `repo` |
| Workload risk | Contents, Pull requests | `repo` |
| Issues health | Issues | `repo` |
| Security alerts | Dependabot alerts, Code scanning alerts, Secret scanning alerts (plus Advanced Security enabled on the repo) | `repo` (or `security_events`) |
| Actions billing | Organization `Administration` (read) | `read:org` |
| Repo / org enumeration | Metadata (repo list); org membership for `GET /user/orgs` | `read:org` |

Org-owned repos can also require SSO authorization of the token or approval of the fine-grained PAT. A repo the token
cannot see returns **404**, not 403.

### 1.3 Rate limits

| Topic | Guidance |
|---|---|
| Primary limit | 5,000 requests/hour for a user PAT. Check `GET /rate_limit` (free) and the `x-ratelimit-remaining` / `x-ratelimit-reset` headers. GitDash reads `resources.core` and `resources.graphql`[^rate-limit-route] |
| Conditional requests | Send `If-None-Match: <etag>`. A **304 does not count** against the limit. GitDash caches `{etag, link, data}` per `(token, url)` (max 1,000 entries) and replays it on 304[^etag] |
| Pagination | `per_page=100` (GitHub's maximum). Follow `Link: <...>; rel="next"` until absent. GitDash's own page loops are bounded (see each recipe) |
| Concurrency | Secondary limits punish bursts. GitDash caps fan-out at 5-10 concurrent requests[^concurrency], retries once after the advised wait on a primary or secondary limit, and on the second hit gives up so the route surfaces an error or partial data[^throttle] |
| Do not retry | 304, 400, 401, 403, 404, 422, 451[^throttle] |
| Cache immutable data | A commit's file list never changes. GitDash caches it 7 days[^bf-ttl]. Cache closed-PR data too |

#### Call budget per repo (parity mode, worst case)

| Recipe | Calls | Breakdown |
|---|---|---|
| DORA, PR-based | 62 | 1 `pulls` + 1 `releases` + 3 x 20 per-PR detail calls[^dora-fetch] |
| Open-PR health | 2 + N_open + 30 | 2 lists, 1 reviews call per open PR, 1 per merged PR in the sample of 30[^opr-reviews] |
| Bus factor | up to 303 | 3 commit-list pages + 1 `commits/{sha}` per commit not yet cached (300 max)[^bf-list] |
| Workload (90 d) | up to 21 | up to 20 commit pages + 1 open-PR list[^wl-pages] |
| Deployments | up to 41 | 1 list + up to 40 status calls[^dep-limits] |
| Job stats | 1 + completed runs | 1 runs call + 1 jobs call per completed run, batches of 8[^jobstats] |
| Issues | up to 3 | `page` 1-3[^issues-loop] |
| Security alerts | 6 | 3 open + 3 resolved lists[^sec-calls] |

#### Helper used in every snippet

```js
const GH = "https://api.github.com";
const H = {
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,   // $GITHUB_TOKEN placeholder, never hard-code
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};
async function gh(path, params = {}) {
  const url = new URL(path.startsWith("http") ? path : GH + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: H });
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${url}`), { status: res.status });
  return { data: await res.json(), link: res.headers.get("link") };
}
// Full mode: follow rel="next"
async function ghAll(path, params) {
  let out = [], next = null, first = true;
  while (first || next) {
    const r = await gh(next ?? path, first ? { per_page: 100, ...params } : {});
    out = out.concat(Array.isArray(r.data) ? r.data : r.data.workflow_runs ?? r.data.jobs ?? []);
    next = /<([^>]+)>;\s*rel="next"/.exec(r.link ?? "")?.[1] ?? null; first = false;
  }
  return out;
}
```

```bash
# Equivalent single call with curl
curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/OWNER/REPO/pulls?state=closed&per_page=60&sort=updated&direction=desc"
```

---

## 2. Endpoint catalog

`{o}/{r}` = `{owner}/{repo}`. "Octokit" is the method GitDash calls; the REST path is what you call.

| # | Method + path | Params GitDash sends | Consumed by | Permission |
|---|---|---|---|---|
| 1 | `GET /repos/{o}/{r}/pulls` | `state=closed per_page=60 sort=updated direction=desc` | DORA (PR-based), PR health abandon rate and review timing[^pr-list-60][^opr-lists] | Pull requests |
| 2 | `GET /repos/{o}/{r}/pulls` | `state=open per_page=100 sort=created direction=desc` | PR health open list[^opr-lists] | Pull requests |
| 3 | `GET /repos/{o}/{r}/pulls` | `state=open per_page=100` | Workload open-PR counts[^wl-open] | Pull requests |
| 4 | `GET /repos/{o}/{r}/pulls/{n}` | none | DORA PR scatter (`additions`, `deletions`)[^dora-fetch] | Pull requests |
| 5 | `GET /repos/{o}/{r}/pulls/{n}/commits` | `per_page=250` (GitHub caps at 100) | DORA first-commit time[^dora-fetch] | Pull requests |
| 6 | `GET /repos/{o}/{r}/pulls/{n}/reviews` | `per_page=100` (DORA, PR health) | DORA cycle breakdown, PR health[^dora-fetch][^opr-reviews] | Pull requests |
| 7 | `GET /repos/{o}/{r}/releases` | `per_page=30` | DORA deployment frequency[^dora-fetch] | Contents |
| 8 | `GET /repos/{o}/{r}/commits` | Bus factor: `since=now-90d per_page=100 page=1..3`. Workload: `since=now-{30,42,90}d per_page=100 page=1..cap` | Bus factor, workload[^bf-list][^wl-pages] | Contents |
| 9 | `GET /repos/{o}/{r}/commits/{sha}` | none (reads `files[].filename`) | Bus factor module mapping[^bf-detail] | Contents |
| 10 | `GET /repos/{o}/{r}/deployments` | `per_page=100` | Deployment DORA[^dep-limits] | Deployments |
| 11 | `GET /repos/{o}/{r}/deployments/{id}/statuses` | `per_page=10` | Deployment DORA[^dep-limits] | Deployments |
| 12 | `GET /repos/{o}/{r}/actions/runs` | Summary: `per_page=30`. Team and runner stats: `per_page<=100`/`<=50`, `status=completed` | CI success rate, durations, queue time, runner and team stats[^summary-runs][^runner-runs] | Actions |
| 13 | `GET /repos/{o}/{r}/actions/workflows` | `per_page=100` (list), `10` (overview), `1` (org count) | Workflow list, per-workflow overview[^workflows] | Actions |
| 14 | `GET /repos/{o}/{r}/actions/workflows/{id}/runs` | `per_page=50` default (runs, job stats), `20` (overview) | Workflow DORA tab, job stats, queue analysis[^list-runs] | Actions |
| 15 | `GET /repos/{o}/{r}/actions/runs/{run_id}/jobs` | `per_page=100` | Job, step and runner stats[^list-jobs] | Actions |
| 16 | `GET /repos/{o}/{r}/issues` | `state=all per_page=100 page=1..3 sort=updated direction=desc` | Issue health[^issues-loop] | Issues |
| 17 | `GET /repos/{o}/{r}/dependabot/alerts` | `per_page=100 state=open` and `state=fixed` | Security alerts[^sec-calls] | Dependabot alerts |
| 18 | `GET /repos/{o}/{r}/code-scanning/alerts` | `per_page=100 state=open` and `state=fixed` | Security alerts[^sec-calls] | Code scanning alerts |
| 19 | `GET /repos/{o}/{r}/secret-scanning/alerts` | `per_page=100 state=open` and `state=resolved` | Security alerts[^sec-calls] | Secret scanning alerts |
| 20 | `GET /orgs/{org}/settings/billing/actions` | none | Actions cost (returns 410 for orgs on the new billing system)[^billing] | Org Administration (read) |
| 21 | `GET /users/{username}/settings/billing/actions` | none | Personal Actions cost (deprecated, 410)[^billing] | `user` |
| 22 | `GET /orgs/{org}/repos` | `per_page=100 sort=updated direction=desc type=all` (paginated) | Org scorecard, org overview[^list-repos] | Metadata |
| 23 | `GET /user/repos` | same params, paginated | Repo picker[^list-repos] | Metadata |
| 24 | `GET /rate_limit` | none | Budget display[^rate-limit-route] | none |

Not covered here (not metric inputs): contributor-profile search, audit-log, security-scan YAML analysis,
create-issue, workflow-file history.

---

## 3. Shared conventions

| Convention | Rule |
|---|---|
| Interpolated percentile | `idx = p * (n-1)`; return `sorted[floor]` or linear interpolation between `floor` and `ceil`; `0` for an empty list. Used by DORA, PR health, queue analysis, issues[^pctl-interp] |
| Nearest-rank percentile | `sorted[ceil(p*n) - 1]` (clamped to range); `0` (job stats, runner stats) or `null` (fleet) when empty. Used by job/step stats, runner stats, 30-day p95, fleet KPIs[^pctl-nearest] |
| Weeks | Monday-start, UTC: `diff = (day == 0) ? -6 : 1 - day`[^week-start] |
| Rounding | Hours and rates are rounded at output only (1 decimal for hours/percent, integer for most percentages) |
| Bot test | `type == "Bot"`, or login ends `[bot]` (case-insensitive), or login in `{dependabot, renovate, github-actions}`[^bots] |
| `partial` | GitDash flags a response `partial` when a sub-fetch failed or a page cap was hit. Surface the same flag in your UI |

---

## 4. DORA

GitDash computes DORA three ways. Know which one you are reproducing.

| Variant | Source of truth | Where in GitDash |
|---|---|---|
| **A. PR-based (headline)** | Merged PRs + Releases | Repo overview, org scorecard, AI snapshots[^dora-callers] |
| **B. Deployment-based (measured)** | Deployments API | Repo overview Deployments panel[^dep-top] |
| **C. CI-based** | Workflow runs of one workflow | Workflow page "DORA" tab[^dora-callers] |

### 4.1 Levels (`BENCHMARKS` and the code that actually decides)

The levels are applied by functions, and the `BENCHMARKS` text strings now match them.

| Metric | Elite | High | Medium | Low | Source |
|---|---|---|---|---|---|
| Deployment frequency (per day) | `>= 1` | `>= 1/7` | `>= 1/30` | below | [^lvl-df] |
| Lead time (median) | `< 1 h` | `< 24 h` | `< 7 d` | `>= 7 d` | [^lvl-lt] |
| Change failure rate (%) | `<= 5` | `<= 15` | `<= 30` | `> 30` | [^lvl-cfr] |
| MTTR (mean) | `< 1 h` | `< 24 h` | `< 7 d` | `>= 7 d`; `null` (no failures) scores **High** | [^lvl-mttr] |
| Overall | worst of the four | | | | [^lvl-worst] |

### 4.2 Variant A: PR-based

**Inputs**

| Input | Request | Fields read |
|---|---|---|
| Closed PRs | `GET /pulls?state=closed&per_page=60&sort=updated&direction=desc` (one page) | `number title created_at merged_at head.ref` |
| Releases | `GET /releases?per_page=30` | `published_at` |
| Per-PR detail, first 20 merged PRs only | `/pulls/{n}/commits`, `/pulls/{n}/reviews`, `/pulls/{n}` | `commit.author.date` (fallback `commit.committer.date`), `submitted_at`, `state`, `additions`, `deletions` |

**Preparation**

1. `mergedPrs` = closed PRs with `merged_at != null`, in the order GitHub returned them (updated-desc, **not** merge order).[^dora-fetch]
2. `releases` = releases with `published_at != null`.
3. `detailPrs` = the first **20** of `mergedPrs`; fetch detail with concurrency 10. A failed PR is skipped and `partial = true`.[^dora-fetch]
4. Per PR: `first_commit_at` = minimum commit date over the commits returned (page 1 only). `first_review_at` = earliest `submitted_at` among reviews with a non-null `submitted_at`. `approved_at` = `submitted_at` of the **first** review with `state == "APPROVED"` in that sorted order.[^dora-fetch]

**1. Deployment frequency**

```
deployTs   = releases.length > 0 ? sorted(published_at) : sorted(merged_at of mergedPrs)
periodDays = deployTs.length >= 2 ? max(1, (last - first) / 86_400_000) : 30
perDay     = deployTs.length / periodDays        // output rounded to 2 decimals
```

If you have no releases, the number is a merge rate, not a deploy rate (GitDash says so in its UI).[^dora-df]

**2. Lead time for changes**

```
for pr in mergedPrs (all, up to 60):
  start = detail?.first_commit_at ?? pr.created_at     // only the 20 detailed PRs have first_commit_at
  lt    = merged_at - start; keep if lt > 0
median = interpolatedPercentile(sorted(lt), 0.5);  p95 = interpolatedPercentile(sorted(lt), 0.95)
```

Output `median_ms`, `p95_ms`, `sample_size`. Level from the median.[^dora-lt]

**3. Change failure rate**

```
isFailure(pr) = /hotfix|revert|fix-prod|emergency/i.test(pr.head.ref) || pr.title.toLowerCase().startsWith("revert ")
cfr = failures / mergedPrs.length * 100          // 0 when there are no merged PRs; output 1 decimal
```

This is a naming heuristic: a team that does not name branches this way scores exactly 0%.[^dora-cfr]

**4. MTTR**

```
recovery = for each failure PR: merged_at - created_at   // keep > 0
mttr = mean(recovery) rounded to ms, or null when empty
```

This measures how fast the fix PR merged, not incident duration.[^dora-mttr]

**5. PR cycle-time breakdown** (only PRs present in the 20-PR detail map)

| Phase | Formula (all clamped `max(0, ...)`) | Missing data |
|---|---|---|
| `time_to_open` | `created_at - first_commit` | `first_commit` falls back to `created_at` (0) |
| `pickup` | `first_review - created_at` | `0` if no review |
| `review` | `approved - first_review` | `0` unless both exist |
| `merge` | `merged_at - mergeFrom`, `mergeFrom = approved ?? first_review ?? created_at` | |

`avg_*_ms` = arithmetic mean over the sampled PRs (rounded), `sample_size` <= 20.[^dora-cycle]

**6. Throughput and scatter**

| Output | Rule |
|---|---|
| `throughput_by_week` | 12 buckets: for `i = 11..0`, `week_start(now - 7i days)`. Count `mergedPrs` per `week_start(merged_at)`; PRs outside the 12 buckets are dropped[^dora-tp] |
| `pr_scatter` | Only PRs with detail: `loc = additions + deletions`, `hours_to_merge = (merged_at - created_at)/3.6e6` (1 decimal). Dropped if `loc <= 0` or `hours <= 0`[^dora-scatter] |

**Worked example**

Releases published 09-01, 09-08, 09-15, 09-22, 09-29 (28 days apart end to end): `perDay = 5/28 = 0.18` -> **High**
(`>= 1/7 = 0.143`). Four PRs with lead times 2 h, 6 h, 30 h, 50 h: median index `0.5*3 = 1.5` -> `6 + (30-6)*0.5 = 18 h`
-> **High**; p95 index `2.85` -> `30 + 20*0.85 = 47 h`. Ten merged PRs, one with head ref `hotfix/login`: CFR `10%` ->
**High**. That hotfix PR opened 09:00, merged 10:30: MTTR `1.5 h` -> **High** (`>= 1 h`). Overall = worst of four =
**High**. One PR: first commit 08:00, opened 10:00, first review 11:00, approved 14:00, merged 15:00 -> `time_to_open 2h`,
`pickup 1h`, `review 3h`, `merge 1h`. A PR with no review, opened 10:00 and merged 12:00 -> `pickup 0`, `review 0`,
`merge 2h`.

**Edge cases**

| Case | Behavior |
|---|---|
| Fewer than 2 deploy timestamps | `periodDays = 30` |
| No PRs | Rates are 0, `mttr = null`; overall level still computed |
| Detail call rate-limited | PR missing from `detailMap`; lead time falls back to `created_at`, cycle and scatter skip it |
| Commit date source | `commit.author.date`, so rebased or cherry-picked commits can predate the PR |
| Review states | `COMMENTED` and `CHANGES_REQUESTED` count for first review; only `APPROVED` sets `approved_at` |

### 4.3 Variant B: deployment-based (measured)

**Inputs**: `GET /deployments?per_page=100` (one page, newest first) and `GET /deployments/{id}/statuses?per_page=10`
(index 0 = current state).[^dep-limits]

```
window     = deployments with created_at >= now - 30d          // DEFAULT_PERIOD_DAYS = 30
if window empty: source = "stale" (history exists) | "none"     // report separately, never as 0
prodEnv    = pick(window): first pattern in [/\bproduction\b/i, /\bprod\b/i, /\blive\b/i, /\bmain\b/i]
             that matches any env name (busiest matching env wins); else busiest env overall
resolve    = prod deployments first, then others, capped at 40 status calls (concurrency 8)
state      = statuses[0].state                                  // success | failure | error | pending | in_progress | inactive
prodSuccess = count state == success ; prodFailed = count state in {failure, error}
conclusive  = prodSuccess + prodFailed
deploys_per_day         = conclusive > 0 ? round2(prodSuccess / 30) : null
change_failure_rate_pct = conclusive > 0 ? round(prodFailed / conclusive * 100) : null
```

**MTTR**: sort the environment's deployments by `created_at`. Timestamp per record = `status_at ?? created_at`. The first
failure of a streak sets `failedAt`; the next success with `ts > failedAt` adds `(ts - failedAt)/3.6e6` hours and clears
it. `mttr_hours` = mean, 1 decimal; `mttr_samples` = number of pairs.[^dep-mttr]

**Worked example**: 12 production deployments in 30 days: 9 `success`, 1 `failure`, 2 `pending`. `conclusive = 10`;
`deploys_per_day = 9/30 = 0.30`; CFR `= 1/10 = 10%`. The failure's status landed 10:00, the next success 13:00: MTTR `3.0 h`,
1 sample (1 is not a trend).

**Edge cases**: a `404` on the deployments list returns `source: "none"` (not an error); `partial = true` when a status
call fails or the window holds more deployments than the 40-call budget; deployments are only created when a job
declares `environment:` or something calls the Deployments API, so Actions deploys from plain `run:` steps are invisible.[^dep-top]

### 4.4 Variant C: CI-based (one workflow)

**Input**: `GET /actions/workflows/{id}/runs?per_page=N` (N = 10..100, default 50 in the UI). No branch filter and no
30-day window is applied; the function uses whatever runs it is given.[^dora-ci][^runs-page]

```
completed  = runs with status == "completed"; sorted by created_at asc
periodDays = completed.length >= 2 ? max(1, (last.created - first.created)/86.4e6) : 1
perDay     = completed.length / periodDays                        // every completed run counts, any conclusion
lead_time  = (run_started_at ?? created_at) + duration_ms - created_at     // = queue wait + execution; keep > 0
             only runs with head_commit.author present
CFR        = count(conclusion == "failure") / completed.length * 100     // timed_out is NOT a failure here
MTTR       = per head_branch: first failure's created_at -> next success's created_at; mean over all pairs
```

`duration_ms` = `(completed_at ?? updated_at) - (run_started_at ?? created_at)` for completed runs (section 8).[^dora-ci][^list-runs-calc]
The "lead time" here is queue + run time of the CI run itself, **not** commit-to-production.

---

## 5. PR health

**Inputs**: open PRs (endpoint 2), the 60 most recently updated closed PRs (endpoint 1), and
`GET /pulls/{n}/reviews?per_page=100` for every open PR and for the first **30** merged PRs (concurrency 5).[^opr-lists][^opr-reviews]

### 5.1 Per open PR

| Field | Formula |
|---|---|
| `age_hours` | `(now - created_at)/3.6e6`, 1 decimal[^opr-age] |
| `has_review` | `reviews.length > 0` (any state) |
| `review_rounds` | `reviews.filter(submitted_at).length` (submissions, not request/response cycles) |
| `draft` | `pr.draft ?? false` |
| `author` | `pr.user.login`, else `"unknown"` |

Open PRs are sorted by `age_hours` descending in the response.[^opr-out]

### 5.2 Benchmarks from merged PRs (sample = first 30 merged of the 60 closed)

| Metric | Formula |
|---|---|
| Time to first review | Sort reviews with `submitted_at`; `(sorted[0].submitted_at - created_at)/3.6e6`; keep if `> 0`[^opr-ttfr] |
| Approval to merge | First `APPROVED` review in that order; `(merged_at - approval.submitted_at)/3.6e6`; keep if `> 0`[^opr-atm] |
| P50 / P90 | Interpolated percentile over the kept values, rounded to 1 decimal; `0` if none[^opr-out] |
| Review rounds (merged) | `sorted.length`; bucket `"0" "1" "2" "3+"`[^opr-rounds] |
| Abandon rate | `closed without merged_at / closed.length` over all 60 closed, rounded to an integer %[^opr-abandon] |
| Concurrent PRs per author | Count of fetched open PRs per `user.login`, sorted descending[^opr-conc] |

**Age buckets** (hours, lower bound inclusive, upper exclusive): `<1 day` [0,24), `1-3 days` [24,72), `3-7 days`
[72,168), `1-2 weeks` [168,336), `2+ weeks` [336, inf).[^opr-buckets]

### 5.3 Thresholds applied in the UI (not in the API)

| Rule | Value |
|---|---|
| **Stale & unreviewed** | `age_hours > 120 && !has_review && !draft`. The label says "5 business days"; the code is 120 **calendar** hours[^stale-ui] |
| Concurrent PRs per author | Amber at `>= 3`, red at `>= 5`[^conc-ui] |

**Worked example**: an open PR created 2026-09-28 08:00Z, evaluated 2026-10-02 08:00Z, has `age_hours = 96.0` ->
bucket `3-7 days`, not stale (`96 < 120`). Merged-PR time-to-first-review samples `[1, 2, 4, 10, 30]` h -> P50 index 2 -> `4.0`;
P90 index `3.6` -> `10 + (30-10)*0.6 = 22.0 h`. 12 of 60 closed PRs have no `merged_at` -> abandon rate `20`.

**Edge cases**: a failed reviews call drops that PR and sets `partial = true` (`fetched_prs` / `total_prs_attempted` give
coverage); `per_page=100` caps open PRs at 100 and reviews at 100 per PR with no pagination; `closed` ordering is
by `updated`, so a recently commented old PR displaces a recent merge from the 60-row window.[^opr-out]

---

## 6. Bus factor

**Inputs**: `GET /commits?since=<now-90d>&per_page=100&page=1..3` (stop at 300 commits or an empty page), then
`GET /commits/{sha}` once per commit for `files[].filename`.[^bf-list][^bf-detail]

### 6.1 Algorithm

1. Window: **last 90 days**, at most **300** commits (3 pages x 100).
2. Author per commit: `author.login`, else `commit.author.name`, else `"unknown"`.
3. Commits whose detail call fails are dropped (`partial = true`, `fetched_commits < total_commits_listed`). Merge commits
   are **not** excluded.
4. Module of a file: `parts = path.split("/")`; `1 part -> "(root)"`; `2 parts -> parts[0]`; else `parts[0]/parts[1]`.[^bf-module]
5. A commit counts **once per module** it touches, credited to its author.[^bf-count]
6. Per module: `total = sum`, contributors sorted by commits desc, `pct = round(commits/total*100)`.
7. Bus factor = smallest `k` such that the top-k contributors hold `>= 80%` of module commits.[^bf-bf]
8. Risk: `bus_factor <= 1 -> critical`, `<= 2 -> warning`, else `healthy`.[^bf-risk]
9. Output: modules sorted critical first then by `total_commits` desc, top **30** modules, top **5** contributors each.[^bf-sort]
10. `overall_bus_factor`: same 80% rule over per-author counts of all fetched commits.[^bf-overall]

**Bots**: GitDash's bus-factor code does **not** apply the bot rule from `bots.ts`; bot authors count like anyone else
(section 11). If you want bots excluded, filter with the rule in section 3.

**Worked example**: module `src/lib`, 20 commits: alice 12, bob 5, carol 3. Threshold `0.8*20 = 16`. Cumulative `12`
(< 16), `17` (>= 16) -> bus factor **2**, risk **warning**, `pct = 60/25/15`. Overall repo with 100 commits split
alice 55, bob 20, carol 10, dan 15: cumulative 55, 75, 90 (>= 80) -> overall bus factor **3**.

**Edge cases**: no resolvable commits -> all zeros and empty `modules`; the 300-commit cap means a busy repo reflects less
than 90 days; GitHub omits `files` beyond 300 per commit.

---

## 7. Workload risk

**Inputs**: `GET /commits?since=<now-W d>&per_page=100&page=1..cap` and `GET /pulls?state=open&per_page=100`.[^wl-pages][^wl-open]

### 7.1 Constants

| Constant | Value |
|---|---|
| `AFTER_HOURS_THRESHOLD` | `0.30` (>= 30% of commits outside the workday)[^wl-const] |
| `WEEKEND_THRESHOLD` | `0.25` |
| `MIN_SAMPLE` | `5` commits before after-hours or weekend can flag |
| `CONCURRENT_PR_OVERLOAD` | `4` open PRs |
| `RECENT_DAYS` | `14` |
| Window `W` and page cap | 30 d -> 10 pages; 42 d (legacy) -> 5; 90 d -> 20[^wl-cap] |
| Default workday | Timezone `Asia/Saigon`, start `8`, end `19` (hour `[8,19)`)[^workday-default] |

The workday is an org setting. For a UTC 09:00-18:00 rule use `{timezone:"UTC", start:9, end:18}` (the pre-setting
legacy rule).[^workday-legacy]

### 7.2 Algorithm

1. For each commit: `login = author.login ?? commit.author.name ?? "unknown"`; `date = commit.author.date ?? commit.committer.date`
   (skip the commit if neither exists). Commits without a linked GitHub account are flagged `unlinked_name`.[^wl-loop]
2. Local hour and weekday in the workday timezone (`Intl.DateTimeFormat`, `hourCycle: h23`).[^workday-local]
3. `afterHours = hour < start || hour >= end`; `weekend = weekday is Sat or Sun` (local).[^workday-classify]
4. `recent` if `date >= now - 14d`, else `prior`.[^wl-loop]
5. Stop paging when a page has fewer than 100 rows. If page `cap` is reached with a full page, `partial = true`.[^wl-loop]
6. Open PRs: count per `pr.user.login` (a failure here is ignored; counts become 0).[^wl-open]
7. Per person: `after_hours_pct = round(afterHours/total*100)`, `weekend_pct = round(weekend/total*100)`.[^wl-person]
8. Flags:[^wl-flags]

| Flag | Rule |
|---|---|
| `after_hours` | `total >= 5 && after_hours_pct/100 >= 0.30` |
| `weekend` | `total >= 5 && weekend_pct/100 >= 0.25` |
| `concurrent_pr_overload` | `open_pr_count >= 4` |
| `activity_cliff` | `prior >= 3 && recent === 0` (disabled when `partial`) |

9. `risk_score` = number of true flags; sort by `risk_score` desc then `total_commits` desc.[^wl-person]

Percentages are rounded **before** the threshold test: a person at 29.6% rounds to 30 and flags.

**Bots**: the code flags bots (`is_bot`) and keeps each bot as its own row, never merged with a human; it does **not**
drop them. The UI drops them where it renders risk.[^wl-bots] Your application must filter `is_bot`.

**Worked example** (30 days, Saigon 08-19): 10 commits, 4 outside 08:00-19:00 local (40%, flags), 2 on Sat/Sun (20%, no
flag). A commit at `2026-09-27T14:30:00Z` is `21:30` Sunday in Saigon -> after-hours **and** weekend. 4 open PRs ->
overload. `prior = 6`, `recent = 4` -> no cliff. `risk_score = 2`.

**Edge cases**: account linking (merging several logins into one person) uses GitDash's own database and cannot be
reproduced from GitHub alone (section 10); people with no commits in the window do not appear.

---

## 8. CI health

### 8.1 Run fields and derived times

| Value | Formula | Source |
|---|---|---|
| Duration (workflow runs list) | `completed` runs only: `(completed_at ?? updated_at) - (run_started_at ?? created_at)` | [^list-runs-calc] |
| Queue wait (workflow runs list) | `run_started_at - created_at`; `undefined` when `run_started_at` is missing | [^list-runs-calc] |
| Duration (repo summary point) | `status == completed && updated >= run_started_at ? updated_at - run_started_at : null` | [^run-point] |
| Queue (repo summary point) | `run_started_at >= created_at ? run_started_at - created_at : null` | [^run-point] |
| Job duration | `completed_at - started_at` when both exist, else `null` | [^list-jobs-calc] |

### 8.2 Success rate (several definitions)

GitDash uses different denominators in different places; reproduce the one matching the screen.

| Metric | Window and denominator | Output | Source |
|---|---|---|---|
| `success_rate` (repo or workflow card) | Last 10 **completed** runs (any conclusion, cancelled and skipped included) | integer %, `0` if none | [^success10] |
| `success_rate_30d` | Completed runs with `created_at >= now - 30d` among the 30 fetched | 1 decimal %, `null` if none | [^window-fields] |
| `runs_30d` / `p95_duration_ms` | Same window; p95 is nearest-rank over durations | count / ms | [^window-fields] |
| Fleet KPIs | Completed runs excluding `skipped` and `cancelled`; `p95` nearest-rank on durations and queue | % | [^fleet-stats] |
| Team stats (per actor) | `success / (success + failure)`; other conclusions ignored | integer % | [^team-rate] |
| `trend_30d` | Per `created_at` UTC day, completed runs in last 30 d: `{success, total}` | list | [^trend30] |

Repo summary input is `GET /actions/runs?per_page=30` (all workflows, newest first, one page).[^summary-runs]
**Worked example**: 25 completed runs in 30 days, 21 `success` -> `round(21/25*1000)/10 = 84.0`. p95 over 25 sorted durations:
index `ceil(0.95*25) - 1 = 23` -> the 24th smallest value.

### 8.3 Repo health state (table pill)

Evaluate in this order; first match wins:[^repo-health]

| # | Condition | State |
|---|---|---|
| 1 | No runs, or `latest_run_at` older than 30 days | No recent runs |
| 2 | Newest run `status == in_progress` | Running |
| 3 | Newest run status in `{queued, waiting, requested, pending}` | Queued |
| 4 | Else the newest **decisive** run among the 10 most recent (completed with `success` or a failure conclusion; cancelled and skipped are ignored) decides: failure conclusions are `failure`, `timed_out`, `startup_failure` | Failing / Passing |
| 5 | No decisive run | No recent runs |

### 8.4 Queue analysis (computed over fetched workflow runs)

| Output | Rule |
|---|---|
| Included runs | Only `queue_wait_ms > 0` |
| `avg`, `p50`, `p95`, `max` | Mean (rounded), interpolated percentiles (rounded), max |
| `delayed` | `queue_wait_ms > 300_000` (5 min); `delayed_pct` 1 decimal |
| Heatmap | 7 x 24 grid on **UTC** `getUTCDay` / `getUTCHours` of `created_at`, mean wait per cell |
| Branch impact | Per `head_branch ?? "unknown"`: `runs`, `avg`, `p95`, `delayed`, `wasted_min = sum(waits > 5 min)/60000`; ranked by `avg*runs`, top 10 |
| Distribution buckets (upper bound, inclusive) | `<10s`, `10s-30s`, `30s-1m`, `1m-2m`, `2m-5m`, `5m-10m`, `>10m` |
| Cost estimate | `hours = sum(waits)/3.6e6`; `cost = round(hours * 75)` (USD per hour is a default parameter) |

All from [^queue-analysis].

### 8.5 Job, step and runner stats

**Inputs**: workflow runs (`per_page` default 50; the UI sends at most 30 to the job-stats route), then
`GET /actions/runs/{run_id}/jobs?per_page=100` for each **completed** run, in batches of 8.[^jobstats][^job-route]

| Output | Rule |
|---|---|
| Per job name | `runs = success + failure` (only those two conclusions count); `avg_ms` = mean of non-null durations (rounded); `p50`, `p95` nearest-rank; `max_ms`[^jobstats-agg] |
| Per step | Keyed `jobName::stepName`; same stats with `p95` and `max`; `success` counts[^jobstats-agg] |
| Waterfall | First 20 runs: jobs with non-null duration |

**Runner stats**: `GET /actions/runs?status=completed&per_page=min(n,50)` (default 30), jobs for each run (concurrency 8).
Group jobs by `runner_name ?? "(unassigned)"`; `job_count`, `success`, `failure`, mean and nearest-rank p95 of durations;
`runner_group_name` is taken from the first job seen for that runner. `partial` when fewer job fetches succeeded
than runs.[^runner-calc]

**Team CI stats** (`team-stats`): `GET /actions/runs?status=completed&per_page<=100`; group by `actor.login` (skip null
actor); per contributor: success, failure, mean duration (kept if `> 0`), mean queue wait (kept if `>= 0`), run counts by
UTC weekday and UTC hour, `busiest_hour` = first hour holding the max; `most_reliable` = highest success rate among
contributors with `>= 5` runs; `period_days = max(1, round((now - oldestRun.created_at)/86.4e6))`.[^team-stats]

### 8.6 Actions cost (optional)

| Step | Rule |
|---|---|
| Rates (USD/min) | `UBUNTU 0.008`, `MACOS 0.08`, `WINDOWS 0.016`; unknown OS uses Ubuntu[^cost-rates] |
| Cost | `paidRatio = total_paid_minutes_used / total_minutes_used`; per runner `minutes * paidRatio * rate`; sum[^cost-calc] |
| Burn rate | `daily = used / daysElapsed`; `projected = round(daily * 30)`; `overage = max(0, projected - included)`; status `critical` if `projected/included > 1.2`, `warning` if `> 0.9`[^cost-burn] |

Input is endpoint 20; both billing endpoints can return 410 for accounts on the newer billing platform, which GitDash
reports as "deprecated" instead of an error.[^billing] Rates are standard-runner prices; larger runners cost more.

---

## 9. Issues and security (supporting recipes)

### 9.1 Issues

`GET /issues?state=all&per_page=100&page=1..3&sort=updated&direction=desc`. **Drop every item that has a `pull_request` key**
(the issues API returns PRs).[^issues-filter]

| Output | Rule |
|---|---|
| Window | `period_days` = request `days` clamped to `[7, 90]`, default 30[^issues-days] |
| `closed_in_period` / `opened_in_period` | `closed_at` / `created_at` within window; `backlog_delta = opened - closed`[^issues-win] |
| `median_days_to_close`, `p90` | Interpolated percentile over `closed_at - created_at` (days, keep `>= 0`) for issues closed in the window, 1 decimal[^issues-close] |
| `stale_count` | open and `daysSince(updated_at) >= 30`[^issues-const] |
| `unanswered_count` | open, `comments == 0`, `daysSince(created_at) >= 14` |
| `unlabelled_count` | open with no label |
| Age buckets (days) | `<1wk` [0,7), `1-4wk` [7,30), `1-3mo` [30,90), `>3mo` [90,inf) |
| `partial` | The 3-page cap was hit before a short page (quiet old issues unseen) |

### 9.2 Security alerts

| Rule | Value |
|---|---|
| Sources | Dependabot, code scanning, secret scanning; open and resolved lists fetched separately[^sec-calls] |
| Severity mapping | `critical`; `high`/`error` -> high; `medium`/`moderate`/`warning` -> medium; else low[^sec-sev] |
| Dependabot severity | `security_advisory.severity`; code scanning prefers `rule.security_severity_level` over `rule.severity`; secret scanning is always `critical`[^sec-secret] |
| `fixed_last_90d` | Dependabot: `fixed_at` within 90 d. Code and secret scanning: `updated_at` within 90 d (proxy)[^sec-fixed] |
| `mttr_days` | Mean of `(fixed_at - created_at)` in days over those, 1 decimal; `null` if none[^sec-mttr] |
| Status per source | `ok`; 403 with "must be enabled" or similar -> `not_enabled`; other 403 -> `forbidden`; 404 -> `not_enabled`; else `error`[^sec-403] |
| `partial` | any source not `ok`; `needs_scope` when any is `forbidden` |

Never treat an unreadable source as "zero alerts"; GitDash reports status per source for that reason.

### 9.3 Composite org scorecard (derived)

`composite = round(0.6 * doraScore + 0.4 * busFactorScore)`; `doraScore = {elite 100, high 75, medium 50, low 25}`;
`busFactorScore = bf <= 1 ? 25 : bf <= 2 ? 60 : 100`; band `>= 80` healthy, `>= 50` watch, else at risk. Trend compares the
mean of the older half of the 12 throughput weeks with the newer half: `+15%` up, `-15%` down, else flat; fewer than 4 weeks is
flat; prior mean 0 with recent > 0 counts as `delta = 1`.[^scorecard]

---

## 10. What GitHub can't give you

These GitDash numbers come from GitDash's own Postgres (Neon), populated by scheduled syncs. A single API pull cannot
reproduce them because GitHub does not retain or aggregate the history for you.

| GitDash surface | Why a single API pull cannot reproduce it | What you build instead |
|---|---|---|
| `GET /api/db/trends` (daily and quarterly rollups, org trends) | Aggregates a stored `runs` table (`COUNT`, `AVG(duration_ms)`, `AVG(queue_wait_ms)` per day, quarterly summary). The live runs API returns recent pages, so long-range trends need your own accumulated copy[^db-trends] | Cron: page `GET /actions/runs` and upsert by run id; aggregate in SQL. GitDash syncs daily at 03:17 UTC, up to 5 pages x 100 per repo per run[^sync-runs][^cron-times] |
| `GET /api/db/runs` | Reads that stored table, not GitHub | Same store |
| Working habits (`/api/db/working-habits`) | Needs per-commit size (files, additions, deletions) for commits inside merged PRs, synced daily. Counting rules: oversized when files `> 10` or lines `> 200`, PR oversized above `20` commits (defaults, org-editable); bots and merge commits excluded[^wh-rules][^wh-defaults] | Store `pulls/{n}/commits` plus `commits/{sha}` stats per merged PR |
| Synced PR facts (people alerts, digest) | Per-PR `first_review_at`, `approved_at`, sizes, `review_count`, `commit_count`, `changed_files`, kept for all PRs. Backfill pages 10 x 100 PRs per run with concurrency 5, then incremental by `updated_at`[^pr-facts] | Maintain a PR-facts table; backfill once |
| Alert rules and digests | Evaluated against stored runs and PR facts on a schedule; thresholds live in the database | Your own rule engine |
| Account links / `person_key` | One person with several GitHub logins is merged by a mapping stored in GitDash; GitHub has no such concept[^wl-link] | Your identity table |
| Org workday setting | Stored per org in GitDash settings; default is Asia/Saigon 08-19[^workday-default] | Your own config |
| Team insights 30/90-day views for merged PRs | Read through GraphQL search and cached (not covered by this REST guide)[^team-gql] | Use `search` or GraphQL, then your own aggregation |
| Cached numbers | Every route caches results in memory (per token) and optionally in Postgres; two requests minutes apart can differ[^cache-ttl] | Pick your own TTL |

GitHub features GitDash does not use but that help you reproduce history: `created=>=YYYY-MM-DD` and `branch`/`event`
filters on the runs endpoints, and `If-None-Match` on list pages. Check the GitHub REST docs before relying on them.

---

## 11. In-app docs corrections and remaining caveats

The in-app docs (`src/app/docs/_parts/metrics.tsx`, `api-reference.tsx`) and the `BENCHMARKS` strings in `dora.ts` were
corrected to match the code alongside this guide: bus factor (80% coverage, not HHI), after-hours window (org workday),
stale PR (120 calendar hours), CI-based DORA definitions, PR lead-time sampling, review rounds, and level text.[^bf-bf][^workday-default][^stale-ui][^dora-ci][^dora-lt][^lvl-lt]

Caveats that remain by design:

| Topic | Behavior | Source |
|---|---|---|
| Concurrent PR flag | Red at `>= 5` on the PR-health screen; workload flag at `>= 4` (API). Two rules for two surfaces | [^conc-ui] vs [^wl-const] |
| Bus factor bots | Bus factor does not call `isBot`; bot commits are counted | [^bots] vs [^bf-list] |
| Review P50 `< 4 hours` | A benchmark target in the docs text, not enforced in code | [^docs-pr] |

---

## 12. Implementation checklist

1. Create the token (section 1.2), store it as `GITHUB_TOKEN`, and never log it.
2. Pick parity or full mode per metric (intro).
3. Add an ETag cache keyed by `(token, url)` and replay on 304.
4. Cap concurrency at 5-10 and back off on 403/429 using `retry-after` and `x-ratelimit-reset`.
5. Port the shared helpers (section 3): both percentile flavors, `week_start`, bot rule.
6. Implement recipes: DORA variants A/B/C (4), PR health (5), bus factor (6), workload (7), CI (8).
7. Persist run and PR history yourself if you need trends (section 10).
8. Validate against the worked examples above before comparing with GitDash screens.

---

## References

[^pr-list-60]: `src/lib/github-dora.ts:36` (closed PR list; `per_page: 60` at line 40, `sort: "updated"`, `direction: "desc"`; no pagination).
[^sec-scope]: `src/lib/security-alerts.ts:13` (plain `repo` scope reads all three alert endpoints).
[^sec-403]: `src/lib/security-alerts.ts:106` (disabled-feature pattern), `src/lib/security-alerts.ts:109` (`statusFromError`).
[^rate-limit-route]: `src/app/api/github/rate-limit/route.ts:30` (`GET /rate_limit`), `src/app/api/github/rate-limit/route.ts:33` (core and graphql fields).
[^etag]: `src/lib/github.ts:10` (ETag layer description), `src/lib/github.ts:24` (`ETAG_MAX_ENTRIES = 1000`), `src/lib/github.ts:98` (`If-None-Match` replay), `src/lib/github.ts:110` (304 replay).
[^concurrency]: `src/lib/github-dora.ts:18` (concurrency 10), `src/app/api/github/open-pr-health/route.ts:12` (5), `src/lib/bus-factor.ts:68` (10), `src/app/api/github/runner-stats/route.ts:98` (8), `src/lib/deployments.ts:281` (8).
[^throttle]: `src/lib/github.ts:63` (`onRateLimit`, retry once), `src/lib/github.ts:70` (`doNotRetry` list).
[^bf-ttl]: `src/lib/bus-factor.ts:13` (`COMMIT_FILES_TTL = 7 * 24 * 3600`).
[^dora-fetch]: `src/lib/dora.ts:328` (`DORA_PR_DETAIL_LIMIT = 20`), `src/lib/github-dora.ts:44` (releases `per_page: 30`), `src/lib/dora.ts:340` (`toMergedPrInputs`), `src/lib/dora.ts:353` (`toReleaseInputs`), `src/lib/github-dora.ts:51` (first 20), `src/lib/github-dora.ts:57` (commits; `per_page: 250` at line 61), `src/lib/github-dora.ts:63` (reviews; `per_page: 100` at line 67), `src/lib/github-dora.ts:69` (`pulls.get`), `src/lib/dora.ts:363` (`toPrDetail`), `src/lib/dora.ts:370` (first commit date), `src/lib/dora.ts:376` (review sort), `src/lib/dora.ts:383` (first review and approval), `src/lib/github-dora.ts:77` (rejected count), `src/lib/github-dora.ts:86` (`partial`).
[^opr-reviews]: `src/app/api/github/open-pr-health/route.ts:84` (open PR reviews), `src/app/api/github/open-pr-health/route.ts:101` (`mergedReviewSample`), `src/app/api/github/open-pr-health/route.ts:104` (merged PR reviews), `src/lib/pr-health.ts:87` (`MERGED_REVIEW_SAMPLE = 30`).
[^bf-list]: `src/lib/bus-factor.ts:24` (90-day `since`), `src/lib/bus-factor.ts:29` (3 pages, 300 cap), `src/lib/bus-factor.ts:30` (`listCommits`), `src/lib/bus-factor-core.ts:62` (author fallback). Neither `bus-factor.ts` nor `bus-factor-core.ts` imports `bots.ts`.
[^wl-pages]: `src/lib/team-workload.ts:34` (`PAGE_CAP`), `src/lib/team-workload.ts:45` (`maxPages`), `src/lib/team-workload.ts:50` (`listCommits`).
[^dep-limits]: `src/lib/deployments.ts:111` (`MAX_STATUS_LOOKUPS = 40`), `src/lib/deployments.ts:113` (`DEFAULT_PERIOD_DAYS = 30`), `src/lib/deployments.ts:220` (list, `per_page: 100`), `src/lib/deployments.ts:276` (statuses, `per_page: 10`).
[^jobstats]: `src/lib/github.ts:536` (`getJobStats`), `src/lib/github.ts:544` (runs first), `src/lib/github.ts:551` (batches of 8).
[^issues-loop]: `src/lib/issues.ts:73` (`MAX_PAGES = 3`), `src/lib/issues.ts:136` (`listForRepo` params).
[^sec-calls]: `src/lib/security-alerts.ts:157` (open), `src/lib/security-alerts.ts:165` (fixed / resolved).
[^opr-lists]: `src/app/api/github/open-pr-health/route.ts:59` (open list), `src/app/api/github/open-pr-health/route.ts:67` (closed list).
[^wl-open]: `src/lib/team-workload.ts:64` (open-PR list inside `try`, failure ignored), `src/lib/team-workload.ts:66` (call), `src/lib/team-workload-core.ts:123` (`countOpenPrsByAuthor`).
[^summary-runs]: `src/lib/github.ts:296` (`listWorkflowRunsForRepo`, `per_page: 30`), `src/lib/workflow-run-stats.ts:98` (`buildRepoSummary`).
[^runner-runs]: `src/app/api/github/runner-stats/route.ts:88` (`status: "completed"`), `src/app/api/github/team-stats/route.ts:84` (`status: "completed"`), `src/lib/validation.ts:76` (`validatePerPage`, clamp 100).
[^workflows]: `src/lib/github.ts:454` (list, `per_page: 100`), `src/lib/github.ts:328` (overview, `per_page: 10`), `src/app/api/github/org-overview/route.ts:73` (`per_page: 1`).
[^list-runs]: `src/lib/github.ts:466` (`listWorkflowRuns`; default `per_page = 50` at line 471), `src/lib/github.ts:341` (overview, `per_page: 20`), `src/lib/workflow-run-stats.ts:118` (`toWorkflowRun`).
[^list-jobs]: `src/lib/github.ts:495` (`listJobsForWorkflowRun`, `per_page: 100`).
[^billing]: `src/app/api/github/billing/route.ts:49` (org billing), `src/app/api/github/billing/route.ts:83` (user billing), `src/app/api/github/billing/route.ts:70` (410 handling).
[^list-repos]: `src/lib/github.ts:409` (user repos paginated), `src/lib/github.ts:425` (org repos paginated), `src/lib/github.ts:414` (params).
[^pctl-interp]: `src/lib/dora.ts:157`, `src/lib/pr-health.ts:95`, `src/lib/queue-analysis.ts:50`, `src/lib/issues.ts:87`.
[^pctl-nearest]: `src/lib/github.ts:531`, `src/app/api/github/runner-stats/route.ts:41`, `src/lib/utils.ts:109`, `src/lib/workflow-run-stats.ts:66`.
[^week-start]: `src/lib/dora.ts:438` (`getWeekStart`).
[^bots]: `src/lib/bots.ts:12` (`BOT_LOGINS`), `src/lib/bots.ts:15` (`isBot`).
[^dora-callers]: `src/lib/github-dora.ts:83` (`calculateRepoDora`), `src/lib/org-health-scorecard.ts:80`, `src/lib/ai-snapshots.ts:158`, `src/app/repos/[owner]/[repo]/workflows/[workflow_id]/page.tsx:1663` (`calculateDoraMetrics`).
[^dep-top]: `src/lib/deployments.ts:1` (module header: measured versus inferred), `src/lib/deployments.ts:40` (`DeployMetricSource`).
[^lvl-df]: `src/lib/dora.ts:92`.
[^lvl-lt]: `src/lib/dora.ts:110`.
[^lvl-cfr]: `src/lib/dora.ts:126`.
[^lvl-mttr]: `src/lib/dora.ts:137` (`null` returns `"high"` at line 138).
[^lvl-worst]: `src/lib/dora.ts:83` (`worstLevel`), `src/lib/dora.ts:578` (overall).
[^dora-df]: `src/lib/dora.ts:470` (releases else merged PRs), `src/lib/dora.ts:475` (`periodDays = 30` default), `src/lib/dora.ts:477` (`max(1, ...)`), `src/lib/dora.ts:479` (`perDay`).
[^dora-lt]: `src/lib/dora.ts:484` (loop), `src/lib/dora.ts:486` (`first_commit_at` else `created_at`), `src/lib/dora.ts:490` (`lt > 0`), `src/lib/dora.ts:493` (median and p95).
[^dora-cfr]: `src/lib/dora.ts:498` (regex and `revert ` prefix), `src/lib/dora.ts:502` (rate).
[^dora-mttr]: `src/lib/dora.ts:507` (merged minus created), `src/lib/dora.ts:509` (`> 0`), `src/lib/dora.ts:510` (mean or null).
[^dora-cycle]: `src/lib/dora.ts:517` (phases), `src/lib/dora.ts:526` (`mergeFrom = approved ?? firstReview ?? created`), `src/lib/dora.ts:536` (averages, `sample_size`), `src/lib/dora.ts:446` (`avgMs`).
[^dora-tp]: `src/lib/dora.ts:564` (12 weekly buckets), `src/lib/dora.ts:570` (count by merge week).
[^dora-scatter]: `src/lib/dora.ts:545` (scatter), `src/lib/dora.ts:552` (drop rule).
[^dep-mttr]: `src/lib/deployments.ts:165` (`computeMttr`), `src/lib/deployments.ts:174` (timestamp), `src/lib/deployments.ts:176` (first failure of a streak), `src/lib/deployments.ts:180` (`ts > failedAt`).
[^dora-ci]: `src/lib/dora.ts:173` (`calculateDoraMetrics`), `src/lib/dora.ts:174` (completed filter), `src/lib/dora.ts:180` (period, default 1), `src/lib/dora.ts:192` (lead time), `src/lib/dora.ts:213` (CFR, `failure` only), `src/lib/dora.ts:219` (MTTR per branch).
[^runs-page]: `src/app/repos/[owner]/[repo]/workflows/[workflow_id]/page.tsx:184` (`perPage` 10-100, default 50), `src/app/repos/[owner]/[repo]/workflows/[workflow_id]/page.tsx:196` (runs request).
[^list-runs-calc]: `src/lib/workflow-run-stats.ts:127` (`completed_at`), `src/lib/workflow-run-stats.ts:133` (`duration_ms`), `src/lib/workflow-run-stats.ts:135` (`queue_wait_ms`).
[^opr-age]: `src/lib/pr-health.ts:127` (age), `src/lib/pr-health.ts:135` (round to 1 decimal), `src/lib/pr-health.ts:136` (`has_review`), `src/lib/pr-health.ts:137` (`review_rounds`).
[^opr-out]: `src/lib/pr-health.ts:220` (sort by age desc), `src/lib/pr-health.ts:222` (percentile outputs), `src/app/api/github/open-pr-health/route.ts:122` (`partial`), `src/app/api/github/open-pr-health/route.ts:123` (`fetched_prs`).
[^opr-ttfr]: `src/lib/pr-health.ts:149` (sorted reviews), `src/lib/pr-health.ts:157` (time to first review).
[^opr-atm]: `src/lib/pr-health.ts:166` (approval to merge).
[^opr-rounds]: `src/lib/pr-health.ts:176` (`sorted.length`), `src/lib/pr-health.ts:195` (round buckets).
[^opr-abandon]: `src/lib/pr-health.ts:204` (abandon rate).
[^opr-conc]: `src/lib/pr-health.ts:211` (concurrent per author).
[^opr-buckets]: `src/lib/pr-health.ts:103` (`AGE_BUCKETS`), `src/lib/pr-health.ts:187` (`>= prevMax && < max`).
[^stale-ui]: `src/components/PrLifecycleExtension.tsx:282` (`age_hours > 120 && !has_review && !draft`), `src/components/PrLifecycleExtension.tsx:429` (label "5 business days").
[^conc-ui]: `src/components/PrLifecycleExtension.tsx:453` (red `>= 5`), `src/components/PrLifecycleExtension.tsx:455` (amber `>= 3`).
[^bf-detail]: `src/lib/bus-factor.ts:57` (bounded pool), `src/lib/bus-factor.ts:59` (`getCommit`), `src/lib/bus-factor-core.ts:66` (`files` to filenames), `src/lib/bus-factor.ts:70` (rejected, `partial`).
[^bf-module]: `src/lib/bus-factor-core.ts:75` (`moduleOf`).
[^bf-count]: `src/lib/bus-factor-core.ts:99` (loop; `seenModules` at lines 101-105 gives one count per module per commit).
[^bf-bf]: `src/lib/bus-factor-core.ts:54` (`BUS_FACTOR_COVERAGE = 0.8`), `src/lib/bus-factor-core.ts:83` (`contributorsToCoverage`), `src/lib/bus-factor-core.ts:89` (`cumulative >= total * 0.8`).
[^bf-risk]: `src/lib/bus-factor-core.ts:127`.
[^bf-sort]: `src/lib/bus-factor-core.ts:132` (top 5), `src/lib/bus-factor-core.ts:141` (sort), `src/lib/bus-factor-core.ts:157` (cap 30).
[^bf-overall]: `src/lib/bus-factor-core.ts:149` (overall), `src/lib/bus-factor-core.ts:158` (coverage over `commits.length`).
[^wl-const]: `src/lib/team-workload-core.ts:16` (`AFTER_HOURS_THRESHOLD`, `WEEKEND_THRESHOLD`, `MIN_SAMPLE`, `CONCURRENT_PR_OVERLOAD`, `RECENT_DAYS`, lines 16-20).
[^wl-cap]: `src/lib/team-workload.ts:34` (30 d -> 10, 42 d -> 5, 90 d -> 20), `src/app/api/github/team-workload-risk/route.ts:39` (`WINDOW_DAYS = 42`), `src/app/api/github/team-workload-risk/route.ts:40` (valid 30, 90).
[^workday-default]: `src/lib/team-settings.ts:22` (`DEFAULT_WORKDAY`).
[^workday-legacy]: `src/lib/team-settings.ts:25` (`LEGACY_UTC_WORKDAY`).
[^wl-loop]: `src/lib/team-workload-core.ts:93` (login), `src/lib/team-workload-core.ts:95` (date, skip), `src/lib/team-workload-core.ts:103` (`unlinked_name`), `src/lib/team-workload-core.ts:115` (recent versus prior), `src/lib/team-workload.ts:59` (page end), `src/lib/team-workload.ts:60` (`partial`).
[^workday-local]: `src/lib/team-settings.ts:67` (`localHourAndDay`).
[^workday-classify]: `src/lib/team-settings.ts:83` (`classifyCommitTime`).
[^wl-person]: `src/lib/team-workload-core.ts:163` (percentages), `src/lib/team-workload-core.ts:184` (`risk_score`), `src/lib/team-workload-core.ts:191` (sort).
[^wl-flags]: `src/lib/team-workload-core.ts:167` (flags), `src/lib/team-workload-core.ts:172` (activity cliff), `src/app/api/github/team-workload-risk/route.ts:142` (cliff off when `partial`).
[^wl-bots]: `src/lib/team-workload-core.ts:104` (`is_bot`), `src/lib/team-workload-core.ts:148` (bots grouped separately), `src/components/team-v2/WorkloadBars.tsx:40` (UI filter), `src/lib/team-insights.ts:223` (insights filter).
[^wl-link]: `src/lib/team-workload.ts:81` (`computeWorkload` with `canonical`), `src/lib/team-workload-core.ts:148` (grouping by canonical login).
[^run-point]: `src/lib/workflow-run-stats.ts:43` (`toRunPoint`), `src/lib/workflow-run-stats.ts:52` (duration), `src/lib/workflow-run-stats.ts:53` (queue).
[^list-jobs-calc]: `src/lib/github.ts:498` (job start), `src/lib/github.ts:500` (`duration_ms`).
[^success10]: `src/lib/workflow-run-stats.ts:72` (`successRateLast10`), `src/lib/workflow-run-stats.ts:75` (integer rate).
[^window-fields]: `src/lib/workflow-run-stats.ts:59` (`windowFields`), `src/lib/workflow-run-stats.ts:64` (rate, 1 decimal), `src/lib/workflow-run-stats.ts:66` (p95).
[^fleet-stats]: `src/lib/fleet.ts:27` (`stats`, excludes `skipped` and `cancelled`), `src/lib/fleet.ts:42` (`SUMMARY_RUNS = 30`).
[^team-rate]: `src/app/api/github/team-stats/route.ts:175` (`success / (success + failure)`), `src/app/api/github/team-stats/route.ts:176`.
[^trend30]: `src/lib/workflow-run-stats.ts:79` (`trendByDay`), `src/lib/workflow-run-stats.ts:84` (UTC day key), `src/lib/workflow-run-stats.ts:101` (30-day cutoff).
[^repo-health]: `src/lib/repo-health.ts:21` (`FAILED`), `src/lib/repo-health.ts:22` (`QUEUED`), `src/lib/repo-health.ts:38` (`repoHealth`), `src/lib/repo-health.ts:44` (decisive run).
[^queue-analysis]: `src/lib/queue-analysis.ts:59` (5 min), `src/lib/queue-analysis.ts:66` (stats), `src/lib/queue-analysis.ts:96` (UTC heatmap), `src/lib/queue-analysis.ts:129` (branch impact), `src/lib/queue-analysis.ts:162` (buckets), `src/lib/queue-analysis.ts:209` (cost, default 75).
[^job-route]: `src/app/api/github/job-stats/route.ts:27` (`per_page` default 30), `src/app/repos/[owner]/[repo]/workflows/[workflow_id]/page.tsx:214` (UI sends `min(perPage, 30)`).
[^jobstats-agg]: `src/lib/github.ts:576` (aggregation loop), `src/lib/github.ts:593` (job stats), `src/lib/github.ts:608` (step stats), `src/lib/github.ts:627` (waterfall).
[^runner-calc]: `src/app/api/github/runner-stats/route.ts:62` (`min(perPage, 50)`), `src/app/api/github/runner-stats/route.ts:101` (`partial`), `src/app/api/github/runner-stats/route.ts:113` (`"(unassigned)"`), `src/app/api/github/runner-stats/route.ts:126` (aggregation).
[^team-stats]: `src/app/api/github/team-stats/route.ts:119` (per-actor loop), `src/app/api/github/team-stats/route.ts:153` (duration and queue rules), `src/app/api/github/team-stats/route.ts:161` (UTC dow and hour), `src/app/api/github/team-stats/route.ts:213` (`period_days`), `src/app/api/github/team-stats/route.ts:219` (`most_reliable`).
[^cost-rates]: `src/lib/cost.ts:18` (`RUNNER_RATES`), `src/lib/cost.ts:25` (`DEFAULT_RATE`).
[^cost-calc]: `src/lib/cost.ts:82` (`calculateCostFromBilling`), `src/lib/cost.ts:92` (`paidRatio`), `src/lib/cost.ts:98` (apportioned cost).
[^cost-burn]: `src/lib/cost.ts:141` (`calculateBurnRate`), `src/lib/cost.ts:160` (status thresholds 1.2 and 0.9).
[^issues-filter]: `src/lib/issues.ts:154` (drop items with `pull_request`).
[^issues-days]: `src/app/api/github/issues/route.ts:39` (`days` parse), `src/app/api/github/issues/route.ts:41` (clamp 7-90).
[^issues-win]: `src/lib/issues.ts:156` (cutoff), `src/lib/issues.ts:159` (open, closed, opened sets), `src/lib/issues.ts:226` (`backlog_delta`).
[^issues-close]: `src/lib/issues.ts:164` (close durations), `src/lib/issues.ts:228` (median and p90).
[^issues-const]: `src/lib/issues.ts:75` (`STALE_DAYS = 30`), `src/lib/issues.ts:76` (`UNANSWERED_MIN_AGE_DAYS = 14`), `src/lib/issues.ts:169` (stale), `src/lib/issues.ts:171` (neglected), `src/lib/issues.ts:176` (age buckets), `src/lib/issues.ts:247` (`partial`).
[^sec-sev]: `src/lib/security-alerts.ts:78` (`normaliseSeverity`).
[^sec-secret]: `src/lib/security-alerts.ts:183` (Dependabot severity), `src/lib/security-alerts.ts:221` (code scanning), `src/lib/security-alerts.ts:259` (secret scanning always critical).
[^sec-fixed]: `src/lib/security-alerts.ts:146` (90-day window), `src/lib/security-alerts.ts:194` (Dependabot `fixed_at`), `src/lib/security-alerts.ts:232` (code scanning `updated_at`), `src/lib/security-alerts.ts:270` (secret scanning `updated_at`).
[^sec-mttr]: `src/lib/security-alerts.ts:136` (`computeMttr`).
[^scorecard]: `src/lib/org-health-scorecard.ts:16` (`DORA_SCORE`), `src/lib/org-health-scorecard.ts:40` (bus factor score), `src/lib/org-health-scorecard.ts:46` (bands), `src/lib/org-health-scorecard.ts:52` (trend), `src/lib/org-health-scorecard.ts:86` (`0.6 / 0.4` composite).
[^db-trends]: `src/app/api/db/trends/route.ts:1` (route header), `src/lib/db.ts:1205` (`getDailyTrends`), `src/lib/db.ts:1210` (daily aggregation SQL), `src/lib/db.ts:1227` (`getQuarterlySummary`).
[^sync-runs]: `src/lib/sync.ts:28` (`MAX_PAGES = 5`, `PER_PAGE = 100`), `src/lib/sync.ts:54` (`listWorkflowRunsForRepo`, `exclude_pull_requests: false`).
[^cron-times]: `src/app/docs/_parts/concepts.tsx:292` (03:17 UTC runs sync), `src/app/docs/_parts/concepts.tsx:293` (04:17 PR facts), `src/app/docs/_parts/concepts.tsx:294` (04:47 commit facts).
[^wh-rules]: `src/lib/working-habits.ts:1` (counting rules in header), `src/lib/working-habits.ts:27` (`isOversizedCommit`).
[^wh-defaults]: `src/lib/working-habits-settings.ts:20` (`maxCommitFiles: 10`, `maxCommitLines: 200`, `maxPrCommits: 20`).
[^pr-facts]: `src/lib/sync.ts:275` (`PR_PAGE_CAP`, `PR_PER_PAGE`, `PR_CONCURRENCY`), `src/lib/sync.ts:318` (`pulls.list state=all`), `src/lib/sync.ts:338` (reviews and `pulls.get` per PR), `src/lib/sync.ts:344` (stored fields).
[^team-gql]: `src/app/docs/_parts/api-reference.tsx:66` (`days=30|90` read through GraphQL search).
[^cache-ttl]: `src/app/api/github/repo-dora/route.ts:9` (300 s), `src/app/api/github/open-pr-health/route.ts:11` (300 s), `src/app/api/github/bus-factor/route.ts:13` (600 s), `src/app/api/github/team-workload-risk/route.ts:38` (900 s), `src/app/api/github/deployments/route.ts:26` (600 s), `src/app/api/github/runs/route.ts:11` (15 s).
[^docs-pr]: `src/app/docs/_parts/metrics.tsx:204` ("Review Round Distribution"), `src/app/docs/_parts/metrics.tsx:190` ("Review P50").
