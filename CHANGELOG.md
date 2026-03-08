# Changelog

All notable changes to GitDash are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [3.1.1] — 2026-03-09

### Overview
Critical fix for reverse-proxy deployments: redirects now use the public-facing origin instead of the container's internal address. Middleware was also not running due to wrong filename/export.

---

### Fixed

#### Redirects go to container address behind reverse proxy (#3)
- All `NextResponse.redirect(new URL("/path", req.url))` calls resolved to `https://0.0.0.0:3000` behind NGINX ingress because `req.url` uses the container's `HOSTNAME`
- New `src/lib/url.ts` exports `publicUrl()` which reconstructs the external origin from `x-forwarded-proto` + `x-forwarded-host` headers (set by NGINX/ALB), with fallback to `NEXT_PUBLIC_APP_URL`, then `req.url`
- All redirect calls in middleware and auth route handlers now use `publicUrl()`

#### Middleware was never active
- `src/proxy.ts` exported `proxy()` — Next.js requires `src/middleware.ts` exporting `middleware()`
- Renamed file and export so the auth middleware actually runs

#### Helm chart uses wrong ingress class
- Replaced ALB ingress annotations with NGINX ingress annotations
- Set `className: "internal-ingress-nginx"` (matches cluster's installed controller)
- Removed `certificateArn` value and ALB-specific template logic from `ingress.yaml`

### Changed
- Bumped version from 3.1.0 to 3.1.1

---

## [3.1.0] — 2026-03-08

### Overview
UI/UX overhaul: responsive mobile navigation, redesigned settings page, global footer, skeleton loading states, demo mode, test infrastructure, and a completely rewritten README with intro video and walkthrough demo.

---

### Added

#### Mobile-Responsive Navigation
- **Mobile hamburger menu** with slide-out drawer, backdrop blur overlay, and close button
- **Sticky mobile top bar** with GitDash branding
- Desktop sidebar now uses sticky positioning with proper full-height background — no more gap between nav and page content
- Sidebar user account section pinned to bottom of viewport

#### Global Footer
- Consistent footer on all pages (except `/docs` which has its own) showing version, "Open source on GitHub" and "Report an issue" links
- Version pulled dynamically from `NEXT_PUBLIC_APP_VERSION`

#### Settings Page — Complete Redesign
- Replaced narrow single-column layout with full-width responsive design
- **Account section**: horizontal card with avatar, name, mode badge, active status, and inline PAT management
- **Feature Flags**: responsive card grid (1/2/4 columns) replacing flat toggle list — cards are fully clickable with violet highlight when enabled
- **Enable all / Disable all** bulk toggle buttons
- Larger, more accessible "Change PAT" and "Clear & reset" buttons matching design system

#### Demo Mode
- New `/demo` page and `/api/demo` route for showcasing GitDash without a real GitHub token
- Demo data generator in `src/lib/demo.ts`

#### Skeleton Loading States
- Loading skeletons for all major pages: homepage, repo detail, workflow detail, cost analytics, docs
- `PageSkeleton` reusable component for consistent loading UX

#### New Components
- `MissionControl` — real-time system status overview
- `OnboardingChecklist` — guided first-run experience
- `MetricProvenance` — data source attribution for metrics
- `PageHeader` — standardized page header component
- Shell components: `PrimaryRail`, `WorkspacePanel`, `MobileNavDrawer`, `nav-config`

#### Test Infrastructure
- Vitest configured with `vitest.config.ts`
- Test scripts added: `npm run test`, `npm run test:watch`, `npm run test:coverage`
- Initial test suite: anomaly detection tests in `tests/anomaly.test.ts`
- Added `vitest` and `@vitest/coverage-v8` as dev dependencies

#### Infrastructure Libraries
- `src/lib/cache.ts` — client-side caching utilities
- `src/lib/concurrency.ts` — request concurrency control
- `src/lib/notifier.ts` — notification system

#### Walkthrough Videos & README
- Added intro video (`walkthrough-output/GitDash__GitHub_Actions.mp4`) and full demo walkthrough (`walkthrough-output/gitdash-walkthrough.webm`)
- README completely rewritten: video embeds, collapsible screenshot sections, cleaner structure with emoji section headers

---

### Improved

#### Layout & Sidebar
- Sidebar background now extends full page height (fixed `h-screen` gap issue)
- `flex-1` spacer ensures user account is always pinned to sidebar bottom
- AppShell uses `items-stretch` with separate outer wrapper for background vs sticky scroll behavior
- Docs page removed from full-page route exclusion (now renders within AppShell)

#### Cost Analytics
- Updated page layout and styling improvements

#### Repository Page
- Refined homepage repository list styling and layout

#### Database Layer
- Improved `src/lib/db.ts` with better error handling and query patterns

#### Org Overview API
- Enhanced `/api/github/org-overview` route with improved data aggregation

#### Alerts API
- Refined `/api/alerts/route.ts` with improved validation

---

### Changed
- Bumped version from 3.0.0 to 3.1.0
- `StatCard` component updated with refined styling
- Global CSS (`globals.css`) expanded with new utility styles and animations

---

## [3.0.0] — 2026-03-07

### Overview
Major release: Feature Flags system, DORA metrics on repository overview, PR lifecycle health, historical DB-backed reporting, alert rules engine, and comprehensive built-in documentation.

---

## [2.2.0] — 2026-03-01

### Overview
Automated Vercel deployment via GitHub Actions CI/CD, setup and login page improvements including PAT security transparency and author attribution.

---

### Added

#### Vercel Deployment Workflow
- New `.github/workflows/vercel.yml` — deploys to Vercel production automatically on every push to `main`, and can be triggered manually via `workflow_dispatch`
- Uses `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` GitHub secrets (no CLI login required)
- Build step runs `vercel build --prod` in CI before deploying the prebuilt output — consistent reproducible deploys

#### Setup Page — PAT Security Section
- New "How this application handles your PAT?" section below the token scopes list
- Plain-English explanation: encrypted session cookie, never stored or forwarded to third parties
- Links to the README PAT security policy anchor

#### Author & License Attribution
- Footer of setup page now shows: `MIT License · Made by Dinh Do Ba Thi`
- Footer of login page updated to match for consistency

---

## [2.1.0] — 2026-03-01

### Overview
Post-release polish: personal account billing support in Cost Analytics, fully-structured loading skeletons on every page, and a shimmer sweep animation replacing the invisible pulse effect.

---

### Added

#### Cost Analytics — Personal Account Billing
- **Personal Account** option added as the first entry in the Cost Analytics account dropdown
- Defaults to Personal Account on load — no org selection needed to see your own metered usage
- Calls `GET /users/{login}/settings/billing/usage/summary` (Enhanced Billing API) when Personal Account is selected
- Org entries remain available below a divider for switching to org billing
- Context banner now shows "Personal Account" label with a User icon (vs Building2 for orgs)

#### Shimmer Loading Animation
- New `@keyframes shimmer` + `.skeleton` CSS utility class in `globals.css`
- A bright highlight sweeps left→right across each placeholder shape (slate-800 → slate-700 → slate-800) at 1.6 s, matching the loading style used by GitHub, Linear, and similar apps
- Single utility: `class="skeleton rounded-*"` — border-radius controlled independently per shape

---

### Improved

#### Loading Skeletons — Audit Trail page
- Replaced 8 identical `h-16` blobs with a fully-structured skeleton:
  - 4 stat cards (icon + label + large value + sub-label)
  - Timeline card with header lines + 8 commit rows each showing avatar circle, varying-width message line, author · time · file-badge meta row, and SHA chip

#### Loading Skeletons — Security page
- Replaced 5 uniform `h-24` + 3 `h-16` blobs with a fully-structured skeleton:
  - Score ring card (large circle + 3 text lines) + 4 severity count cards in the summary strip
  - Section heading + 4 workflow file result rows with mini ring, file path, badge pills, check-mark row, and chevron

#### Loading Skeletons — All pages
- Fixed invisible pulse: all skeleton shapes were using `bg-slate-800` on a `bg-slate-900` background — near-zero contrast, making `animate-pulse` imperceptible
- Bumped all skeleton fill colours to `bg-slate-700` (and subsequently replaced with `.skeleton` shimmer)
- Migrated all pages from `animate-pulse bg-slate-700` to `.skeleton` class: homepage, repo detail, workflow detail, cost-analytics, org overview, team, audit trail, security, settings

---

### Fixed

#### Cost Analytics — 404 error clarity
- GitHub returns `404` (not `403`) when a PAT lacks org billing permission — the resource is hidden entirely
- Error block now clearly states "Your API key does not have enough permission" with the org name
- Explains the 404 behaviour, lists 4 actionable fix steps, and provides CTA buttons to create a fine-grained PAT and view org billing directly

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
