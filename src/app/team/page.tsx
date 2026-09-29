"use client";

/**
 * Team insights v2 (TeamV2 design). One window for the whole page (30 or 90
 * days, `?days`), starting with "What stands out" — findings computed from
 * the numbers below, worst first — then the KPI strip, who reviews whom,
 * workload, the People table and working habits.
 *
 * Data: three repo-scoped APIs (contributors, workload, working habits) with
 * account links already applied on the server, joined by the pure engine in
 * src/lib/team-insights.ts. Sections the viewer is not granted are never
 * requested (src/lib/team-data-keys.ts). URL state: ?repo=owner/name&days&bots.
 */

import { Suspense, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useRouter, useSearchParams } from "next/navigation";
import { fetcher, FetchError, requestFresh } from "@/lib/swr";
import type { RepoContributorsWindowResponse } from "@/lib/team-contributors";
import type { TeamWorkloadRiskWindowResponse } from "@/app/api/github/team-workload-risk/route";
import type { IdentityLinksResponse } from "@/app/api/admin/identity-links/route";
import type { WorkingHabitsResponse } from "@/lib/working-habits";
import { buildTeamInsights, fmtHours } from "@/lib/team-insights";
import { parseTeamWindow, teamDataKeys, type TeamWindow } from "@/lib/team-data-keys";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import { useAuth } from "@/components/AuthProvider";
import { RepoPicker, useOrgRepoList } from "@/components/RepoPicker";
import { Page, PageHeading } from "@/components/ui/PageHeading";
import { KpiStrip } from "@/components/ui/KpiStrip";
import { ErrorBanner } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { StandsOut } from "@/components/team-v2/StandsOut";
import { ReviewPairs } from "@/components/team-v2/ReviewPairs";
import { WorkloadBars } from "@/components/team-v2/WorkloadBars";
import { PeopleTable } from "@/components/team-v2/PeopleTable";
import { WorkingHabitsPanel } from "@/components/WorkingHabitsPanel";
import { useWatchlist } from "@/lib/watchlist";

const DATA_PREFIXES = ["/api/github/repo-contributors?", "/api/github/team-workload-risk?", "/api/db/working-habits?"];

