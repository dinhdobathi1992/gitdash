/**
 * Static docs search index — one summary per docs page. Plain module (not a
 * client component) so server pages can reuse the summaries as descriptions.
 */

export type SearchResult = {
  id: string;
  title: string;
  section: string;
  excerpt: string;
};

export const SEARCH_INDEX: SearchResult[] = [
  { id: "getting-started", title: "Introduction", section: "Docs", excerpt: "What GitDash is, standalone vs organization mode, what it measures." },
  { id: "quick-start", title: "Quick start", section: "Docs", excerpt: "Run locally with pnpm, standalone or organization mode, OAuth App, token scopes, fine-grained PAT." },
  { id: "deployment", title: "Deployment", section: "Docs", excerpt: "Docker Hub image dinhdobathi/gitdash, docker compose, Helm chart values, Vercel, reverse proxy, health probe." },
  { id: "configuration", title: "Configuration", section: "Docs", excerpt: "Environment variables: SESSION_SECRET, MODE, DATABASE_URL, GITDASH_ADMIN_GITHUB_IDS, GITDASH_ALLOWED_ORGS, GITDASH_RBAC_ENFORCE, cron, webhook, email, AI keys, demo mode, signed-in MCP: GITDASH_MCP, MCP_ALLOW_DCR, MCP_NATIVE_SCHEMES, MCP_PREVIOUS_SESSION_SECRET, second OAuth callback." },
  { id: "modes", title: "Auth modes", section: "Docs", excerpt: "Standalone vs organization, sign-in with GitHub OAuth or personal access token, switching modes." },
  { id: "access-control", title: "Access control", section: "Docs", excerpt: "Groups admin devops security dev pm, feature grants, Admin users permissions audit, pending page, enforcement, rollout, sign-in refused, OAuth App restrictions." },
  { id: "caching", title: "Caching & rate limits", section: "Docs", excerpt: "GitHub API budget, in-memory and shared Postgres cache api_cache, refresh button, GITDASH_L2_CACHE, GITDASH_GH_LOG." },
  { id: "security", title: "Security model", section: "Docs", excerpt: "Token never in the browser, encrypted session (iron-session AES-256-CBC + HMAC-SHA256), proxy.ts, cross-site protection, rate limits, headers, container user." },
  { id: "core-concepts", title: "Data sources", section: "Docs", excerpt: "Live GitHub data, database history, nightly sync crons, workflow_run webhook, Reports sync." },
  { id: "features", title: "Feature overview", section: "Features", excerpt: "Every screen in sidebar order with the feature switch that controls it." },
  { id: "feat-repositories", title: "Repositories", section: "Features", excerpt: "Home: summary strip, needs attention, filters, sort, pin, keyboard shortcuts, health scorecard." },
  { id: "feat-repo-overview", title: "Repository · Overview", section: "Features", excerpt: "DORA four keys, deployments, run duration, outcomes, jobs that fail most, AI summary." },
  { id: "feat-repo-workflows", title: "Repository · Workflows", section: "Features", excerpt: "All workflows with status, success rate, last 10 runs, p95." },
  { id: "feat-repo-pulls", title: "Repository · Pull requests", section: "Features", excerpt: "Time to first review, open PR age, review rounds, stale and unreviewed PRs, concurrent PRs by author." },
  { id: "feat-repo-team", title: "Repository · Team", section: "Features", excerpt: "CI contributors, PR leaderboard, reviewer load, review bottleneck, workload risk, bus factor, runner utilization." },
  { id: "feat-issues", title: "Repository · Issues", section: "Features", excerpt: "Backlog direction, time to close, triage debt, backlog by age." },
  { id: "feat-security", title: "Repository · Security", section: "Features", excerpt: "Dependabot, code scanning, secret scanning alerts, workflow static analysis." },
  { id: "feat-audit", title: "Repository · Audit trail", section: "Features", excerpt: "History of changes to workflow files." },
  { id: "feat-workflow", title: "Workflow detail", section: "Features", excerpt: "Overview, runs, performance, reliability, anomaly detection, triggers, DORA, file anomaly as GitHub issue." },
  { id: "feat-alerts", title: "Alerts", section: "Features", excerpt: "Alert rules on CI and people metrics, Slack, email, digest, leadership digest, delivery history, admin only." },
  { id: "feat-team", title: "Team insights", section: "Features", excerpt: "Contributors of a repository, reviewer heatmap, cycle time, self-merges." },
  { id: "feat-contributor", title: "Contributor & 1:1 prep", section: "Features", excerpt: "Contributor profile, 52-week activity, PR funnel, commit hours, 1:1 prep sheet brief." },
  { id: "feat-cost", title: "Cost", section: "Features", excerpt: "GitHub Actions spend by day, runner type and repository, savings ideas, billing permissions." },
  { id: "feat-reports", title: "Reports", section: "Features", excerpt: "Historical trends and quarterly comparison from the database, sync now." },
  { id: "feat-org", title: "Org overview & health", section: "Features", excerpt: "Organization summary, team health scorecard Healthy Watch At risk." },
  { id: "feat-settings", title: "Settings", section: "Features", excerpt: "My features, notifications, access by group, members, AI provider, email and digests, audit log." },
  { id: "feat-ai-insights", title: "AI insights", section: "Features", excerpt: "AI summaries, anomaly explanations, failure hypotheses, providers, privacy, bring your own key." },
  { id: "metrics-reference",    title: "Metrics Reference",       section: "Reference", excerpt: "Index of all metrics categories in GitDash: DORA, PR cycle, reliability, performance, team, alerts." },
  { id: "metrics-dora",         title: "DORA 4 Keys",             section: "Reference", excerpt: "Deploy Frequency, Lead Time for Changes, Change Failure Rate, MTTR. Repo-level DORA from merged PRs and GitHub Releases. DORA levels: Elite, High, Medium, Low." },
  { id: "metrics-pr-cycle",     title: "PR Cycle Time",           section: "Reference", excerpt: "Four PR phases: Time to Open, Pickup Time, Review Time, Merge Time. Proportional bar chart on repo overview page." },
  { id: "metrics-pr-health",    title: "PR Lifecycle Health",     section: "Reference", excerpt: "Open PRs, Review P50, Review P90, Abandon Rate, Age Distribution, Review Rounds, Stale PRs, Concurrent WIP by author." },
  { id: "metrics-workflow",     title: "Workflow Overview",       section: "Reference", excerpt: "Rolling Success Rate, Action Duration Trend, Outcome Breakdown, Run Frequency, Optimization Tips banner." },
  { id: "metrics-performance",  title: "Performance Tab",         section: "Reference", excerpt: "Job Duration avg vs p95, Job Composition per Run stacked chart, Slowest Steps table with AVG, P95, MAX, SUCCESS %." },
  { id: "metrics-reliability",  title: "Reliability Tab",         section: "Reference", excerpt: "MTTR, Failure Streak, Flaky Branches, Re-run Rate, Pass/Fail Timeline, Anomaly Detection (stddev outliers)." },
  { id: "metrics-team",         title: "Team & People",           section: "Reference", excerpt: "PRs Merged, Reviews Given, Avg Lead Time, First-Pass Approval Rate, Self-Merges, After-Hours %, Reviewer Load Matrix, Bus Factor HHI." },
  { id: "metrics-ci-alerts",    title: "CI & Alert Metrics",      section: "Reference", excerpt: "CI-based DORA vs repo-level DORA differences. Alert rules: Failure Rate, Duration P95, PR Throughput Drop, Review Response P90." },
  { id: "mcp",                  title: "MCP server",              section: "Reference", excerpt: "Connect Claude, Cursor or any MCP client. /mcp: public docs tools, no sign-in. /mcp/me: sign in with GitHub for seven read-only data tools (repos, CI, DORA, PRs, cost); revoke apps in Settings → Connected apps; needs GITDASH_MCP." },
  { id: "api-reference",        title: "API Reference",           section: "Reference", excerpt: "REST endpoints: repo-dora, repo-contributors, contributor-profile, bus-factor, security-scan, audit-log, runs, job-stats, db/sync." },
  { id: "faq", title: "FAQ & troubleshooting", section: "Support", excerpt: "Sign-in refused, pending page, state mismatch, blank screen, cost 404, fine-grained PAT, updating, org switcher." },
  { id: "contributing", title: "Contributing", section: "Support", excerpt: "Local setup, checks, where things live, registering API routes, pull request guidelines." },
  { id: "release-notes", title: "Release notes", section: "Support", excerpt: "What changed in each version." },
  { id: "privacy", title: "Data & privacy", section: "Support", excerpt: "What a GitDash instance stores, where and for how long, what leaves it (including the encrypted token an AI app receives), the mcp_grants tables, and how to remove your data." },
];
