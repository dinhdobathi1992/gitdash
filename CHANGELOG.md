# Changelog

All notable changes to GitDash are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [4.0.6] — 2026-08-13

### Overview
Docs-only fix: the four v4.0.0–v4.0.3 features (Team Health Scorecard, Workload Risk Radar, 1:1 Prep Sheet, Leadership Digest) shipped with release-notes entries and API Reference rows, but no dedicated page in the in-app Features docs and no sidebar entry — reported by a user who couldn't find where the 1:1 feature lived after enabling all feature flags.

### Fixed

#### New features were undiscoverable in the docs
- **Root cause:** each v4.0.x release added a `ReleaseNotes()` entry and `API Reference` rows, but never added a corresponding `feat-*` entry to `NAV`, the `Features()` index, or a dedicated feature-detail component. The only place these features were mentioned was changelog prose.
- Added four dedicated feature pages: `feat-health-scorecard`, `feat-workload-risk`, `feat-one-on-one`, `feat-leadership-digest` — each with a sidebar entry, an index card, and a full detail page.
- Fixed stale labels: Feature Overview listed "Team Insights (In Development)" and "Contributor Profile (Coming Soon)" even though both have been fully built since well before v4.0.0.
- Added a `VersionBadge` ("New in vX.Y") convention, applied to the four new pages and retrofitted onto the Contributor Profile and Alerts pages where they were extended (v4.0.2's `period_comparison` field, v4.0.3's `leadership_digest` rule type). Going forward, new doc content for a feature should carry this badge.

### Rollback
- **Instant, no rebuild:** promote the v4.0.5 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — docs-only, no code path, database, or env var changes.

### Changed (infra)
- Bumped app version from 4.0.5 to 4.0.6
- Bumped Helm chart version from 0.4.5 to 0.4.6

---

## [4.0.5] — 2026-08-13

### Overview
Fix for a contributor-profile crash reported right after v4.0.4: "Failed to fetch contributor profile" whenever the repo owner is a personal GitHub account rather than an organization.

### Fixed

#### Contributor profile broke for personal-account-owned repos
- **Root cause:** `/api/github/contributor-profile` always called `GET /orgs/{org}/repos` to list the owner's repos. That endpoint 404s whenever `owner` is a personal account, not an organization — which is the common case for most users (personal repos, not org repos). Any click into a contributor from a personal repo's Team Analytics page failed outright.
- Added a fallback: try the org-repos endpoint first (the common path when contributor profiles are reached from org-owned repos), and on 404 fall back to `GET /users/{username}/repos` for personal accounts. No behavior change for org-owned repos.

### Rollback
- **Instant, no rebuild:** promote the v4.0.4 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — no migration, no schema change.

### Changed (infra)
- Bumped app version from 4.0.4 to 4.0.5
- Bumped Helm chart version from 0.4.4 to 0.4.5

---

## [4.0.4] — 2026-08-13

### Overview
Fix for a real usability gap reported after v4.0.0-4.0.3 shipped: on some accounts, the org switcher shows only "Personal repos" with no way to reach organization-scoped features (Team Health Scorecard, Weekly Leadership Digest), even for users who genuinely belong to orgs.

### Fixed

#### Org switcher silently hid orgs with no way to work around it
- **Root cause:** the switcher only lists orgs GitHub's `orgs.listForAuthenticatedUser` API returns for the *current* token — which depends on when that token was authorized, not just current org membership. A session authorized before `read:org` was added to the OAuth scope list (or a fine-grained PAT, which cannot see org data at all) silently returns an empty list even for a user who belongs to orgs. There was no feedback and no fallback.
- The org switcher now includes a "Go to org by name" input, always available, that navigates directly to any org by name — this works independently of the discovery list, because the actual repo fetch (`/api/github/org-repos`) checks real GitHub access itself rather than relying on the membership-listing API.
- When the discovered org list is empty, the switcher now explains why (stale OAuth scope, fine-grained PAT limitation, or org visibility settings) instead of silently showing nothing.
- Fixed a related cosmetic bug: navigating to an org not in the discovered list (e.g. via the new manual input, or a bookmarked `?org=` URL) previously fell back to showing "Personal Repos" as the page title even though the repo list was correctly filtered to that org — the title now always reflects the actual org being viewed.
- Added a FAQ entry in the in-app docs explaining the scope/discovery gap and the workaround.

Team Health Scorecard (`/org/[orgName]/health`) and the org-repos view already worked correctly by URL for any org name — this fix is entirely about *reaching* them when the switcher's auto-discovery falls short. No API or data-layer changes.

### Changed (infra)
- Bumped app version from 4.0.3 to 4.0.4
- Bumped Helm chart version from 0.4.3 to 0.4.4

---

## [4.0.3] — 2026-08-13