function dateRange(days: number): string {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const f = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${f(from)} – ${f(to)}`;
}

/** 403 from a gated route = not granted for real (the browser's flag list can be optimistic). */
const denied = (e: unknown) => e instanceof FetchError && e.status === 403;

async function send(url: string, method: "POST" | "DELETE", body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `HTTP ${res.status}`);
  }
}

function TeamContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { flags } = useFeatureFlags();
  const { isAdmin, resolvedMode } = useAuth();
  const { pinned } = useWatchlist();
  const { data: repos } = useOrgRepoList();
  const { mutate: globalMutate } = useSWRConfig();
  const [actionError, setActionError] = useState<string | null>(null);

  // ?repo=owner/name, else first pinned repo in this list, else the most recently updated.
  const chosen = params.get("repo");
  const fallback = useMemo(() => {
    if (!repos?.length) return "";
    return repos.find((r) => pinned.includes(r.full_name))?.full_name ?? repos[0].full_name;
  }, [repos, pinned]);
  const repoFullName = chosen ?? fallback;
  const [owner, repo] = repoFullName.split("/");
  const selected = owner && repo ? { owner, repo } : null;
  const days = parseTeamWindow(params.get("days"));
  const showBots = params.get("bots") === "1";
  const canManageLinks = isAdmin && resolvedMode === "organization";

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`/team?${next.toString()}`, { scroll: false });
  }

  const keys = teamDataKeys({
    owner: selected?.owner ?? null, repo: selected?.repo ?? null, days,
    flags: { workloadRisk: flags.workloadRisk, workingHabits: flags.workingHabits }, canManageLinks,
  });
  const contrib = useSWR<RepoContributorsWindowResponse>(keys.contributors, fetcher<RepoContributorsWindowResponse>);
  const work = useSWR<TeamWorkloadRiskWindowResponse>(keys.workload, fetcher<TeamWorkloadRiskWindowResponse>);
  const habits = useSWR<WorkingHabitsResponse>(keys.habits, fetcher<WorkingHabitsResponse>);
  const identity = useSWR<IdentityLinksResponse>(keys.identity, fetcher<IdentityLinksResponse>, { dedupingInterval: 0 });

  const grants = {
    workload: !!keys.workload && !denied(work.error),
    habits: !!keys.habits && !denied(habits.error),
  };

  const insights = useMemo(() => {
    if (!contrib.data) return null;
    return buildTeamInsights({
      contributors: contrib.data,
      workload: work.data ?? null,
      habits: habits.data ?? null,
      admin: canManageLinks ? identity.data ?? null : null,
      grants,
      showBots,
      repo: repoFullName,
    });
    // grants is derived from the SWR states below; listing them keeps the memo honest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contrib.data, work.data, habits.data, identity.data, canManageLinks, grants.workload, grants.habits, showBots, repoFullName]);

  /** After a link change: skip browser and server caches for every data URL, then refetch. */
  async function refreshAfterLinkChange() {
    const match = (u: string) => DATA_PREFIXES.some((p) => u.startsWith(p));
    requestFresh(match);
    await Promise.all([
      globalMutate((k) => typeof k === "string" && match(k)),
      identity.mutate(),
    ]);
  }

  async function act(fn: () => Promise<void>) {
    setActionError(null);
    try {
      await fn();
      await refreshAfterLinkChange();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }
  const onLink = (alias: string, primary: string) => act(() => send("/api/admin/identity-links", "POST", { alias, primary }));
  const onDistinct = (a: string, b: string) => act(() => send("/api/admin/identity-links/distinct", "POST", { a, b }));
  const onUnlink = (aliases: string[]) =>
    act(async () => { for (const a of aliases) await send(`/api/admin/identity-links?alias=${encodeURIComponent(a)}`, "DELETE"); });

  const loading = !!selected && !contrib.data && !contrib.error;
  const k = insights?.kpis;
  const meta = insights
    ? `${insights.meta.people} ${insights.meta.people === 1 ? "person" : "people"} · ${insights.meta.prs} pull requests · ${dateRange(days)}`
    : selected ? `Loading ${repo}…` : "Pick a repository to see its team";

  const avatars = useMemo(
    () => new Map((contrib.data?.contributors ?? []).map((c) => [c.login.toLowerCase(), c.avatar_url])),
    [contrib.data],
  );

  const aliases = useMemo(
    () => (canManageLinks && identity.data ? { aliases: new Set(identity.data.links.map((l) => l.alias_login)) } : null),
    [canManageLinks, identity.data],
  );

  return (
    <Page>
      <PageHeading
        title="Team insights"
        meta={<>{meta}{insights && <span className="text-faint"> · one window for the whole page</span>}</>}
        actions={
          <>
            <label className="flex items-center gap-2.5 text-[13px] text-muted">
              Repository
              <RepoPicker value={repoFullName} onChange={(v) => setParam("repo", v)} className="w-56" />
            </label>
            <SegmentedControl<"30" | "90">
              label="Time range"
              value={String(days) as "30" | "90"}
              onChange={(v) => setParam("days", v === "30" ? null : v)}
              options={[{ value: "30", label: "30d" }, { value: "90", label: "90d" }]}
            />
            <span className="flex items-center gap-2 text-[13px] text-muted">
              <Switch checked={showBots} onChange={(on) => setParam("bots", on ? "1" : null)} label="Show bots (they never count toward the team numbers)" />
              Include bots
            </span>
          </>
        }
      />

      {contrib.error && (
        <ErrorBanner message={`Couldn't load pull requests: ${(contrib.error as Error).message}`} onRetry={() => contrib.mutate()} />
      )}

      {selected && (
        <StandsOut
          findings={insights?.findings ?? []}
          suggestions={insights?.suggestions ?? []}
          coverage={insights?.coverage ?? null}
          loading={loading}
          error={contrib.error ? "Findings need the pull request data above." : null}
          onLink={onLink}
          onDistinct={onDistinct}
          actionError={actionError}
        />
      )}

      {selected && (
        <KpiStrip
          mobileCols={2}
          cells={[
            {
              key: "merged", label: "Merged", loading,
              value: k ? k.merged.toLocaleString() : "—",
              foot: k ? `${k.openedInWindow.toLocaleString()} opened in window` : undefined,
            },
            { key: "ttm", label: "Time to merge", loading, value: k ? fmtHours(k.medianHours) : "—", foot: "Median, open → merged" },
            {
              key: "human", label: "Reviewed by a human", loading,
              value: k ? <>{k.humanReviewed} <span className="text-base font-normal text-muted">/ {k.merged}</span></> : "—",
              tone: k && k.noHumanReview > 0 && k.noHumanReview >= k.merged / 2 ? "warn" : "default",
              foot: k ? (k.noHumanReview ? `${k.noHumanReview} merged with no review` : "Every merge was reviewed") : undefined,
            },
            {
              key: "bus", label: "Reviewers", loading,
              value: k?.bus ? String(k.bus.people) : "—",
              tone: k?.bus && k.bus.people <= 1 ? "warn" : "default",
              foot: k?.bus ? "Bus factor · aim for 2+" : "No human reviews in this window",
            },
            {
              key: "self", label: "Self-merged", loading,
              value: k ? k.selfMerged.toLocaleString() : "—",
              tone: k && k.selfMerged > 0 ? "warn" : "default",
              foot: k ? (k.selfMerged ? `${Math.round((k.selfMerged / Math.max(1, k.merged)) * 100)}% of merges` : "None this period") : undefined,
            },
          ]}
        />
      )}

      {selected && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <ReviewPairs pairs={insights?.pairs ?? null} owner={selected.owner} loading={loading} avatars={avatars} />
          <WorkloadBars
            workload={work.data ?? null}
            owner={selected.owner}
            loading={!!keys.workload && !work.data && !work.error}
            disabled={!grants.workload}
            error={work.error && !denied(work.error) ? `Couldn't load workload: ${(work.error as Error).message}` : null}
          />
        </div>
      )}

      {selected && (
        <PeopleTable
          people={insights?.people ?? []}
          botLine={insights?.botLine ?? null}
          showBots={showBots}
          onToggleBots={() => setParam("bots", showBots ? null : "1")}
          owner={selected.owner}
          repo={selected.repo}
          grants={grants}
          loading={loading}
          canUnlink={aliases}
          onUnlink={onUnlink}
        />
      )}

      {selected && grants.habits && (
        <WorkingHabitsPanel
          key={repoFullName}
          variant="team"
          owner={selected.owner}
          repo={selected.repo}
          days={days as TeamWindow}
          canChangeLimits={canManageLinks}
        />
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
