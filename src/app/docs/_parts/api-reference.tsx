"use client";

import { Code2 } from "lucide-react";
import { Callout } from "@/components/docs/Callout";
import { Code } from "@/components/docs/CodeBlock";
import { DocCard, DocTable } from "@/components/docs/DocCard";
import { cn } from "@/lib/utils";
import { SectionHeading, SubHeading, ProseP } from "./primitives";

// ─────────────────────────────────────────────────────────────────────────────

export function APIReference() {
  return (
    <section id="api-reference" className="scroll-mt-20 space-y-6">
      <SectionHeading id="api-reference" icon={Code2} badge="REST">API Reference</SectionHeading>

      <Callout type="info">
        Every API route needs a signed-in session (unauthenticated requests get <Code>401</Code>) except{" "}
        <Code>/api/health</Code> (probes), <Code>/api/webhooks/github</Code> (HMAC signature) and{" "}
        <Code>/api/cron/*</Code> (<Code>CRON_SECRET</Code> bearer token). Parameters are query-string unless marked
        (body).
      </Callout>

      <DocCard>
        <SubHeading>Organization-mode responses</SubHeading>
        <DocTable
          headers={["Status", "code", "Meaning"]}
          rows={[
            ["403", <Code key="a">no_groups</Code>, "Signed in, but in no group yet (the page equivalent is /pending)."],
            ["403", <Code key="b">forbidden</Code>, <>The route&apos;s feature is not granted to any of your groups; <Code key="f">flag</Code> names it.</>],
            ["403", <Code key="c">unregistered</Code>, "The API route is not in the access registry, so it is denied by default."],
            ["403", <Code key="d">org_not_allowed</Code>, <>The account is not an active member of <Code key="o">GITDASH_ALLOWED_ORGS</Code>; the session is cleared.</>],
            ["503", <Code key="e">authz_unavailable</Code>, "GitHub or the database could not be reached to check access. Retry shortly."],
          ]}
        />
      </DocCard>

      {[
        {
          method: "GET",
          path: "/api/github/repos",
          description: "Personal repositories the signed-in token can see. Organization repositories come from /api/github/org-repos.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/github/repo-overview",
          description: "Per-workflow summaries for a repository — status, health, run history, trend, duration points.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/repo-dora",
          description: "Repository-level DORA 4 Keys computed from merged PRs and releases. Includes cycle breakdown, PR scatter, and throughput by week.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/repo-contributors",
          description: "Per-contributor delivery stats for a repository: PRs merged, reviews given, avg lead time, avg PR size, review turnaround, first-pass approval rate, self-merges. Also returns reviewer load matrix and bus factor.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/contributor-profile",
          description: "Full contributor profile: KPI cards, 52-week activity calendar, weekly commits, PR funnel, commit hour distribution, languages, recent PRs, and a period_comparison field (recent vs. prior 45 days) that powers the 1:1 Prep Sheet.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Org or user context for PR search." },
            { name: "login", type: "string", optional: false, desc: "GitHub username." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/workflows",
          description: "List all GitHub Actions workflows for a repository.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/runs",
          description: "Fetch workflow runs for a specific workflow (last 50 by default).",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
            { name: "workflow_id", type: "number", optional: false, desc: "Workflow ID." },
            { name: "per_page", type: "number", optional: true, desc: "Results per page (default 50, max 100)." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/job-stats",
          description: "Per-job and per-step timing stats for a workflow: avg, p50, p95, max durations, success/failure counts, waterfall data.",
          params: [
            { name: "per_page", type: "number", optional: true, desc: "Runs to sample (default 30)." },
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
            { name: "workflow_id", type: "number", optional: false, desc: "Workflow ID." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/team-stats",
          description: "CI-level team stats: per-actor run count, success rate, avg duration, activity by day/hour.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
            { name: "per_page", type: "number", optional: true, desc: "Runs to analyse (default 100)." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/bus-factor",
          description: "Bus factor analysis: per-file-prefix contributor count and Herfindahl index. Flags modules with fewer than 2 active contributors.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/org-health-scorecard",
          description: "Leadership rollup across every repo in an org: a composite health score (60% DORA tier + 40% bus-factor risk), risk band, and throughput trend, sorted worst-first.",
          params: [
            { name: "org", type: "string", optional: false, desc: "Organization slug." },
            { name: "limit", type: "number", optional: true, desc: "Repos to analyse (default 10, max 20 — this is an expensive fan-out)." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/team-workload-risk",
          description: "Team-wide people-risk signals for a repo: after-hours/weekend commit patterns, activity cliffs, and concurrent open-PR overload, per contributor. A conversation-starter signal, not a verdict.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/security-scan",
          description: "Static analysis of workflow YAML files for security anti-patterns. Returns findings grouped by severity.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/audit-log",
          description: "Commit history for all .github/workflows/*.yml files, sorted by date.",
          params: [
            { name: "limit", type: "number", optional: true, desc: "Commits to return (default 30)." },
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/repo-summary",
          description: "Lightweight per-repo summary — default branch, latest run status, workflow count, and health signal. Called lazily as repository rows enter the viewport.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/rate-limit",
          description: "Current GitHub API rate-limit status for the authenticated user. Calls GET /rate_limit, which GitHub excludes from rate-limit accounting — checking it is always free.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/github/runner-stats",
          description: "Per-runner job counts, durations, and failure rates aggregated across a repo's recent completed workflow runs.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
            { name: "per_page", type: "number", optional: true, desc: "Runs to analyse (default 30, max 50)." },
          ],
        },
        {
          method: "GET",
          path: "/api/cron/sync",
          description: "Scheduled background sync, triggered daily by Vercel Cron. Re-syncs every repo tracked in sync_cursors and sends pending digest-channel alert emails. Requires Authorization: Bearer $CRON_SECRET — not callable from the browser.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/github/run-details",
          description: "Job and step breakdown for a single workflow run: per-job status, timing, and step-level detail.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
            { name: "run_id", type: "number", optional: false, desc: "Workflow run ID." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/open-pr-health",
          description: "Open pull-request health for a repository: age, review rounds, draft state, and awaiting-review flags per PR.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/org-overview",
          description: "Aggregated org-level metrics across all active repositories — totals, active-repo count, and per-repo summaries. Expensive multi-request call (cached 15 min).",
          params: [
            { name: "org", type: "string", optional: false, desc: "Organization slug." },
            { name: "limit", type: "number", optional: true, desc: "Max repositories to analyse." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/org-repos",
          description: "List all repositories in an organization.",
          params: [
            { name: "org", type: "string", optional: false, desc: "Organization slug." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/orgs",
          description: "List organizations the authenticated user belongs to.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/github/billing",
          description: "GitHub Actions billing for the authenticated user or an org: minutes used, paid minutes, included minutes, and per-OS breakdown.",
          params: [
            { name: "org", type: "string", optional: true, desc: "Organization slug; omit for the authenticated user." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/billing/cost-analysis",
          description: "Detailed GitHub Actions cost breakdown via the Enhanced Billing API — per-product/SKU usage and spend for a given month. Some org/account combinations require fine-grained PAT permissions.",
          params: [
            { name: "org", type: "string", optional: false, desc: "Organization slug." },
            { name: "year", type: "number", optional: true, desc: "Billing year (defaults to current)." },
            { name: "month", type: "number", optional: true, desc: "Billing month 1–12 (defaults to current)." },
          ],
        },
        {
          method: "POST",
          path: "/api/db/sync",
          description: "Trigger incremental sync of GitHub workflow runs to the database. Checks alert rules after sync completes.",
          params: [
            { name: "org", type: "string", optional: true, desc: "Limit sync to a specific org." },
          ],
        },
        {
          method: "GET",
          path: "/api/db/runs",
          description: "Historical workflow runs from the Neon database (not the GitHub API). Requires DATABASE_URL; returns 0 results if the DB has no data for the repo yet.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
            { name: "limit", type: "number", optional: true, desc: "Max rows to return." },
            { name: "offset", type: "number", optional: true, desc: "Pagination offset." },
            { name: "conclusion", type: "string", optional: true, desc: "Filter by run conclusion (e.g. failure)." },
          ],
        },
        {
          method: "GET",
          path: "/api/db/trends",
          description: "Aggregated historical trend data from the Neon database — daily rollups for charts, quarterly summaries for year-over-year, or org-wide daily trends.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner (or org login for org trends)." },
            { name: "repo", type: "string", optional: true, desc: "Repository name (omit for org trends)." },
            { name: "type", type: "string", optional: true, desc: "daily (default), quarterly, or org." },
            { name: "days", type: "number", optional: true, desc: "Window for daily rollups." },
            { name: "quarters", type: "number", optional: true, desc: "Number of quarters for quarterly summaries." },
          ],
        },
        {
          method: "GET",
          path: "/api/db/working-habits",
          description: "Working habits from the database: per-person commit and pull-request size in merged pull requests, oversized commits and pull requests, thresholds, and sync coverage. Needs the workingHabits feature to see anyone; without it, a signed-in user may read only their own login. Returns available:false without DATABASE_URL and untrackedRepo:true for a repository GitDash does not sync.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: true, desc: "Repository name (omit for every tracked repository of the owner)." },
            { name: "login", type: "string", optional: true, desc: "Narrow to one person. Required without the workingHabits grant, and must be your own login." },
            { name: "days", type: "number", optional: true, desc: "30 (default) or 90, by merge date." },
          ],
        },
        {
          method: "POST",
          path: "/api/github/create-issue",
          description: "File a GitHub issue with the signed-in user's token (used by 'File anomaly as GitHub issue'). Needs the githubIssueFromAnomaly feature; limited to 5 per hour per IP.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "(body) Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "(body) Repository name." },
            { name: "title", type: "string", optional: false, desc: "(body) Issue title, up to 256 characters." },
            { name: "body", type: "string", optional: true, desc: "(body) Issue body, up to 10,000 characters." },
          ],
        },
        {
          method: "GET",
          path: "/api/admin/users",
          description: "Organization mode, admin only. Users who have signed in, with their groups and last-seen time.",
          params: [
            { name: "q", type: "string", optional: true, desc: "Filter by login." },
            { name: "group", type: "string", optional: true, desc: "Only users in this group." },
            { name: "limit", type: "number", optional: true, desc: "Page size (default 100)." },
            { name: "offset", type: "number", optional: true, desc: "Page offset." },
          ],
        },
        {
          method: "PUT",
          path: "/api/admin/users/[githubId]/groups",
          description: "Organization mode, admin only. Replace a user's groups (audited). Refused with 409 if it would leave no admin.",
          params: [
            { name: "groups", type: "string[]", optional: false, desc: "(body) Any of admin, devops, security, dev, pm." },
          ],
        },
        {
          method: "GET",
          path: "/api/admin/permissions",
          description: "Organization mode, admin only. The group × feature matrix and whether enforcement is on.",
          params: [],
        },
        {
          method: "PUT",
          path: "/api/admin/permissions",
          description: "Organization mode, admin only. Grant or revoke one feature for one group (audited). The admin group has every feature and is not editable.",
          params: [
            { name: "group", type: "string", optional: false, desc: "(body) devops, security, dev or pm." },
            { name: "flag", type: "string", optional: false, desc: "(body) Feature key, e.g. dora." },
            { name: "granted", type: "boolean", optional: false, desc: "(body) true to grant, false to revoke." },
          ],
        },
        {
          method: "GET",
          path: "/api/admin/audit",
          description: "Organization mode, admin only. Access changes, newest first.",
          params: [
            { name: "limit", type: "number", optional: true, desc: "Entries to return (default 50)." },
            { name: "before", type: "number", optional: true, desc: "Return entries older than this id." },
          ],
        },
        {
          method: "GET",
          path: "/api/cron/sync-pr-facts",
          description: "Nightly pull-request sync for the people-metric alert rules. Authenticated by the CRON_SECRET bearer token.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/cron/sync-commit-facts",
          description: "Nightly working-habits sync at 04:47 UTC: stores the commits of merged pull requests from the last 90 days with their size, then evaluates oversized_commit_pct alert rules. Stops starting new work after 240 s; the rest continues the next night. Authenticated by the CRON_SECRET bearer token.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/settings/working-habits",
          description: "Organization mode, admin only. Working-habits thresholds in effect (files and lines per commit, commits per pull request). PUT saves them.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/alerts",
          description: "List alert rules, optionally filtered by scope. Set events=1 to also return the 50 most recent alert events. In organization mode non-admins only see rules and events for repositories and orgs their own token can see, with delivery destinations hidden.",
          params: [
            { name: "scope", type: "string", optional: true, desc: "Filter to a scope, e.g. repo:owner/name." },
            { name: "events", type: "string", optional: true, desc: "Set to 1 to include recent alert events." },
          ],
        },
        {
          method: "POST",
          path: "/api/alerts",
          description: "Create an alert rule. metric=\"leadership_digest\" creates a Weekly Leadership Digest instead of a threshold rule — scope must be org:X, and threshold/window_hours are ignored (sent every Monday, no cadence to configure).",
          params: [
            { name: "scope", type: "string", optional: false, desc: "(body) Rule scope, e.g. repo:owner/name or org:myorg." },
            { name: "metric", type: "string", optional: false, desc: "(body) Metric to watch." },
            { name: "threshold", type: "number", optional: false, desc: "(body) Threshold that triggers the alert." },
            { name: "window_hours", type: "number", optional: true, desc: "(body) Evaluation window (default 24)." },
            { name: "channel", type: "string", optional: true, desc: "(body) Delivery channel (default browser)." },
            { name: "destination", type: "string", optional: true, desc: "(body) Email address for email delivery." },
          ],
        },
        {
          method: "PATCH",
          path: "/api/alerts",
          description: "Update an existing alert rule — enable/disable or change threshold, window, or destination. Admin only in organization mode (as are POST and DELETE).",
          params: [
            { name: "id", type: "number", optional: false, desc: "(body) Alert rule ID." },
          ],
        },
        {
          method: "DELETE",
          path: "/api/alerts",
          description: "Delete an alert rule.",
          params: [
            { name: "id", type: "number", optional: false, desc: "Alert rule ID." },
          ],
        },
        {
          method: "POST",
          path: "/api/alerts/test",
          description: "Send a test alert for a rule without a real threshold breach (uses a synthetic value of 1).",
          params: [
            { name: "rule_id", type: "number", optional: false, desc: "(body) Alert rule ID to test." },
          ],
        },
        {
          method: "POST",
          path: "/api/webhooks/github",
          description: "Receive GitHub workflow_run webhook events and upsert runs into the database. Authenticated by HMAC-SHA256 signature against GITHUB_WEBHOOK_SECRET — no session required. Rejects all requests if the secret is unset (fail-safe).",
          params: [],
        },
        {
          method: "GET",
          path: "/api/ai/status",
          description: "Capability probe for the AI layer. Returns { enabled, providers } — which providers have a key configured, never the key material. Not rate-limited (no LLM call).",
          params: [],
        },
        {
          method: "GET",
          path: "/api/ai/insights",
          description: "LLM synthesis of a repository's or org's metrics. Returns { ok, provider, model, generated_at, cached, partial, content: { summary, bullets, actions } }. 503 when no provider key is configured or the provider is unavailable; 429 when rate-limited (20/min per token) or the daily token budget is spent. Prompts are built from an allowlisted, metrics-only snapshot — never code, logs, or commit messages.",
          params: [
            { name: "owner", type: "string", optional: true, desc: "Repository owner (repo surface — pair with repo)" },
            { name: "repo", type: "string", optional: true, desc: "Repository name (repo surface)" },
            { name: "org", type: "string", optional: true, desc: "Organisation login (org surface — takes precedence over owner/repo)" },
            { name: "refresh", type: "1", optional: true, desc: "Bypass the cached generation. Still rate-limited." },
          ],
        },
        {
          method: "GET",
          path: "/api/ai/anomaly-explanation",
          description: "Explain a workflow metric's statistical outliers from surrounding metadata (baseline stats, workflow-file change dates, trigger mix). Returns { ok, provider, model, outlier_count, content: { explanation, check } }. 404 when the metric has no outliers to explain; 503 when unconfigured or unavailable; 429 when rate-limited (20/min per token). Never reads run logs.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner" },
            { name: "repo", type: "string", optional: false, desc: "Repository name" },
            { name: "workflow_id", type: "number", optional: false, desc: "Workflow ID" },
            { name: "metric", type: "duration | queue_wait", optional: false, desc: "Which metric's outliers to explain. Validated against a literal allowlist — arbitrary values are rejected, never forwarded to a prompt." },
          ],
        },
        {
          method: "GET",
          path: "/api/ai/root-cause",
          description: "Ranked hypotheses for why a workflow is failing, inferred from failed job/step names, timing shifts, trigger and branch clustering, and workflow-file change dates. Returns { ok, provider, model, failure_count, partial, content: { hypotheses[] } } where each hypothesis carries rank, evidence, confidence (high|medium|low) and next_step. Returns content: null below 3 recent failures — enforced server-side, no provider call. Rate-limited to 10/min per token, half the other AI surfaces. Never reads run logs.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner" },
            { name: "repo", type: "string", optional: false, desc: "Repository name" },
            { name: "workflow_id", type: "number", optional: false, desc: "Workflow ID" },
          ],
        },
        {
          method: "GET",
          path: "/api/github/issues",
          description: "Issue and triage health. Returns { open_count, opened_in_period, closed_in_period, backlog_delta, median_days_to_close, p90_days_to_close, stale_count, unlabelled_count, unanswered_count, age_buckets[], top_labels[], assignee_load[], neglected[], oldest_open, total_analysed, partial }. Pull requests are excluded — GitHub's issues endpoint returns both, and counting PRs would report delivery throughput as triage throughput.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner" },
            { name: "repo", type: "string", optional: false, desc: "Repository name" },
            { name: "days", type: "number", optional: true, desc: "Window in days, 7-90. Defaults to 30." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/deployments",
          description: "Measured delivery metrics from GitHub's Deployments API. Returns { source, production_environment, deploys_per_day, change_failure_rate_pct, mttr_hours, mttr_samples, by_environment[], recent[], partial, all_time_count, newest_deployment_at }. source is \"deployments\" when the window has data, \"stale\" when the repo has deployment history but none inside the window, and \"none\" when it has never recorded one — the caller keeps its release/PR estimates for the latter two rather than being handed zeros. all_time_count and newest_deployment_at describe history at any age, so a stale window can state how much exists and when it stopped. Rates exclude pending and in-progress deploys, and return null rather than 0% when nothing is conclusive.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner" },
            { name: "repo", type: "string", optional: false, desc: "Repository name" },
          ],
        },
        {
          method: "GET",
          path: "/api/github/security-alerts",
          description: "GitHub's own security findings: Dependabot, code scanning and secret scanning alerts. Returns { sources, alerts[], counts, total_open, oldest_open_days, partial, needs_scope } where each source carries its own status (ok | forbidden | not_enabled | error) plus 90-day fix count and mean time to remediate. A classic PAT with repo reads all three; no security_events scope is required. A 403 is classified by its response body — a disabled feature becomes not_enabled, a genuine permission failure becomes forbidden and sets needs_scope — so an unreadable source is never reported as a clean one, and a switched-off one never prompts a pointless token change.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner" },
            { name: "repo", type: "string", optional: false, desc: "Repository name" },
          ],
        },
        {
          method: "GET",
          path: "/api/settings/ai",
          description: "Current AI provider override. Returns { configurable, mode, enabled, provider, model, base_url, api_key_hint, has_key, updated_by, updated_at, effective_source, env_providers, db_available }. The API key is never returned — only a masked hint. configurable is false in standalone mode, where the section is hidden and environment defaults apply.",
          params: [],
        },
        {
          method: "PUT",
          path: "/api/settings/ai",
          description: "Save an AI provider override. Body: { enabled, provider (\"bailian\"|\"gemini\"|\"qwen\"), model, base_url, api_key? }. Omitting api_key preserves the stored one; the key is encrypted before storage. base_url must be https. 403 in standalone mode, 503 when no database is configured. A configured override is used exclusively — server keys are never a fallback behind it.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/settings/email",
          description: "Current email delivery configuration. Returns { enabled, provider, from_address, api_key_hint, has_key, updated_by, updated_at, effective_source, db_available }. The API key itself is never returned — only a masked hint. effective_source reports whether Settings, environment variables, or nothing is actually in effect.",
          params: [],
        },
        {
          method: "PUT",
          path: "/api/settings/email",
          description: "Save email delivery configuration. Body: { enabled, provider (\"resend\"|\"sendgrid\"), from_address, api_key? }. Omitting api_key preserves the stored one. The key is encrypted with AES-256-GCM before storage. Rejects enabling without a key or from address. 503 when no database is configured.",
          params: [],
        },
        {
          method: "POST",
          path: "/api/settings/email/test",
          description: "Send a test email through the currently-resolved provider to verify configuration. Body: { to }. Returns the provider's own error verbatim on failure (bad key, unverified sender) since it is actionable and contains no secret. Rate-limited to 3/min per token.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/health",
          description: "Liveness/readiness probe. Returns {\"status\":\"ok\"} with no authentication. Used by Kubernetes and load balancers.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/demo",
          description: "Sanitized fixture data for demo mode. No authentication required — the payload contains no real credentials.",
          params: [
            { name: "resource", type: "string", optional: false, desc: "repos, runs, or summary." },
            { name: "repo", type: "string", optional: true, desc: "Repository name for run/summary fixtures." },
            { name: "count", type: "number", optional: true, desc: "Number of synthetic runs to generate." },
          ],
        },
        {
          method: "POST",
          path: "/api/auth/setup",
          description: "Standalone mode: validate the submitted PAT and store it in an encrypted session cookie. Rate-limited.",
          params: [
            { name: "pat", type: "string", optional: false, desc: "(body) GitHub Personal Access Token." },
          ],
        },
        {
          method: "DELETE",
          path: "/api/auth/setup",
          description: "Standalone mode: clear the stored PAT (sign out).",
          params: [],
        },
        {
          method: "GET",
          path: "/api/auth/login",
          description: "Organization mode: begin the GitHub OAuth flow (redirects to GitHub). Rate-limited.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/auth/callback",
          description: "Organization mode: OAuth redirect target — verifies state, exchanges the code, and creates the session.",
          params: [
            { name: "code", type: "string", optional: false, desc: "OAuth authorization code (set by GitHub)." },
            { name: "state", type: "string", optional: false, desc: "CSRF state token (set by GitHub)." },
          ],
        },
        {
          method: "POST",
          path: "/api/auth/logout",
          description: "Destroy the session cookie and sign the user out.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/auth/me",
          description: "Return the current session identity (login, mode), or 401 if unauthenticated.",
          params: [],
        },
      ].map((endpoint) => (
        <DocCard key={`${endpoint.method} ${endpoint.path}`}>
          <div className="flex items-center gap-3 mb-3">
            <span className={cn(
              "text-xs font-mono font-bold px-2.5 py-1 rounded-lg",
              endpoint.method === "GET"
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                : "bg-blue-500/15 text-blue-400 border border-blue-500/20"
            )}>
              {endpoint.method}
            </span>
            <code className="text-sm font-mono text-white font-semibold">{endpoint.path}</code>
          </div>
          <ProseP>{endpoint.description}</ProseP>
          {endpoint.params.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-500 mb-2">Parameters</p>
              <DocTable
                headers={["Name", "Type", "Required", "Description"]}
                rows={endpoint.params.map((p) => [
                  <Code key={p.name}>{p.name}</Code>,
                  <span key="t" className="text-slate-500 text-xs font-mono">{p.type}</span>,
                  p.optional
                    ? <span key="r" className="text-slate-500 text-xs">Optional</span>
                    : <span key="r" className="text-amber-400 text-xs font-medium">Required</span>,
                  <span key="d" className="text-xs">{p.desc}</span>,
                ])}
              />
            </div>
          )}
        </DocCard>
      ))}
    </section>
  );
}