### Overview
Fourth and final leadership-focused release. The **Weekly Leadership Digest** — a plain-English narrative summary emailed to leadership every Monday: what's healthy, what's trending, and what needs attention across an org, without anyone having to log in and look.

### Added

#### Weekly Leadership Digest
- New alert metric `leadership_digest` and a dedicated form in the Alerts page: pick an org and an email address, and every Monday (UTC) you get a narrative summary — reuses the exact org-health-scorecard computation from v4.0.0 (`src/lib/org-health-scorecard.ts`, now extracted into a shared lib) and turns the ranked result into sentences instead of a UI list.
- **No new database table.** `leadership_digest` rules are stored in the existing `alert_rules` table (same schema, same UI, same CRUD) — the cron explicitly excludes them from the normal per-repo alert evaluation path (they'd otherwise fire once per repo per day instead of once per week) and evaluates them directly on its own weekly cadence.
- **No "last sent" state to track.** The cron runs daily; a simple day-of-week check (`getUTCDay() === 1`, Monday) is enough to fire the digest once a week — no extra column, no extra table.
- Narrative generation (`src/lib/leadership-narrative.ts`) is rule-based and testable, same style as the app's alert thresholds and the 1:1 Prep Sheet's talking points: highlights (healthy repos, upward trends), concerns (at-risk repos, critical bus-factor modules, downward trends), never more than what fits in a scannable email.
- 5 new unit tests for the narrative generator (`tests/leadership-narrative.test.ts`).

### Changed
- `src/lib/org-health-scorecard.ts` (new): the composite-score computation was extracted out of `/api/github/org-health-scorecard`'s route handler so the digest could call it directly. The route itself is unchanged in behavior — same thin cached wrapper pattern as v4.0.0's bus-factor extraction.

### Rollback
- **Instant, no redeploy:** delete or disable the `leadership_digest` rule(s) in the Alerts page — no more emails go out, nothing else in the app is affected.
- **Instant, no rebuild:** promote the v4.0.2 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — no migration to undo (the feature reused the existing `alert_rules` schema).

### Changed (infra)
- Bumped app version from 4.0.2 to 4.0.3
- Bumped Helm chart version from 0.4.2 to 0.4.3

---

## [4.0.2] — 2026-08-13

### Overview
Third of four leadership-focused releases. The **1:1 Prep Sheet** — a one-click, formatted brief for manager 1:1s: period-over-period diffs and auto-generated talking points, framed as conversation prompts rather than verdicts.

### Added

#### 1:1 Prep Sheet
- New `/contributor/[login]/brief` page — period-over-period PR/review/cycle-time comparison plus a short list of talking points, generated by a small threshold-based rules engine (`src/lib/one-on-one.ts`, same style as the app's existing alert-rule thresholds). Print-friendly (`window.print()` button, print CSS).
- Linked from the existing contributor profile page.
- **Zero new GitHub API calls.** `ContributorProfileResponse` gained a `period_comparison` field, computed by splitting PR/review data the route already fetches into two 45-day halves — no extra fan-out. The brief page reuses the exact same SWR cache key as the full profile page, so opening it after viewing the profile costs nothing extra, and opening it cold costs the same single fetch the profile page would need anyway.
- Talking points are deliberately phrased as observations + questions, never conclusions — e.g. "PRs merged dropped 40% vs. the prior period... worth asking about blockers" rather than "underperforming." Small-sample noise is filtered (comparisons require a baseline of at least 2 in the prior period).
- 6 new unit tests for the talking-point rules (`tests/one-on-one.test.ts`).

### Rollback
- **Instant, no redeploy:** the brief page and its link are additive UI — hiding them isn't flag-gated in this version (the underlying `period_comparison` field is inert extra data on an existing response, harmless to leave in place). If needed, remove the "1:1 Prep Sheet" link from the profile page and the route becomes unreachable via the UI.
- **Instant, no rebuild:** promote the v4.0.1 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — no migration to undo.

### Changed (infra)
- Bumped app version from 4.0.1 to 4.0.2
- Bumped Helm chart version from 0.4.1 to 0.4.2

---

## [4.0.1] — 2026-08-13

### Overview
Second of four leadership-focused releases. The **Burnout & Workload Risk Radar** — a team-wide people-risk view, distinct from v3.2.0's Review Bottleneck (which covers reviewer overload specifically). This one surfaces three signals nothing else in the app shows: sustained after-hours/weekend work, "went quiet" activity cliffs, and concurrent-PR overload.

### Added

#### Workload Risk Radar
- New `GET /api/github/team-workload-risk?owner=X&repo=Y` — one repo-wide commit fetch (not per-contributor) grouped locally by author, plus one open-PR fetch, producing per-person flags: after-hours pattern (≥30% of commits outside 9–18 UTC), weekend work (≥25% of commits on Sat/Sun), concurrent-PR overload (≥4 open PRs at once), and activity cliff (≥3 commits in the prior 4 weeks, zero in the most recent 2).
- New Team Analytics section, gated behind a new `workloadRisk` feature flag.
- Framed deliberately as a conversation-starter, not a verdict — the UI and docs both say so explicitly. Heuristic thresholds on a small sample can be wrong (timezone differences, a contractor's concentrated PR pattern, etc.); this is a "worth a check-in" signal for a manager, not a performance judgment.
- No new database table — computed live from the GitHub API on each request (15-min cache), same rollback-safety approach as v4.0.0.

### Rollback
- **Instant, no redeploy:** toggle "Workload Risk Radar" off in Settings → Feature Flags.
- **Instant, no rebuild:** promote the v4.0.0 Vercel deployment.
- **Full revert:** `git revert` this release's commit(s) — no migration to undo.

### Changed (infra)
- Bumped app version from 4.0.0 to 4.0.1
- Bumped Helm chart version from 0.4.0 to 0.4.1

---

## [4.0.0] — 2026-08-13

### Overview
First of four leadership-focused releases (v4.0.0 → v4.0.3), each shipping as its own isolated, independently-rollback-able version — see "Rollback" below. This one: the **Team Health Scorecard**, an org-wide ranked view that answers "which of my teams needs attention" without opening repos one at a time.

### Added

#### Team Health Scorecard
- New `GET /api/github/org-health-scorecard?org=X&limit=N` — for every repo in an org, computes a composite health score (60% DORA tier + 40% bus-factor risk, 0–100) and a throughput trend (recent vs. prior half of the DORA window), sorted worst-first.
- New `/org/[orgName]/health` page — ranked list with risk bands (Healthy / Watch / At Risk), DORA tier, bus-factor and critical-module counts, and trend arrows. Linked from the existing Org Overview page.
- Deliberately **no new database table** — the trend signal is derived from data the DORA calculation already fetches (recent vs. prior weeks of merged-PR throughput), so this works identically whether or not `DATABASE_URL` is configured, and there's no schema change to roll back if the feature is reverted.
- Gated behind a new `healthScorecard` feature flag (Settings → Feature Flags), following the same pattern as every other optional analytics section.

### Changed
- `src/lib/bus-factor.ts` (new): the bus-factor calculation was extracted out of `src/app/api/github/bus-factor/route.ts` into a reusable function, so the scorecard can compute it per-repo via a direct function call instead of an internal HTTP round trip. The route itself is now a thin cached wrapper — its response shape and behavior are unchanged.

### Rollback
This release is intentionally isolated to make reverting it low-risk:
- **Instant, no redeploy:** toggle "Team Health Scorecard" off in Settings → Feature Flags. Hides the new page and stops the client from calling the new endpoint.
- **Instant, no rebuild:** promote the prior Vercel deployment (`vercel rollback`, or "Promote to Production" on the v3.2.0 deployment in the Vercel dashboard).
- **Full revert:** `git revert` this release's commit(s) — no database migration was added, so there is nothing to roll back at the schema level.

### Changed (infra)
- Bumped app version from 3.2.0 to 4.0.0
- Bumped Helm chart version to 0.4.0 / appVersion to 4.0.0

---

## [3.2.0] — 2026-08-13

### Overview
Custom domain cutover to gitdash.info, seven new features (scheduled sync, rate-limit visibility, runner utilization, partial-data honesty, anomaly-driven alerts with digest delivery, review bottleneck detection), and a second performance pass on top of 3.1.3's API-efficiency work — this one focused on client bundle size and render cost.

---

### Added

#### Custom domain
- Production now serves from `https://gitdash.info` (previously the `*.vercel.app` domain). `NEXT_PUBLIC_APP_URL` and the GitHub OAuth app's callback URL were updated to match.

#### Scheduled background sync
- New `GET /api/cron/sync`, triggered daily by Vercel Cron (`vercel.json`), re-syncs every repo that has ever been synced (tracked via `sync_cursors`) so Reports and Alerts stay current without manually clicking "Sync from GitHub".
- Protected by `CRON_SECRET` (Vercel's standard `Authorization: Bearer` cron auth pattern); runs under a service-level `GITHUB_TOKEN` since a cron run has no user session.
- Shared sync logic extracted into `src/lib/sync.ts`, used by both the cron route and the existing manual `POST /api/db/sync`.

#### Rate-limit budget widget
- Sidebar now shows live GitHub API quota (`GET /rate_limit`, which GitHub excludes from rate-limit accounting — checking it is free), with a warning state below 20% remaining.

#### Runner utilization
- New `GET /api/github/runner-stats` aggregates job counts, durations, and failure rates per runner from data the app already fetched but never surfaced (`job.runner_name` / `runner_group_name`). Shown in a new Team Analytics section, gated behind a feature flag.

#### Partial-data indicators
- Fan-out routes that fetch many PRs/commits per request now report `partial`, `fetched_*`, and `total_*` fields when some sub-requests were rate-limited or failed, and the UI shows an amber banner instead of silently returning an undercounted number. Applied to `bus-factor`, `open-pr-health`, `repo-contributors`, `contributor-profile`, and `repo-dora`.
- These routes' batch-of-N `Promise.allSettled` loops were also converted to the bounded worker-pool `pLimitSettled` (no more waiting for the slowest member of each batch before starting the next).

#### Anomaly-driven alerts + daily digest
- New alert metric `anomaly_count`: fires when more than a threshold number of runs deviate >2 standard deviations from the rolling baseline in the window — reuses the same statistical detector the workflow detail page already uses client-side (`src/lib/anomaly.ts`, now shared between client and server).
- New alert channel `digest`: instead of a real-time notification per event, matching alerts are bundled into one daily summary email, sent by the cron route after each sync pass (Vercel Hobby limits cron jobs to once/day, so digest delivery piggybacks on the sync cron rather than needing its own).

#### Review bottleneck detection
- New Team Analytics section flags reviewers carrying a disproportionate share of the review load ("Overloaded") and authors whose PRs are reviewed almost exclusively by one person ("Sole-Reviewer Risk") — built entirely from data `repo-contributors` already fetches, no additional GitHub API calls.

### Changed

#### Client bundle & render performance (Phase 2)
- Consolidated all 7 Recharts importers behind a single `src/components/charts/index.tsx` re-export — Turbopack previously emitted two duplicated ~388 KB chunks for the same library; the repo page's DORA drill-down and PR lifecycle sections (both collapsed by default) now load via `next/dynamic` instead of shipping in the initial bundle.
- `RepoRow` (home page repository table) is now `React.memo`'d — search-box keystrokes no longer re-render all visible rows.
- Fixed `RecentFailuresWidget`: its cache-read `useMemo` depended on the SWR cache object, whose identity never changes as entries are added — the widget could never show newly-loaded failures. Now driven by a tick counter bumped when each row's summary fetch settles.

### Known limitations
- The Vercel Cron-based scheduled sync only runs on the Vercel deployment. The Helm/Kubernetes deployment path does not yet have an equivalent CronJob — self-hosted users on k8s still sync manually or via the GitHub webhook.
- Digest delivery requires `RESEND_API_KEY` or `SMTP_HOST` to be configured (same as the existing `email` alert channel).

### Changed (infra)
- Bumped app version from 3.1.3 to 3.2.0
- Bumped Helm chart version to 0.3.0 / appVersion to 3.2.0

---

## [3.1.3] — 2026-03-13

### Overview
Reverse-proxy / Zscaler robustness: allow public paths (health probes, static assets) to bypass the HTTPS redirect, and enable outbound TLS through Zscaler inspection during development.

---

### Added

#### Run behind Zscaler
- Set `experimental.turbopackUseSystemTlsCerts: true` in `next.config.ts` so outbound requests (e.g. Google Fonts during dev) trust the system certificate store when Zscaler TLS inspection is active.

### Fixed

#### `ALWAYS_PUBLIC` check now runs before the HTTPS redirect
- Reordered `src/middleware.ts` so the `ALWAYS_PUBLIC` allowlist (`/_next`, `/favicon`, `/docs`, `/api/webhooks`, `/api/health`) is evaluated **before** the production HTTP→HTTPS redirect.
- Previously, kubelet probes and static assets — which carry no `x-forwarded-proto` header — could be redirected, breaking health checks and asset loading behind a reverse proxy.

### Changed
- Bumped app version from 3.1.2 to 3.1.3
- Bumped Helm chart version to 0.2.1 / appVersion to 3.1.3

---

## [3.1.2] — 2026-03-09

### Overview
Fix readiness/liveness probe failures caused by middleware redirecting unauthenticated kubelet health checks after the #3 middleware activation fix.

---

### Fixed

#### Readiness/liveness probes fail behind middleware (#4)
- Kubelet probe requests to `/api/auth/me` were redirected by the now-active middleware (no session cookie → 302 to `/setup` or `/login`)
- Created dedicated `/api/health` endpoint returning `{"status":"ok"}` with no auth required
- Added `/api/health` to middleware's `ALWAYS_PUBLIC` list so it bypasses auth checks
- Updated Helm chart probe paths from `/api/auth/me` to `/api/health`
- Reduced `initialDelaySeconds` (readiness: 10→5, liveness: 30→10) since the health endpoint is trivial

### Changed
- Bumped app version from 3.1.1 to 3.1.2
- Bumped Helm chart version to 0.2.0 / appVersion to 3.1.2

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
