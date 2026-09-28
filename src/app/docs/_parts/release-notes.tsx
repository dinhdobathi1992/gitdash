"use client";

import { ChevronRight, Tag } from "lucide-react";
import { DocCard } from "@/components/docs/DocCard";
import { SectionHeading } from "./primitives";

export function ReleaseNotes() {
  const releases = [
    {
      version: "4.5.3",
      date: "2026-09-28",
      badge: "latest",
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Server cache can serve the last result while it refreshes in the background, so an expired entry no longer makes the next visitor wait",
        ],
        fixed: [
          "Contributor profiles undercounted pull requests and reviews — only each repository's 30 most recently closed pull requests were scanned",
          "Average pull request size on the contributor profile was always 0",
          "The profile funnel's reviewed and approved steps were always 0; they now count reviews other people left on the person's pull requests",
        ],
        improved: [
          "Contributor profiles load about 5× faster: three parallel GitHub searches instead of walking up to 30 repositories (measured 17.4 s → 3.5 s cold, 227 → 6 GitHub requests)",
          "Contributor profiles stay cached for 30 minutes and are refreshed in the background for up to 6 hours after that; Refresh always fetches fresh data",
        ],
      },
    },
    {
      version: "4.5.2",
      date: "2026-09-27",
      changes: {
        added: [
          "Quick start, Access control and Caching & rate limits sections in these docs",
          "Feature pages for the repository Workflows and Pull requests tabs; every feature page names the switch that controls it",
        ],
        fixed: [
          "Change failure rate levels were documented as 5/10/15% — the app uses ≤5% Elite, ≤15% High, ≤30% Medium",
          "Deploy frequency, lead time and hotfix detection are described as the app measures them (last 30 releases / 60 pull requests; hotfix, revert, fix-prod or emergency branches)",
          "The Docker image name (dinhdobathi/gitdash), nightly history sync, demo mode requiring sign-in and fine-grained tokens for organizations were documented wrongly",
          "The API reference was missing the admin endpoints and issue creation, and listed a parameter /api/github/repos does not read",
        ],
        improved: [
          "Every screenshot retaken on a live instance with the 4.5 interface",
          "Documentation search covers every section",
        ],
      },
    },
    {
      version: "4.5.1",
      date: "2026-09-27",
      changes: {
        added: [],
        fixed: [
          "The FAQ raised a hydration error in the browser because one answer put a list inside a paragraph",
          "The Helm chart still declared appVersion 4.2.8 after 4.5.0 shipped, so a chart install without an explicit image tag pulled the old image. Chart 0.7.0 declares 4.5.1",
        ],
        improved: [
          "The waiting-for-access page shows where you are in the process — signed in, waiting for an admin, dashboards next — and gives you your GitHub login and numeric id to send to an admin with one click. It checks again every 15 seconds, has a Check now button, and still moves on by itself once a group is granted",
          "Version badges in the sidebar, sign-in and waiting pages show the full version instead of major.minor, so a patch release is visible",
          "Documentation now covers the two sign-in failures seen in practice with GITDASH_ALLOWED_ORGS: orgs that restrict OAuth Apps, and fine-grained tokens created under the user rather than the org",
        ],
      },
    },
    {
      version: "4.5.0",
      date: "2026-09-27",
      changes: {
        added: [
          "Organization-mode permissions: fixed groups (devops, security, dev, pm, admin), per-group feature grants, an admin area with users, a permission matrix and an audit log, and a waiting page for people without a group. Enforced on the server, rolled out behind GITDASH_RBAC_ENFORCE",
          "GitHub API caching: every GitHub read is cached per token and replicas share results through a Postgres table, keeping dashboards well inside the rate limit. Refresh buttons bypass every cache",
          "Personal access token sign-in in organization mode, with GITDASH_ALLOWED_ORGS to limit sign-in to members of your organizations",
          "A redesigned interface following the Graphite console design contract, and an intro video behind Explore the demo on the sign-in page",
        ],
        fixed: [],
        improved: [
          "Organization mode refuses to start without DATABASE_URL and GITDASH_ADMIN_GITHUB_IDS, and /api/health answers 503, so a misconfigured rollout never goes live half-working",
          "Alert destinations, AI and email settings and manual database sync are admin-only in organization mode",
        ],
      },
    },
    {
      version: "4.2.9",
      date: "2026-09-04",
      changes: {
        added: [
          "Pull-request data now syncs on its own schedule, so the four people-metrics alert rules that read it can actually fire",
          "The weekly Leadership Digest can be delivered to Slack as well as email",
          "Dashboard metrics can be exported as CSV or JSON",
          "An anomaly on a workflow can be filed as a GitHub issue from a confirmation dialog, using your own token. Off by default behind a feature flag",
        ],
        fixed: [],
        improved: [
          "Features that write to GitHub default to off and are excluded from Enable all, so one click can never arm them",
        ],
      },
    },
    {
      version: "4.2.8",
      date: "2026-08-16",
      changes: {
        added: [],
        fixed: [
          "Pages left a large band of empty space down the right-hand side on wide screens. Every page declared its own width cap — max-w-5xl on Security, max-w-6xl on Issues and Org Health, max-w-7xl on Team Analytics, none at all on Alerts and Reports — and none of them centred, so all the unused width collected in one block on the right rather than splitting evenly. On a 2000px display the Security page ended around 1010px with almost as much blank beside it as content",
          "The app now has a single centred content container, so every page agrees on width and stays centred at any viewport. The cap is deliberately generous because this is a dashboard — the PR leaderboard alone is nine columns, and narrowing those tables to a reading measure would trade one layout problem for another. The contributor print brief keeps its narrow measure, and the documentation keeps its prose width",
        ],
        improved: [],
      },
    },
    {
      version: "4.2.7",
      date: "2026-08-16",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [
          "The security panel blamed your token for problems it had not caused. GitHub answers with 403 both when a token is insufficient and when a security feature is simply switched off for a repository — and every 403 was mapped to \"Token lacks permission\", which told people to regenerate a PAT that was already sufficient. A 403 is now classified by its response body, so \"Code Security must be enabled for this repository\" is reported as \"Not enabled for this repo\" and never prompts a token change that could not have helped. Anything genuinely ambiguous still reports a permission problem, because that fix is at least in your hands",
          "The documented claim that reading security alerts requires the security_events scope was wrong. Measured against the API, a classic PAT with repo reads Dependabot, code scanning and secret scanning alerts. The panel warning and the Security documentation now say what is actually needed, and the fine-grained PAT permissions — which genuinely are separate — are named on their own",
        ],
        improved: [],
      },
    },
    {
      version: "4.2.6",
      date: "2026-08-15",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "The deployments panel now separates \"no deployments recorded in the last 30 days\" from \"none ever recorded\". A repository with deployment history whose newest record is older than the window is flagged \"Recording stopped\", with the total on record and how long ago the last one was — a gap that usually means the pipeline was replaced or its deploy step removed, which the previous wording hid entirely",
        ],
        fixed: [
          "\"This repository has no deployments\" read as \"you do not deploy\", which was misleading on repositories that deploy daily through GitHub Actions. The panel now states the actual mechanism: GitHub only writes a deployment record when a job declares an environment: key or something calls the Deployments API, so a deploy workflow without one is invisible to these metrics. The one-line fix is named directly",
        ],
        improved: [],
      },
    },
    {
      version: "4.2.5",
      date: "2026-08-15",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "The deployment environment driving the headline figures is now selectable — click any row under \"By environment\". Auto-detection can only ever guess when a repository deploys to several production targets, so choosing beats guessing better. The choice is remembered per repository",
          "Every environment now carries its own deploys/day, change failure rate and MTTR, so switching is instant and environments can be compared directly",
        ],
        fixed: [
          "The collapsible card header built for Team Analytics in v4.0.11 was left as a local function in that one page, so the DORA drill-down and PR lifecycle toggles on the repository overview kept their original bare \"› Show …\" text style. Extracted to a shared component and applied to both — the inconsistency was obvious once polished cards sat directly beneath a plain text link",
        ],
        improved: [],
      },
    },
    {
      version: "4.2.4",
      date: "2026-08-15",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [
          "Deployment metrics showed 0.00 deploys/day with a null failure rate on repositories that deploy constantly. Status lookups are capped at 40 per request, and were taken from the most recent deployments overall — so on a busy repo none of them belonged to the chosen production environment, leaving every headline figure empty. The production environment is now selected first and its statuses resolved first, with the remaining budget covering other environments",
          "Environment matching used exact names, so a platform-labelled environment like \"Production — my-app\" was skipped in favour of a bare, stale \"Production\". Matching is now word-boundary based, and within a tier the busiest environment wins. Word boundaries also stop \"main\" matching names like \"domain-staging\"",
          "Deploy frequency reported 0.00 when no production status could be resolved. 0.00 asserts that a team ships nothing; the honest answer when statuses are unknown is that we cannot say, so it now returns null like the change failure rate and MTTR already did",
        ],
        improved: [
          "The partial-sample note now explains that production is resolved first, so headline figures are complete even when other environments are sampled",
        ],
      },
    },
    {
      version: "4.2.3",
      date: "2026-08-15",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Command palette on ⌘K (Ctrl+K on Windows) — jump to any repository or page from anywhere. Repo-scoped destinations like Team, Issues and Security appear only while you are inside a repository, since they are meaningless without knowing which one",
          "Fuzzy matching over both the repository name and owner/name, so \"acme/api\" finds what you expect. The repository list is fetched lazily on first open and shares its SWR key with the repositories page, so it costs nothing when that data is already cached",
        ],
        fixed: [],
        improved: [
          "All 11 outstanding lint warnings resolved — the codebase is now completely clean. Worth stating what they were NOT: every one was an authentication transition (sign-out, PAT change, session expiry, first login) where a full page reload is deliberate, because it discards the SWR cache populated under the old token",
          "Converting those to router.push() would have been a regression: the previous session's cached data would remain in memory and could render after sign-out. They are now documented in place with the reason, rather than silently suppressed or wrongly \"fixed\"",
        ],
      },
    },
    {
      version: "4.2.2",
      date: "2026-08-15",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Issue & Triage Health — a new page at /repos/[owner]/[repo]/issues covering the half of engineering GitDash could not see. PRs, CI and deployments measure supply; issues are where work arrives, and a backlog growing faster than it drains is a leading indicator no delivery metric will show you",
          "Backlog direction (opened vs closed in the window), median and p90 time to close, an age distribution of the open backlog, label and assignee breakdowns, and the oldest open issue",
          "Two triage-debt signals: unlabelled open issues (work that arrived but was never routed) and issues open 14+ days with not a single comment (someone reported it and heard nothing back)",
        ],
        fixed: [],
        improved: [
          "Pull requests are excluded from every issue metric. GitHub's REST API returns PRs from the issues endpoint, so counting them would report delivery throughput as triage throughput — wrong in a direction that looks entirely plausible. There is a dedicated test for it",
          "Costs three paginated calls with no per-issue fan-out. Time-to-first-response would need one call per issue, so \"issues nobody has commented on\" is used instead — a cheaper signal for the same worry",
          "Counts are labelled as a floor rather than a total when the sample cap is hit, since the list is ordered by recent activity and quiet old issues fall outside it",
        ],
      },
    },
    {
      version: "4.2.1",
      date: "2026-08-15",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Deployments panel on the repository overview, using GitHub's Deployments API — real deploy frequency, change failure rate and MTTR, plus a per-environment breakdown and recent rollout history",
          "MTTR is measured from the first failure of a streak to the next successful deploy on the same environment, which is when things actually broke rather than the last symptom before the fix",
        ],
        fixed: [],
        improved: [
          "DORA figures now state their provenance. Until now deploy frequency came from Releases (falling back to counting every merged PR), and change failure rate from PRs whose branch matched /hotfix|revert|emergency/ — so a team that does not tag releases had its merge rate reported as its deploy rate, and a team that does not name branches \"hotfix\" got a change failure rate of exactly 0%, which reads as excellence rather than as no signal",
          "Measured figures never silently replace estimated ones. When a repo has no deployments the panel explains what the existing numbers actually mean instead of hiding, so you always know which you are reading",
          "Only successful production deploys count toward frequency — a failed rollout is not a delivery. Pending and in-progress deploys are excluded from the failure rate entirely, and a rate with nothing conclusive reports null rather than a flattering 0%",
        ],
      },
    },
    {
      version: "4.2.0",
      date: "2026-08-15",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "GitHub Security Alerts on the Security page — vulnerable dependencies (Dependabot), code scanning findings, and exposed secrets, with severity counts, age of the oldest open alert, and mean time to remediate per source. Until now the page only lint-checked workflow YAML and showed none of GitHub's own findings",
          "Exposed secrets are always ranked critical: those alerts carry no severity field, and a live credential needs no triage debate",
        ],
        fixed: [],
        improved: [
          "An unreadable source can never look like a clean one. Each source reports its own status, and a permission failure renders as a loud actionable warning rather than an empty list — on a security page, conflating \"we couldn't look\" with \"nothing found\" would let a token gap read as safety",
          "Reading these alerts needs the security_events scope, which GitDash has never requested. When a source returns 403 the panel says exactly that and how to fix it, for both classic and fine-grained tokens",
          "The page is now titled \"Security\" rather than \"Workflow Security\", since it covers more than workflow files",
        ],
      },
    },
    {
      version: "4.1.5",
      date: "2026-08-15",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Bring-your-own AI provider in organization mode — Settings → AI Provider lets a team choose its own provider (Bailian, Gemini or Qwen), model, API key and optional base URL, instead of using whatever the server operator configured. Stored in the database (migration 6)",
          "Standalone deployments are deliberately unchanged: the section does not appear and the environment defaults apply, so a self-hosted instance still works out of the box with no setup",
        ],
        fixed: [],
        improved: [
          "A configured org key is used EXCLUSIVELY — the server's own keys are never tried as a fallback behind it. Falling back would silently bill the deployment owner for an organization's traffic, which is a surprise best discovered before an invoice rather than after",
          "The API key is write-only and encrypted at rest with the same AES-256-GCM helper as email credentials; the UI shows a masked hint, and a blank field keeps the stored key. Base URLs must be https, since that URL carries the key",
          "aiEnabled() and configuredProviders() are now async so they can account for a stored override; /api/ai/status reports which source is actually in effect",
        ],
      },
    },
    {
      version: "4.1.4",
      date: "2026-08-14",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "AI executive summary in the Weekly Leadership Digest — 4-6 sentences of plain prose at the top of the Monday email, written for a reader who will not open the dashboard. Costs zero extra GitHub calls: it reuses the scorecard the digest already computed",
          "The rule-based narrative is passed to the model as an anchor it may reprioritise and rephrase but never contradict, so the two halves of the email cannot disagree in front of a CTO. The AI section is explicitly labelled so a reader always knows which half a machine wrote",
        ],
        fixed: [
          "The leadership digest email interpolated repository names and narrative text into an HTML body without escaping. With model-generated text now in that body, all fields are escaped — the plain-text alternative is left as-is, since it is not markup",
        ],
        improved: [
          "The digest sends regardless of AI. Missing keys, provider errors, timeouts, an exhausted budget, unparseable output, and an outright throw all degrade to the rule-based narrative alone — covered by a test per failure mode",
          "The prompt forbids week-over-week claims. Because the email is weekly, models reached for \"unchanged from last week\" phrasing the data cannot support: the scorecard has no previous week, and its trend field compares halves of a 30-day window",
        ],
      },
    },
    {
      version: "4.1.3",
      date: "2026-08-14",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Email Delivery settings — configure Resend or SendGrid from Settings instead of environment variables, so enabling alert emails, daily digests and the Weekly Leadership Digest no longer needs a redeploy. Stored in the database (migration 5)",
          "\"Send test email\" button. Email was previously the one feature whose misconfiguration was invisible — an alert or a Monday digest simply never arrived, and the only trace was a server log",
          "The API key is write-only: it is encrypted at rest with AES-256-GCM (keyed from SESSION_SECRET) and never returned to the browser. The UI shows a masked hint like \"••••4f2a\", and leaving the field blank keeps the stored key",
        ],
        fixed: [
          "The SMTP_HOST documentation was actively misleading. That path has never spoken the SMTP protocol — it POSTs to SendGrid's HTTP API at ${SMTP_HOST}/v3/mail/send — so the documented example smtp.yourprovider.com could never work, and SMTP_PORT was never read at all. The example is corrected and the limitation stated plainly",
          "Provider selection was duplicated across three send paths with three copies of the same env-var branching. Now resolved once in resolveEmailProvider()",
        ],
        improved: [
          "Existing env-var setups are untouched: resolution is database-first with an environment fallback, so an instance already using RESEND_API_KEY keeps working after upgrading and only switches over when someone explicitly enables email in Settings",
          "Email config is instance-wide, like alert rules — any authenticated user can change it, so the settings record and display who last changed it and when",
        ],
      },
    },
    {
      version: "4.1.2",
      date: "2026-08-14",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "AI Failure Hypotheses — when a workflow has 3+ recent failures, the Reliability tab offers ranked likely causes with the specific evidence behind each and a confidence level. Inferred from failed job and step names, timing shifts, trigger/branch clustering and workflow-file change dates — never from run logs, which GitDash does not fetch for any feature",
          "Confidence is validated against a literal allowlist (high/medium/low) rather than coerced, and rank is re-derived from position because models routinely emit duplicate or out-of-order ranks",
        ],
        fixed: [],
        improved: [
          "Job detail is fetched only for runs that actually failed (capped at 10) instead of every run in the window — roughly 10 GitHub calls rather than 30-50, keeping the expensive part proportional to the problem rather than the window size",
          "The GitHub fan-out is cached separately from the LLM call on this route. Elsewhere the cache is fingerprinted on the snapshot, so a hit still pays the fan-out; here the fan-out is the expensive part and gets its own key",
        ],
      },
    },
    {
      version: "4.1.1",
      date: "2026-08-14",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "AI Anomaly Explanations — each flagged metric on the Workflow Detail reliability tab gains a \"Why did duration spike?\" button that explains the outliers from surrounding metadata: baseline statistics, when the workflow file last changed, and the trigger mix. Lazy by design — opening the tab costs nothing until you ask",
          "Bailian (Alibaba Cloud) added as a third provider and tried first. It speaks the Anthropic Messages API rather than the OpenAI shape, so the provider layer now models the wire format explicitly instead of assuming one protocol",
        ],
        fixed: [],
        improved: [
          "Extended thinking is disabled on Bailian requests. Qwen models there enable it by default, costing roughly 10x the output tokens for no benefit on structured extraction — measured 799 vs 85 output tokens on an identical request. The response parser still picks the text block explicitly, in case a model ignores the flag",
        ],
      },
    },
    {
      version: "4.1.0",
      date: "2026-08-14",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "AI Insights — an optional card on the Repository Overview and Team Health Scorecard pages that turns the metrics already on screen into plain-English analysis: what changed, why it matters, and what to do next. Gemini primary with Qwen fallback, both via their OpenAI-compatible endpoints, so no vendor SDK is installed",
          "Entirely opt-in: with no provider key configured on the server, every AI surface is hidden and GitDash behaves exactly as it did in v4.0.11. New \"AI Insights\" toggle in Settings → Feature Flags, and a new /api/ai/status capability probe",
          "Privacy is enforced at the type level: prompts are built server-side from an allowlisted snapshot, and the test suite walks the serialized output to fail the build if a token, log, commit message, file path or URL ever appears. Metrics, names, logins and dates are sent; code, logs, YAML and message bodies never are",
          "Cost controls: 15-minute snapshot-fingerprinted caching, 20 requests/minute per token, a per-attempt and total wall-clock timeout, and a daily token budget (AI_DAILY_TOKEN_BUDGET). All in-process, so they bound cost per instance rather than globally — documented as a damage-limiter, not a hard spend cap",
        ],
        fixed: [],
        improved: [],
      },
    },
    {
      version: "4.0.11",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [],
        improved: [
          "Team Analytics page redesign, implemented from a second Claude Design import (\"Section Headers\"): PR Leaderboard, Reviewer Load Matrix, Review Bottleneck, Workload Risk Radar, Bus Factor Map, and Runner Utilization now use a polished card-style collapsible header with a live data count badge, instead of a plain chevron-and-text toggle. Content components unchanged — same API, same data",
        ],
      },
    },
    {
      version: "4.0.10",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [],
        improved: [
          "Team Health Scorecard loading state: a spinner + \"Collecting data across up to N repositories…\" status line now sits above the skeleton tiles, so a slow fetch (or one hitting GitHub's rate limits) visibly reads as working rather than frozen",
        ],
      },
    },
    {
      version: "4.0.9",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [
          "Every page logged \"Error with Permissions-Policy header: Unrecognized feature: 'interest-cohort'\" — a stale FLoC-related directive no browser recognizes anymore. Removed; camera/microphone/geolocation stay disabled",
        ],
        improved: [],
      },
    },
    {
      version: "4.0.8",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [],
        improved: [
          "Team Health Scorecard redesign, implemented from a Claude Design import: estate-distribution card + stat tiles in the header, a proper grouped table (column headers, risk-band sections with count chips), interactive filter/sort pills, and bus-factor pip indicators. Presentational only — same API, same data",
        ],
      },
    },
    {
      version: "4.0.7",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [
          "Team Health Scorecard had no visible entry point from the main dashboard — the only labeled link lived in the /org/[orgName] header, reachable solely via an unlabeled icon-only \"Org overview\" button. The main dashboard header now shows a labeled \"Team Health Scorecard\" button directly whenever an org is selected",
        ],
        improved: [],
      },
    },
    {
      version: "4.0.6",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [
          "The four v4.0.0–v4.0.3 features (Team Health Scorecard, Workload Risk Radar, 1:1 Prep Sheet, Leadership Digest) were only mentioned in changelog prose — no dedicated Features doc page, no sidebar entry, so they were effectively undiscoverable outside this release-notes tab. Each now has a full feature page with a \"New in vX.Y\" badge",
          "Feature Overview index still labeled Team Insights \"(In Development)\" and Contributor Profile \"(Coming Soon)\" even though both have been fully built for several releases",
        ],
        improved: [
          "New VersionBadge convention: any doc content added for a new feature (or a meaningful addition to an existing one) now carries a \"New in vX.Y\" pill, so what's new stays visible outside the changelog",
        ],
      },
    },
    {
      version: "4.0.5",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [
          "Contributor profile failed with \"Failed to fetch contributor profile\" whenever the repo owner is a personal GitHub account rather than an organization — the route always called GET /orgs/{org}/repos, which 404s for personal accounts. Now falls back to GET /users/{username}/repos on 404",
        ],
        improved: [],
      },
    },
    {
      version: "4.0.4",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Org switcher: \"Go to org by name\" input, always available — reaches any org directly regardless of what GitHub's org-discovery API returns for your token",
        ],
        fixed: [
          "Org switcher showed only \"Personal repos\" with no explanation or workaround when GitHub's orgs.listForAuthenticatedUser API returned an empty list (stale OAuth scope, fine-grained PAT, or org visibility settings) — now explains why and offers the manual org input as a fallback",
          "Navigating to an org not in the auto-discovered list incorrectly showed \"Personal Repos\" as the page title even though the repo list was correctly filtered to that org",
        ],
        improved: [],
      },
    },
    {
      version: "4.0.3",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Weekly Leadership Digest — narrative org-wide summary emailed every Monday. New leadership_digest alert metric in the Alerts page (pick an org + email, no threshold or window needed). Reuses the Team Health Scorecard's computation; no new database table, no \"last sent\" state — the daily cron just checks if today is Monday",
        ],
        fixed: [],
        improved: [],
      },
    },
    {
      version: "4.0.2",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "1:1 Prep Sheet — one-click manager brief at /contributor/[login]/brief: period-over-period PR/review/cycle-time comparison plus auto-generated talking points (conversation prompts, not verdicts). Print-friendly. Zero extra GitHub API calls — reuses the contributor profile's existing data and SWR cache",
        ],
        fixed: [],
        improved: [],
      },
    },
    {
      version: "4.0.1",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Workload Risk Radar — team-wide people-risk signals: sustained after-hours/weekend work, activity cliffs (\"went quiet\"), and concurrent-PR overload. New Team Analytics section, framed as a conversation-starter rather than a verdict",
        ],
        fixed: [],
        improved: [],
      },
    },
    {
      version: "4.0.0",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Team Health Scorecard — org-wide ranked view (Healthy / Watch / At Risk) combining DORA tier and bus-factor risk per repo, worst-first, with a throughput trend. New page at /org/[orgName]/health",
        ],
        fixed: [],
        improved: [
          "Bus-factor calculation extracted into a reusable lib function (src/lib/bus-factor.ts) so the scorecard can compute it per-repo without an internal HTTP round trip; the existing /api/github/bus-factor route is unchanged in behavior",
        ],
      },
    },
    {
      version: "3.2.0",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Custom domain: production now serves from gitdash.info",
          "Scheduled background sync — daily Vercel Cron re-syncs every tracked repo so Reports and Alerts stay current without a manual click",
          "Rate-limit budget widget in the sidebar — live GitHub API quota, free to check (GET /rate_limit is excluded from rate-limit accounting)",
          "Runner Utilization — per-runner job counts, durations, and failure rates in Team Analytics",
          "Partial-data indicators — fan-out routes (bus-factor, open-pr-health, repo-contributors, contributor-profile, repo-dora) now report when some sub-requests were rate-limited and show an amber banner instead of an undercounted number",
          "Anomaly-driven alerts — new anomaly_count metric fires on statistical outliers using the same detector the workflow detail page already uses",
          "Digest alert channel — bundle matching alerts into one daily summary email instead of a notification per event",
          "Review Bottleneck — flags overloaded reviewers and single-point-of-failure review dependencies in Team Analytics",
        ],
        fixed: [
          "RecentFailuresWidget on the repo dashboard never showed newly-loaded failures — its cache-read memo depended on an identity-stable SWR cache object; now driven by a tick counter",
        ],
        improved: [
          "Consolidated all Recharts imports behind one shared module — eliminates duplicated ~388 KB chunks across routes",
          "DORA drill-down and PR lifecycle sections (collapsed by default on the repo page) now lazy-load via next/dynamic",
          "RepoRow on the home page is memoized — search keystrokes no longer re-render the full visible table",
          "Fan-out routes' batch-of-N loops converted to the bounded worker pool (pLimitSettled) — no more waiting on the slowest member of each batch",
        ],
      },
    },
    {
      version: "3.1.3",
      date: "2026-03-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "3.x release line — responsive mobile navigation, redesigned settings, global footer, demo mode, and test infrastructure (Vitest)",
          "DB-backed reporting and alert rules with browser and email delivery (Resend / SendGrid / SMTP)",
          "Cost analytics via the GitHub Enhanced Billing API",
          "Reverse-proxy / Zscaler support — redirects use the public-facing origin from x-forwarded headers; dedicated /api/health endpoint for Kubernetes probes",
        ],
        fixed: [
          "Middleware activation and reverse-proxy redirect fixes (issues #3, #4); ALWAYS_PUBLIC check now runs before the HTTPS redirect so probes and static assets are never redirected",
        ],
        improved: [
          "API Reference rebuilt to cover all REST endpoints; docs corrected (Neon Postgres only — no SQLite; middleware path is src/middleware.ts)",
          "See CHANGELOG.md for the full 3.0.0 → 3.1.3 history",
        ],
      },
    },
    {
      version: "2.10.1",
      date: "2026-03-03",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Feature Overview index page — 13 clickable feature cards replacing the long scroll, each navigates to a dedicated feature sub-page",
          "13 individual feature detail pages in docs (one per page in the app): Repositories, Repository Overview, Workflow Detail, Audit Trail, Security Scan, Repo Team Stats, Team Insights, Contributor Profile, Cost Analytics, Reports, Alerts, Settings, Org Overview",
          "Workflow Detail tabs section — each of the 5 tabs (Overview, Performance, Reliability, Triggers, Runs) now has its own card with description and screenshot slots; Performance shows a 2-column screenshot grid",
          "Screenshot slots in every feature page — drop a PNG into public/screenshots/<name>.png and it renders automatically; absent files show a placeholder with the expected filename",
          "Screenshots for Repositories, Workflow Detail (Overview, Performance, Reliability, Triggers, Runs), and Cost Analytics now pre-loaded from docs/screenshots/",
          "Sidebar sub-items for all 13 feature pages — visually indented, smaller text, lighter colour when inactive",
          "⌘K search index expanded with all 13 feature sub-pages (individually searchable with accurate excerpts)",
          "FeaturePageHeader shared component — consistent icon + name + path badge + chip row across all feature pages",
        ],
        fixed: [],
        improved: [
          "Full feature audit — API Reference and feature pages refreshed to match live code",
          "DocSearch section labels now distinguish Features / Reference / Support groups",
        ],
      },
    },
    {
      version: "2.9.0",
      date: "2026-03-03",
      badge: null,
      badgeColor: "",
      changes: {
        added: [
          "DORA 4 Keys at repository level — Deploy Frequency, Lead Time, CFR, MTTR computed from real merged PRs and GitHub Releases",
          "DORA drill-down charts: PR Cycle Time Breakdown (segmented bar), PR Size vs Velocity (scatter + regression line), PR Throughput (12-week bar), Workflow Stability (30d line with Elite/High reference lines)",
          "Team Insights page (/team) — global view with repo picker, sortable contributor leaderboard (8 metrics), and reviewer load heatmap",
          "Contributor Profile page (/contributor/[login]) — KPI cards, 52-week GitHub-style activity heatmap, weekly commit chart, PR lifecycle funnel, commit hour distribution, languages touched, recent PRs table",
          "Bus factor analysis — per-module contributor Herfindahl index, flags modules with <2 active contributors",
          "People-based alert metrics: PR throughput drop, review response P90, after-hours commit %, PR abandon rate, unreviewed PR age",
          "Reviewer Load Matrix component (author × reviewer heatmap) in both /team and repo team pages",
          "/api/github/repo-dora — new endpoint returning full RepoDoraSummary (5-min cache)",
          "/api/github/repo-contributors — new endpoint: per-contributor stats + reviewer matrix + bus factor",
          "/api/github/contributor-profile — new endpoint: full contributor data from PR, review, and commit APIs",
          "/api/github/bus-factor — new endpoint: per-module concentration analysis",
          "Docs redesigned to single-section navigation (opencode.ai style) — clicking nav replaces content, no more full-page scroll",
          "Prev / Next navigation at the bottom of each docs section",
        ],
        fixed: [],
        improved: [
          "Action Duration Trend (renamed from Duration Trend) on repo overview page",
          "Docs search (⌘K) now switches to the selected section instead of scrolling",
          "Version badge in sidebar reads from package.json via NEXT_PUBLIC_APP_VERSION at build time",
        ],
      },
    },
    {
      version: "2.3.0",
      date: "2026-03-01",
      badge: null,
      badgeColor: "",
      changes: {
        added: [
          "Modernized /docs page with component library, search, collapsible sidebar, IntersectionObserver ToC",
          "GitHub webhook receiver at /api/webhooks/github — workflow_run events auto-sync to Neon DB",
          "Alert rule evaluation wired into POST /api/db/sync — rules checked after every sync",
          "Slack webhook delivery for alert rules (channel=slack)",
          "/docs publicly accessible before authentication (no login required)",
        ],
        fixed: [
          "Sidebar no longer renders on /docs for unauthenticated visitors",
          "SWR global 401 handler no longer redirects away from /docs",
        ],
        improved: [
          "upsertRuns() replaced N+1 per-row SQL loop with single Neon HTTP transaction — up to 500× fewer round-trips per sync",
        ],
      },
    },
    {
      version: "2.2.0",
      date: "2026-02-20",
      badge: null,
      badgeColor: "",
      changes: {
        added: [
          "Reports page — DB-backed historical reporting with daily area chart and quarterly breakdown",
          "Alert rules CRUD UI at /alerts with per-repo and per-org scopes",
          "Neon PostgreSQL integration with idempotent schema migration (ensureSchema)",
          "POST /api/db/sync — incremental GitHub → DB sync with cursor tracking",
        ],
        fixed: [],
        improved: ["Sync cursor prevents re-fetching already-stored runs on repeated syncs"],
      },
    },
    {
      version: "2.1.0",
      date: "2026-02-10",
      badge: null,
      badgeColor: "",
      changes: {
        added: [
          "Cost Analytics page at /cost-analytics — GitHub Actions billing breakdown by SKU/runner type",
          "Monthly burn rate progress bar with warning/critical thresholds",
          "Org dashboard at /org/[orgName] — reliability heatmap and sortable repo table",
          "Audit tab, Security tab, Team stats tab at /repos/[owner]/[repo]/*",
        ],
        fixed: ["OAuth state now expires after 5 minutes to prevent stale CSRF tokens"],
        improved: ["Repo overview fetches up to 10 workflows in parallel batches of 5"],
      },
    },
    {
      version: "2.0.0",
      date: "2026-01-15",
      badge: null,
      badgeColor: "",
      changes: {
        added: [
          "Organization mode — GitHub OAuth App login with isolated per-user sessions",
          "Multi-arch Docker image (linux/amd64 + linux/arm64)",
          "iron-session v8 with AES-256-GCM cookie encryption",
          "HTTP security headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options",
          "Rate limiting on /api/auth/setup (5 req/min) and /api/auth/login (10 req/min)",
        ],
        fixed: [],
        improved: [
          "SESSION_SECRET minimum length enforced at startup in production",
          "Lazy Neon DB singleton — no build-time crash when DATABASE_URL is absent",
        ],
      },
    },
    {
      version: "1.0.0",
      date: "2025-12-01",
      badge: null,
      badgeColor: "",
      changes: {
        added: [
          "Initial release — standalone mode with PAT-based authentication",
          "Repositories list with fuzzy search and keyboard navigation",
          "Workflow dashboard with 5 tabs: Overview, Performance, Reliability, Triggers, Runs",
          "Auto-refresh every 30 seconds while runs are in-progress",
          "Browser notifications for new workflow failures (opt-in)",
          "CSV export from the Runs tab",
        ],
        fixed: [],
        improved: [],
      },
    },
  ];

  const chipColors: Record<string, string> = {
    added: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    fixed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    improved: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  };

  const dotColors: Record<string, string> = {
    added: "text-emerald-400",
    fixed: "text-blue-400",
    improved: "text-violet-400",
  };

  return (
    <section id="release-notes" className="scroll-mt-20 space-y-6">
      <SectionHeading id="release-notes" icon={Tag}>Release Notes</SectionHeading>
      <div className="space-y-4">
        {releases.map((r) => (
          <DocCard key={r.version}>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-lg font-bold text-white">v{r.version}</span>
              {r.badge && (
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${r.badgeColor}`}>
                  {r.badge}
                </span>
              )}
              <span className="text-xs text-slate-500">{r.date}</span>
            </div>

            <div className="space-y-4 pt-1">
              {(["added", "fixed", "improved"] as const).map((kind) => {
                const items = r.changes[kind];
                if (!items.length) return null;
                const label = kind === "added" ? "Added" : kind === "fixed" ? "Fixed" : "Improved";
                return (
                  <div key={kind}>
                    <span className={`inline-block text-xs px-2 py-0.5 rounded-full border font-semibold mb-2 ${chipColors[kind]}`}>
                      {label}
                    </span>
                    <ul className="space-y-1.5">
                      {items.map((item, i) => (
                        <li key={i} className={`flex items-start gap-2 text-sm text-slate-300`}>
                          <ChevronRight className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${dotColors[kind]}`} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </DocCard>
        ))}
      </div>
    </section>
  );
}
