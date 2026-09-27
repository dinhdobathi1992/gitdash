"use client";

/**
 * Repository → Pull requests tab (contract §11.2). Hosts the pull request
 * lifecycle section that used to sit collapsed on Overview.
 */

import dynamic from "next/dynamic";
import useSWR from "swr";
import { useParams } from "next/navigation";
import { fetcher } from "@/lib/swr";
import type { OpenPrHealthResponse } from "@/app/api/github/open-pr-health/route";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import { RepoPage } from "@/components/repo/RepoHeader";
import { ErrorBanner } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";

const PrLifecycleExtension = dynamic(
  () => import("@/components/PrLifecycleExtension").then((m) => m.PrLifecycleExtension),
  { ssr: false, loading: () => <PrSkeleton /> },
);

function PrSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="card h-[120px] skeleton" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="card h-[240px] skeleton" />)}
      </div>
    </div>
  );
}

export default function RepoPullsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { flags } = useFeatureFlags();
  const { data, error, isLoading, mutate } = useSWR<OpenPrHealthResponse>(
    flags.prLifecycle ? `/api/github/open-pr-health?owner=${owner}&repo=${repo}` : null,
    fetcher<OpenPrHealthResponse>,
  );

  return (
    <RepoPage owner={owner} repo={repo}>
      {!flags.prLifecycle ? (
        <div className="card flex items-center justify-between gap-4 px-5 py-4 text-sm text-muted">
          <span>Pull request lifecycle is turned off for you.</span>
          <LinkButton href="/settings?section=features" size="sm">Turn it on</LinkButton>
        </div>
      ) : error ? (
        <ErrorBanner message={`Couldn't load pull requests: ${(error as Error).message}`} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <PrSkeleton />
      ) : (
        <PrLifecycleExtension data={data} />
      )}
    </RepoPage>
  );
}
