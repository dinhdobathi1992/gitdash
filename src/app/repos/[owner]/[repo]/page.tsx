"use client";

/**
 * Repository overview — `Repo` / `MobileRepo` artboards, contract §9.
 * AI summary · delivery performance (4 DORA cards + estimation note) ·
 * run duration + outcomes · workflows preview. Pull request lifecycle now
 * lives on its own tab (/pulls).
 */

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import useSWR from "swr";
import { useParams } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { fetcher } from "@/lib/swr";
import type { WorkflowOverview } from "@/lib/github";
import type { RepoDoraSummaryWithFetchStatus } from "@/lib/github-dora";
import { DoraKpiCards, DoraKpiSkeleton } from "@/components/DoraKpiCards";
import PartialDataBadge from "@/components/PartialDataBadge";
import AiInsightsCard from "@/components/AiInsightsCard";
import DeploymentsPanel from "@/components/DeploymentsPanel";
import CollapsibleSection from "@/components/CollapsibleSection";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import { RepoPage } from "@/components/repo/RepoHeader";
import { RunDurationChart } from "@/components/repo/RunDurationChart";
import { OutcomesCard } from "@/components/repo/OutcomesCard";
import { WorkflowsTable } from "@/components/repo/WorkflowsTable";
import { ErrorBanner } from "@/components/ui/Card";
import { useNow } from "@/lib/use-alerts";

// Collapsed by default and Recharts-heavy: load only when expanded.
const DoraDrillDown = dynamic(
  () => import("@/components/DoraDrillDown").then((m) => m.DoraDrillDown),
  { ssr: false },
);

export default function RepoDetailPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { flags } = useFeatureFlags();
  const now = useNow();
  const [showDrillDown, setShowDrillDown] = useState(false);

  const { data: overview, error, isLoading, mutate } = useSWR<WorkflowOverview[]>(
    `/api/github/repo-overview?owner=${owner}&repo=${repo}`,
    fetcher<WorkflowOverview[]>,
  );
  const { data: dora, isLoading: doraLoading, error: doraError } = useSWR<RepoDoraSummaryWithFetchStatus>(
    flags.dora ? `/api/github/repo-dora?owner=${owner}&repo=${repo}` : null,
    fetcher<RepoDoraSummaryWithFetchStatus>,
  );

  const workflows = overview ?? [];
  const noWorkflows = !isLoading && !error && workflows.length === 0;

  return (
    <RepoPage owner={owner} repo={repo}>
      {error && (
        <ErrorBanner message={`Couldn't load workflows: ${(error as Error).message}`} onRetry={() => mutate()} />
      )}

      {/* Renders nothing unless the server has AI provider keys. */}
      {!noWorkflows && <AiInsightsCard surface="repo" owner={owner} repo={repo} />}

      {flags.dora && (
        <section id="delivery" aria-labelledby="delivery-title" className="flex flex-col gap-3 scroll-mt-20">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <h2 id="delivery-title" className="text-[15px] font-semibold text-fg">Delivery performance</h2>
              <span className="text-[13px] text-faint">DORA · last {dora?.deployment_frequency.period_days ?? 30} days</span>
            </div>
            {dora && (
              <p className="text-xs text-muted">
                {dora.releases_analysed > 0
                  ? `Deploys counted from ${dora.releases_analysed} GitHub releases.`
                  : "Estimated from merged pull requests — this repo doesn't publish GitHub releases."}{" "}
                <Link href="/docs#metrics-dora" className="font-medium text-link hover:text-violet-200">How it&apos;s measured</Link>
              </p>
            )}
          </div>
          {doraLoading ? (
            <DoraKpiSkeleton />
          ) : doraError ? (
            <ErrorBanner message="Couldn't load delivery metrics for this repository." />
          ) : dora ? (
            <>
              {dora.partial && <PartialDataBadge fetched={dora.fetched_prs} total={dora.total_prs_attempted} unit="PRs" />}
              <DoraKpiCards data={dora} />
              <DeploymentsPanel owner={owner} repo={repo} />
              <CollapsibleSection
                icon={BarChart3}
                tone="violet"
                title="DORA drill-down"
                subtitle="Cycle time breakdown, pull request size against speed, throughput and workflow stability"
                open={showDrillDown}
                onToggle={() => setShowDrillDown((v) => !v)}
              >
                {overview ? <DoraDrillDown dora={dora} overview={overview} /> : <p className="text-sm text-muted">Workflow data is still loading.</p>}
              </CollapsibleSection>
            </>
          ) : null}
        </section>
      )}

      {noWorkflows ? (
        <p className="card px-5 py-5 text-sm text-muted">This repository has no GitHub Actions workflows.</p>
      ) : (
        <>
          <div className="hidden sm:grid grid-cols-1 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] gap-4">
            {isLoading ? (
              <>
                <div className="card h-[330px] skeleton" />
                <div className="card h-[330px] skeleton" />
              </>
            ) : (
              <>
                <RunDurationChart workflows={workflows} />
                <OutcomesCard owner={owner} repo={repo} workflows={workflows} now={now} jobsEnabled={flags.performanceTab} />
              </>
            )}
          </div>
          <WorkflowsTable owner={owner} repo={repo} workflows={workflows} now={now} limit={6} loading={isLoading} />
        </>
      )}
    </RepoPage>
  );
}
