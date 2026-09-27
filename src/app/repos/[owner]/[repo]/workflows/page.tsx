"use client";

/** Repository → Workflows tab: the full workflow list (contract §11.1). */

import useSWR from "swr";
import { useParams } from "next/navigation";
import { fetcher } from "@/lib/swr";
import type { WorkflowOverview } from "@/lib/github";
import { RepoPage } from "@/components/repo/RepoHeader";
import { WorkflowsTable } from "@/components/repo/WorkflowsTable";
import { ErrorBanner } from "@/components/ui/Card";
import { useNow } from "@/lib/use-alerts";

export default function RepoWorkflowsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const now = useNow();
  const { data, error, isLoading, mutate } = useSWR<WorkflowOverview[]>(
    `/api/github/repo-overview?owner=${owner}&repo=${repo}`,
    fetcher<WorkflowOverview[]>,
  );
  return (
    <RepoPage owner={owner} repo={repo}>
      {error && <ErrorBanner message={`Couldn't load workflows: ${(error as Error).message}`} onRetry={() => mutate()} />}
      <WorkflowsTable owner={owner} repo={repo} workflows={data ?? []} now={now} loading={isLoading} />
      {data && data.length >= 10 && (
        <p className="text-xs text-faint">Showing the first 10 workflows GitHub returns for this repository.</p>
      )}
    </RepoPage>
  );
}
