"use client";

/**
 * Team insights — `Team` artboard, contract §9.
 * 5-cell KPI strip incl. review bus factor · who-reviews-whom heatmap ·
 * workload to watch · contributors table. Data is per repository (the
 * contributor APIs are repo-scoped); the picker defaults to your first
 * pinned repository, else the most recently updated one, and is kept in
 * the URL (?repo=owner/name) so the view can be shared.
 */

import { Suspense, useMemo } from "react";
import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";
import { fetcher } from "@/lib/swr";
import type { RepoContributorsResponse } from "@/app/api/github/repo-contributors/route";
import type { TeamWorkloadRiskResponse } from "@/app/api/github/team-workload-risk/route";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import { RepoPicker, useOrgRepoList } from "@/components/RepoPicker";
import PartialDataBadge from "@/components/PartialDataBadge";
import { Page, PageHeading } from "@/components/ui/PageHeading";
import { KpiStrip } from "@/components/ui/KpiStrip";
import { ErrorBanner } from "@/components/ui/Card";
import { ReviewHeatmap } from "@/components/team/ReviewHeatmap";
import { WorkloadList } from "@/components/team/WorkloadList";
import { ContributorsTable } from "@/components/team/ContributorsTable";
import { useWatchlist } from "@/lib/watchlist";
import { reviewBusFactor, medianPositive } from "@/lib/team-metrics";

function fmtHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

function TeamContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { flags } = useFeatureFlags();
  const { pinned } = useWatchlist();
  const { data: repos } = useOrgRepoList();

  // ?repo=owner/name, else first pinned repo in this list, else the most recently updated.
  const chosen = params.get("repo");
  const fallback = useMemo(() => {
    if (!repos?.length) return "";
    return repos.find((r) => pinned.includes(r.full_name))?.full_name ?? repos[0].full_name;
  }, [repos, pinned]);
  const repoFullName = chosen ?? fallback;
  const [owner, repo] = repoFullName.split("/");
  const selected = owner && repo ? { owner, repo } : null;

  function pick(full: string) {
    const next = new URLSearchParams(params.toString());
    next.set("repo", full);
    router.replace(`/team?${next.toString()}`, { scroll: false });
  }

  const { data, error, isLoading, mutate } = useSWR<RepoContributorsResponse>(
    selected ? `/api/github/repo-contributors?owner=${selected.owner}&repo=${selected.repo}` : null,
    fetcher<RepoContributorsResponse>,
  );
  const { data: workload, isLoading: workloadLoading } = useSWR<TeamWorkloadRiskResponse>(
    selected && flags.workloadRisk ? `/api/github/team-workload-risk?owner=${selected.owner}&repo=${selected.repo}` : null,
    fetcher<TeamWorkloadRiskResponse>,
  );

  const k = useMemo(() => {
    const c = data?.contributors ?? [];
    const merged = c.reduce((s, x) => s + x.prs_merged, 0);
    const opened = c.reduce((s, x) => s + x.prs_opened, 0);
    const reviews = c.reduce((s, x) => s + x.reviews_given, 0);
    const self = c.reduce((s, x) => s + x.self_merge_count, 0);
    return {
      merged, opened, reviews, self,
      cycle: medianPositive(c.map((x) => x.avg_hours_to_merge)),
      bus: reviewBusFactor(c.map((x) => x.reviews_given)),
    };
  }, [data]);

  const loading = isLoading || (!data && !error && !!selected);
  const meta = data
    ? `${data.contributors.length} contributors · ${k.opened} pull requests in ${repo} · last ${data.period_days} days`
    : selected ? `Loading ${repo}…` : "Pick a repository to see its team";

  return (
    <Page>
      <PageHeading
        title="Team insights"
        meta={meta}
        actions={
          <label className="flex items-center gap-2.5 text-[13px] text-muted">
            Repository
            <RepoPicker value={repoFullName} onChange={pick} className="w-56" />
          </label>
        }
      />

      {error && <ErrorBanner message={`Couldn't load contributors: ${(error as Error).message}`} onRetry={() => mutate()} />}
      {data?.partial && <PartialDataBadge fetched={data.fetched_prs} total={data.total_prs_attempted} unit="pull requests" />}

      {selected && (
        <KpiStrip
          cells={[
            {
              key: "merged",
              label: "Pull requests merged",
              loading,
              value: k.merged.toLocaleString(),
              foot: k.opened ? `of ${k.opened} opened · ${Math.round((k.merged / k.opened) * 100)}%` : "None opened in this window",
            },
            { key: "cycle", label: "Median cycle time", loading, value: fmtHours(k.cycle), foot: "median of contributors' averages" },
            {
              key: "reviews",
              label: "Reviews given",
              loading,
              value: k.reviews.toLocaleString(),
              foot: k.merged ? `${(k.reviews / k.merged).toFixed(1)} per merged pull request` : "—",
            },
            {
              key: "bus",
              label: "Review bus factor",
              loading,
              value: k.bus ? String(k.bus.people) : "—",
              tone: k.bus && k.bus.people <= 2 ? "warn" : "default",
              foot: k.bus ? (
                <span className={k.bus.people <= 2 ? "text-status-warn-text" : undefined}>
                  {k.bus.people} {k.bus.people === 1 ? "person does" : "people do"} {k.bus.share}% of reviews
                </span>
              ) : "No reviews in this window",
            },
            {
              key: "self",
              label: "Self-merged",
              loading,
              value: k.self.toLocaleString(),
              tone: k.self > 0 ? "warn" : "default",
              foot: k.merged ? `${Math.round((k.self / k.merged) * 100)}% of merges` : "—",
            },
          ]}
        />
      )}

      {data && data.contributors.length === 0 && (
        <p className="card px-5 py-5 text-sm text-muted">No merged pull requests in <span className="font-mono">{repoFullName}</span> in this window.</p>
      )}

      {data && data.contributors.length > 0 && selected && (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            <ReviewHeatmap matrix={data.reviewer_matrix} owner={selected.owner} />
            <WorkloadList
              people={workload?.people ?? []}
              owner={selected.owner}
              loading={workloadLoading}
              disabled={!flags.workloadRisk}
              windowDays={workload?.window_days}
            />
          </div>
          <ContributorsTable rows={data.contributors} owner={selected.owner} repo={selected.repo} workload={workload?.people ?? []} />
        </>
      )}

      {loading && !data && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className="card h-[380px] skeleton" />
          <div className="card h-[380px] skeleton" />
        </div>
      )}
    </Page>
  );
}

export default function TeamInsightsPage() {
  return (
    <Suspense fallback={<div className="px-10 pt-8 text-sm text-muted">Loading…</div>}>
      <TeamContent />
    </Suspense>
  );
}
