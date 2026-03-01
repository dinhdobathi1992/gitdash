# Changelog

All notable changes to GitDash are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [2.0.0] — 2026-03-01

### Overview
Major release adding executive-level analytics, team productivity metrics, security scanning, resource optimization insights, audit trail, and a suite of UX quick-wins. All features are stateless — no database required.

---

### Added

#### Cost Analytics Dashboard (1.1)
- New `/cost-analytics` page with cost attribution per runner type (Ubuntu / macOS / Windows)
- Monthly burn rate and end-of-month cost projections
- Org selector to switch between personal and organization billing contexts
- Migrated from deprecated GitHub billing REST API to the new **Enhanced Billing API** (`GET /organizations/{org}/settings/billing/usage/summary`)
- Clear 403 error UI explaining fine-grained PAT requirement with actionable setup links
- New API route: `GET /api/github/billing/cost-analysis`

#### Org-Wide Repository Comparison (1.2)
- New `/org/[orgName]` dashboard with 4 stat cards: total repos, active repos, total runs, avg success rate
- Reliability heatmap — color-coded grid of all org repos (green ≥95 %, yellow 90–95 %, red <90 %)
- Top repositories table with Status / Health / Run History / Trend / Workflows columns
- New API route: `GET /api/github/org-overview`

#### DORA Four Keys Metrics (2.1)
- New **DORA** tab on the workflow detail page
- Calculates all four DORA keys from existing runs data (no new API calls):
  - **Deployment Frequency** — deploys per day / week
  - **Lead Time for Changes** — commit age → workflow completion (median + p95)
  - **Change Failure Rate** — % of deploy runs that concluded as `failure`
  - **Mean Time to Recovery (MTTR)** — time between first failed deploy and next successful one
- Elite / High / Medium / Low performance badges with industry benchmark reference table
- New library: `src/lib/dora.ts`

#### Team Velocity & Contributor Analytics (2.2)
- New `/repos/[owner]/[repo]/team` page
- Contributor leaderboard: runs, success rate, avg duration, busiest hour per actor
- Activity bar chart (runs per contributor, last 30 days)
- New API route: `GET /api/github/team-stats`
- **Team** nav button added to repo detail page header

#### Queue Wait Analysis (3.1)
- Queue Wait section added to the **Performance** tab on the workflow detail page
- Metrics: avg / p50 / p95 / max queue wait, percentage of runs delayed >2 min
- Queue wait heatmap by hour of day and day of week
- Estimated developer time wasted per week
- New library: `src/lib/queue-analysis.ts`

#### Workflow Optimization Recommendations (3.2)
- Dismissible **Optimization Tips** card on the workflow Overview tab
- Rule-based engine with 6 rules: macOS runner cost, no-cache detected, sequential jobs, long steps, missing timeout, `pull_request_target` security risk
- New library: `src/lib/optimization.ts`

#### Anomaly Detection (4.2)
- Statistical outlier detection using rolling 7-day baseline (mean ± 2 × stddev)
- **Anomaly** badge on affected run rows in the Runs tab
- Detects duration spikes, unusual queue wait, and conclusion-pattern shifts
- New library: `src/lib/anomaly.ts`

#### Audit Trail (6.1)
- New `/repos/[owner]/[repo]/audit` page
- Deployment approval tracking: triggered-by vs triggering-actor, conclusion, commit SHA + message
- Workflow file change history: lists commits to `.github/workflows/` with author, date, and message
- **Audit Trail** nav button (Shield icon) added to repo detail page header
- New API route: `GET /api/github/audit-log`

#### Security Metrics (6.2)
- New `/repos/[owner]/[repo]/security` page with 10 static-analysis rules (SEC-001 – SEC-010):
  - `pull_request_target` usage, unpinned action versions (`@main`/`@master`), missing `permissions:`, secrets in env, `continue-on-error: true`, missing `timeout-minutes`, hardcoded credentials pattern, `workflow_dispatch` input injection, self-hosted runner on public repo, deprecated Node.js runner versions
- Severity badges (critical / high / medium / low / info) with per-rule doc links
- Workflow-level findings with expandable detail and line references
- **Security** nav button (ShieldCheck icon) added to repo detail page header
- New API route: `GET /api/github/security-scan`

#### CSV Export Enhancement (Quick Win)
- Added `Run_Attempt` and `Est_Cost_USD` columns to the workflow runs CSV export
- Cost estimated client-side via `estimateRunCost()` from `src/lib/cost.ts`

#### Health Score Ring (Quick Win)
- `HealthScoreRing` SVG radial ring component in `src/components/WorkflowMetrics.tsx`
- Composite score (0–100): 60 % success rate + 30 % stability + 10 % activity bonus
- Color thresholds: green ≥80, yellow ≥60, orange ≥40, red <40
- Replaces flat `HealthBadge` in workflow rows on the repo detail page (homepage retains `HealthBadge`)

#### Recent Failures Widget (Quick Win)
- Banner on the homepage listing repos with `failure` or `cancelled` conclusions in the last 24 h
- Reads from the SWR in-memory cache — zero additional API calls
- Capped at 5 entries; each links directly to the repo detail page with relative time
- Dismissible with ✕ button

#### Keyboard Shortcuts Modal (Quick Win)
- Press `?` anywhere on the homepage to open the shortcuts reference modal
- Keyboard icon button added next to **Refresh** in the header
- Shortcuts: `/` focus search, `Escape` clear/close, `↑ ↓` navigate list, `Enter` open repo, `?` toggle modal
- Dismisses on `Escape`, backdrop click, or ✕ button

---

### Changed

- **Sidebar version badge** — upgraded from a small muted `v0.1.0` label to a prominent violet pill linking to the GitHub Releases page
- **Cost Analytics error handling** — 403 now shows an actionable amber block (not a generic 500) explaining fine-grained PAT requirement
- **Setup page** — added fine-grained PAT note for Cost Analytics (replaces old `admin:org` scope instruction)
- **Login page** — updated Cost Analytics scope note

---

### Fixed

- `ExternalLink` lucide icon was missing from the security page import — caused a TypeScript compile error
- Removed unused `detectRunnerOS` import from the workflow detail page (was imported alongside `estimateRunCost` but never referenced)
- `Date.now()` inside `useMemo` / `useRef` initial values — moved to module-level constants to satisfy the `react-hooks/purity` lint rule
- Audit Trail page: added **Back to repo** button (ArrowLeft icon) for easier navigation

---

### Security

- All new API routes follow the established pattern: session token retrieval → input validation via `src/lib/validation.ts` → `safeError()` for error responses → `Cache-Control: private` headers
- Security scan page: no `dangerouslySetInnerHTML`; all external links use `rel="noopener noreferrer"`
- No secrets, tokens, or PII are stored or logged anywhere in the new code

---

### Skipped (require infrastructure not yet available)

- **5.1 Historical Data Storage** — requires a database (PostgreSQL / SQLite)
- **4.1 Smart Alerts** — requires a database + external services (SendGrid, Slack webhook)

---

## [0.1.0] — Initial Release

- Workflow-level metrics (job / step performance, trigger patterns)
- Reliability tracking (MTTR, failure streaks, flaky detection)
- PAT + OAuth authentication with iron-session
- Fuzzy repo search, auto-refresh, keyboard navigation
