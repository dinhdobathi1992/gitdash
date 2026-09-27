"use client";

/**
 * Repository header + underline tabs — design contract §4.3, `Repo` artboard.
 * Mono title with muted owner, a meta row, Pin + Open in GitHub, then tabs:
 * Overview · Workflows · Pull requests · Team · Issues · Security · Audit trail.
 *
 * Tab counts are read from the SWR cache only (no fetcher passed), so a
 * count appears once its page has loaded that data and never costs a call.
 */

import { usePathname } from "next/navigation";
import useSWR from "swr";
import { ExternalLink, Lock, Globe, Star } from "lucide-react";
import { cn, formatRelative } from "@/lib/utils";
import { fetcher } from "@/lib/swr";
import type { Repo, RepoSummary, WorkflowOverview } from "@/lib/github";
import type { OpenPrHealthResponse } from "@/app/api/github/open-pr-health/route";
import type { IssuesSummary } from "@/app/api/github/issues/route";
import type { SecurityAlertsResponse } from "@/lib/security-alerts";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { Button, LinkButton } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { useWatchlist } from "@/lib/watchlist";
import { repoHealth } from "@/lib/repo-health";
import { useNow } from "@/lib/use-alerts";
import { summaryKey } from "@/lib/use-repo-summaries";

export type RepoTab = "overview" | "workflows" | "pulls" | "team" | "issues" | "security" | "audit";

function tabFromPath(path: string, base: string): RepoTab {
  const rest = path.slice(base.length).split("/").filter(Boolean)[0];
  if (!rest) return "overview";
  if (["workflows", "pulls", "team", "issues", "security", "audit"].includes(rest)) return rest as RepoTab;
  return "overview";
}

export function RepoHeader({ owner, repo, className }: { owner: string; repo: string; className?: string }) {
  const path = usePathname();
  const base = `/repos/${owner}/${repo}`;
  const active = tabFromPath(path, base);
  const now = useNow();
  const fullName = `${owner}/${repo}`;
  const { isPinned, toggle } = useWatchlist();
  const pinned = isPinned(fullName);

  const { data: summary } = useSWR<RepoSummary>(summaryKey(owner, repo), fetcher<RepoSummary>);
  // Cache-only reads (no fetcher): repo metadata from the repositories list,
  // counts from sub-pages already visited.
  const { data: personal } = useSWR<Repo[]>("/api/github/repos");
  const { data: orgRepos } = useSWR<Repo[]>(`/api/github/org-repos?org=${owner}`);
  const { data: overview } = useSWR<WorkflowOverview[]>(`/api/github/repo-overview?owner=${owner}&repo=${repo}`);
  const { data: prs } = useSWR<OpenPrHealthResponse>(`/api/github/open-pr-health?owner=${owner}&repo=${repo}`);
  const { data: issues } = useSWR<IssuesSummary>(`/api/github/issues?owner=${owner}&repo=${repo}&days=30`);
  const { data: security } = useSWR<SecurityAlertsResponse>(
    `/api/github/security-alerts?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
  );

  const meta = (orgRepos ?? personal)?.find((r) => r.owner === owner && r.name === repo);
  const health = summary ? repoHealth(summary, now) : null;
  const wfCount = overview?.length;

  const tabs: TabItem[] = [
    { key: "overview", label: "Overview", href: base },
    { key: "workflows", label: "Workflows", href: `${base}/workflows`, count: wfCount },
    { key: "pulls", label: "Pull requests", href: `${base}/pulls`, count: prs?.total_open },
    { key: "team", label: "Team", href: `${base}/team` },
    { key: "issues", label: "Issues", href: `${base}/issues`, count: issues?.open_count },
    { key: "security", label: "Security", href: `${base}/security`, count: security?.total_open || null, countTone: "warning" },
    { key: "audit", label: "Audit trail", href: `${base}/audit` },
  ];

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-mono text-[22px] sm:text-[26px] leading-8 font-semibold tracking-[-0.01em] truncate">
            <span className="hidden sm:inline text-faint font-normal">{owner}/</span>
            <span className="text-fg">{repo}</span>
          </h1>
          <div className="mt-2 flex items-center gap-x-4 gap-y-1.5 flex-wrap text-[13px] text-muted">
            {health ? <StatusPill tone={health.tone} pulse={health.key === "running"}>{health.label}</StatusPill> : <span className="h-6 w-20 rounded-full skeleton" />}
            {meta && (
              <span className="inline-flex items-center gap-1.5">
                {meta.private ? <Lock className="w-3.5 h-3.5" aria-hidden="true" /> : <Globe className="w-3.5 h-3.5" aria-hidden="true" />}
                {meta.private ? "Private" : "Public"}
              </span>
            )}
            {meta?.language && <span>{meta.language}</span>}
            {summary?.latest_branch && <span className="font-mono">{summary.latest_branch}</span>}
            {wfCount !== undefined && <span>{wfCount} workflow{wfCount === 1 ? "" : "s"}</span>}
            {summary?.latest_run_at && <span>Last run {formatRelative(summary.latest_run_at, now)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => toggle(fullName)} aria-pressed={pinned}>
            <Star className={cn("w-4 h-4", pinned ? "fill-brand-fg text-brand-fg" : "text-muted")} aria-hidden="true" />
            {pinned ? "Pinned" : "Pin"}
          </Button>
          <LinkButton href={`https://github.com/${owner}/${repo}`} external className="hidden sm:inline-flex">
            Open in GitHub <ExternalLink className="w-3.5 h-3.5 text-muted" aria-hidden="true" />
          </LinkButton>
        </div>
      </div>
      <Tabs label="Repository sections" items={tabs} active={active} />
    </div>
  );
}

/** Page wrapper for every repository route: header + tabs, then content. */
export function RepoPage({ owner, repo, children }: { owner: string; repo: string; children: React.ReactNode }) {
  return (
    <div className="px-4 pt-5 pb-24 sm:px-6 lg:px-10 lg:pt-7 lg:pb-12">
      <RepoHeader owner={owner} repo={repo} />
      <div className="mt-7 flex flex-col gap-7">{children}</div>
    </div>
  );
}

/** Intro row for a repository tab: what this tab shows, plus its controls. */
export function SubPageIntro({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div className="min-w-0 max-w-3xl">
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 flex-wrap">{actions}</div>}
    </div>
  );
}
