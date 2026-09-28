"use client";

import { useState, useEffect } from "react";
import { Search, X, ChevronRight } from "lucide-react";

type SearchResult = {
  id: string;
  title: string;
  section: string;
  excerpt: string;
};

// Static search index built from section content
const SEARCH_INDEX: SearchResult[] = [
  { id: "getting-started", title: "Introduction", section: "Docs", excerpt: "What GitDash is, standalone vs organization mode, what it measures." },
  { id: "quick-start", title: "Quick start", section: "Docs", excerpt: "Run locally with pnpm, standalone or organization mode, OAuth App, token scopes, fine-grained PAT." },
  { id: "deployment", title: "Deployment", section: "Docs", excerpt: "Docker Hub image dinhdobathi/gitdash, docker compose, Helm chart values, Vercel, reverse proxy, health probe." },
  { id: "configuration", title: "Configuration", section: "Docs", excerpt: "Environment variables: SESSION_SECRET, MODE, DATABASE_URL, GITDASH_ADMIN_GITHUB_IDS, GITDASH_ALLOWED_ORGS, GITDASH_RBAC_ENFORCE, cron, webhook, email, AI keys, demo mode." },
  { id: "modes", title: "Auth modes", section: "Docs", excerpt: "Standalone vs organization, sign-in with GitHub OAuth or personal access token, switching modes." },
  { id: "access-control", title: "Access control", section: "Docs", excerpt: "Groups admin devops security dev pm, feature grants, Admin users permissions audit, pending page, enforcement, rollout, sign-in refused, OAuth App restrictions." },
  { id: "caching", title: "Caching & rate limits", section: "Docs", excerpt: "GitHub API budget, in-memory and shared Postgres cache api_cache, refresh button, GITDASH_L2_CACHE, GITDASH_GH_LOG." },
  { id: "security", title: "Security model", section: "Docs", excerpt: "Token never in the browser, encrypted session, proxy.ts, cross-site protection, rate limits, headers, container user." },
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
  { id: "api-reference",        title: "API Reference",           section: "Reference", excerpt: "REST endpoints: repo-dora, repo-contributors, contributor-profile, bus-factor, security-scan, audit-log, runs, job-stats, db/sync." },
  { id: "faq", title: "FAQ & troubleshooting", section: "Support", excerpt: "Sign-in refused, pending page, state mismatch, blank screen, cost 404, fine-grained PAT, updating, org switcher." },
  { id: "contributing", title: "Contributing", section: "Support", excerpt: "Local setup, checks, where things live, registering API routes, pull request guidelines." },
  { id: "release-notes", title: "Release notes", section: "Support", excerpt: "What changed in each version." },
];

function highlight(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-violet-500/30 text-violet-200 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function DocSearch({
  onSelect,
  open,
  onClose,
}: {
  onSelect: (id: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const results = query.length >= 2
    ? SEARCH_INDEX.filter((r) =>
        r.title.toLowerCase().includes(query.toLowerCase()) ||
        r.excerpt.toLowerCase().includes(query.toLowerCase())
      )
    : SEARCH_INDEX;

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-xl bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-700/50">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            autoFocus
            type="text"
            placeholder="Search docs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 outline-none"
          />
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">No results for &ldquo;{query}&rdquo;</p>
          ) : (
            <ul className="py-2">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/60 transition-colors group"
                    onClick={() => {
                      onSelect(r.id);
                      onClose();
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white group-hover:text-violet-300 transition-colors">
                        {highlight(r.title, query)}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {highlight(r.excerpt, query)}
                      </p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-violet-400 shrink-0 transition-colors" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-slate-700/50 bg-slate-950/40">
          <span className="text-xs text-slate-600">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-xs">↑↓</kbd>
            {" "}navigate
          </span>
          <span className="text-xs text-slate-600">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-xs">↵</kbd>
            {" "}select
          </span>
          <span className="text-xs text-slate-600">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-xs">Esc</kbd>
            {" "}close
          </span>
        </div>
      </div>
    </div>
  );
}
