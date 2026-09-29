"use client";

/**
 * Working habits — commit and PR size per engineer (GET /api/db/working-habits).
 *
 * `team` (Team insights v2): the page-wide window, This repo / All repos,
 * three summary cells and the oversized commits grouped by pull request
 * (per-person shares live in the People table). `profile` (contributor
 * profile): one person's share and their largest commits, with its own
 * window. No rank numbers anywhere — this is for coaching, not a league table.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ChevronRight } from "lucide-react";
import { fetcher, FetchError } from "@/lib/swr";
import type { WorkingHabitsCommit, WorkingHabitsResponse } from "@/lib/working-habits";
import { Card, CardHeader, ErrorBanner } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cn } from "@/lib/utils";

type Days = "30" | "90";
type Scope = "repo" | "owner";

const COLLAPSED_ROWS = 15;

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function tone(pct: number) {
  if (pct > 40) return { bar: "bg-status-fail-text", text: "text-status-fail-text" };
  if (pct >= 20) return { bar: "bg-status-warn-text", text: "text-status-warn-text" };
  return { bar: "bg-faint", text: "text-fg" };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const shortSha = (sha: string) => sha.slice(0, 7);
const repoName = (full: string) => full.split("/").pop() ?? full;

/** Freshness and coverage — always visible, warning tone while the backfill runs. */
function CoverageLine({ data }: { data: WorkingHabitsResponse }) {
  const { coverage, thresholds: t } = data;
  return (
    <p className={cn("mt-3 text-xs", coverage.complete ? "text-muted" : "text-status-warn-text")}>
      Updated {ago(coverage.lastSyncedAt)} · {coverage.analysedPrs} of {plural(coverage.mergedPrs, "merged pull request")} analysed
      {!coverage.complete && " · backfill in progress, figures may change"}
      <span className="text-faint"> · Limits: {t.maxCommitFiles} files · {t.maxCommitLines} lines per commit · {t.maxPrCommits} commits per pull request</span>
    </p>
  );
}

/** The states where there is nothing to count; null when the data should render. */
function EmptyState({ data }: { data: WorkingHabitsResponse }) {
  let message: string | null = null;
  if (!data.available) message = "Needs the database (DATABASE_URL) and the nightly pull request sync.";
  else if (data.noTrackedRepos) message = "No repositories of this owner are synced yet. GitDash syncs a repository once an admin runs Sync from GitHub on it in Reports.";
  else if (data.untrackedRepo) message = "Not tracked: this repository has no GitHub Actions history, so GitDash does not sync its pull requests.";
  else if (data.coverage.mergedPrs > 0 && data.coverage.analysedPrs === 0) message = "Waiting for the first nightly sync.";
  else if (data.totals.commits === 0 && data.totals.prs === 0) message = "No merged pull requests in this window.";
  return message ? <p className="mt-4 text-sm text-muted">{message}</p> : null;
}

function CommitsList({ data, person, limit }: { data: WorkingHabitsResponse; person: string | null; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const rows = data.commits.filter((c) => !person || c.person.toLowerCase() === person.toLowerCase());
  const cap = limit ?? (expanded ? rows.length : COLLAPSED_ROWS);
  if (!rows.length) return <p className="mt-2 text-[13px] text-muted">None over the limit.</p>;
  return (
    <>
      <ul className="mt-2">
        {rows.slice(0, cap).map((c) => (
          <li key={`${c.repo}@${c.sha}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-t border-line text-[13px]">
            <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-mono text-link hover:underline">{shortSha(c.sha)}</a>
            <a href={`https://github.com/${c.repo}/pull/${c.prNumber}`} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-fg">
              {repoName(c.repo)}#{c.prNumber}
            </a>
            {!person && <span className="font-mono text-fg">{c.author}</span>}
            <span className="font-mono text-muted tabular-nums">
              {c.files === null ? "? files" : plural(c.files, "file")} · <span className="text-status-pass-text">+{c.additions}</span> <span className="text-status-fail-text">−{c.deletions}</span>
            </span>
            <span className="text-xs text-status-warn-text">over {c.reasons.join(" and ")} limit</span>
            {!c.authorLinked && <span className="text-xs text-faint">credited via PR author</span>}
          </li>
        ))}
      </ul>
      {limit === undefined && rows.length > COLLAPSED_ROWS && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 text-xs text-muted hover:text-fg">
          {expanded ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}

const FOOTNOTE =
  "Counts commits inside merged pull requests, so squash merges are measured correctly. Commits pushed straight to the default branch aren't counted. Bars are relative to the largest commit.";

export function WorkingHabitsPanel({ owner, repo, login, variant, days: pageDays, canChangeLimits }: {
  owner: string;
  repo?: string;
  /** Profile variant: the person to show. */
  login?: string;
  variant: "team" | "profile";
  /** Team variant: the page-wide window (the profile keeps its own toggle). */
  days?: 30 | 90;
  /** Team variant: show "Change limits" (admins, organization mode). */
  canChangeLimits?: boolean;
}) {
  const [ownDays, setDays] = useState<Days>("30");
  const days: Days = variant === "team" && pageDays ? (String(pageDays) as Days) : ownDays;
  const [scope, setScope] = useState<Scope>("repo");

  const url = useMemo(() => {
    // Same key order as teamDataKeys(), so the repo-scope request is shared with the page.
    const q = new URLSearchParams(variant === "team" && scope === "repo" && repo ? { owner, repo, days } : { owner, days });
    if (variant === "profile" && login) q.set("login", login);
    return `/api/db/working-habits?${q.toString()}`;
  }, [owner, repo, login, days, scope, variant]);

  const { data, error, isLoading, mutate } = useSWR<WorkingHabitsResponse>(owner ? url : null, fetcher<WorkingHabitsResponse>);

  // Not granted (the browser's flag list can say otherwise when RBAC enforcement
  // is off; the API checks the real grant): show nothing rather than an error.
  if (error instanceof FetchError && error.status === 403) return null;

  const windowToggle = (
    <SegmentedControl<Days>
      label="Time range"
      value={days}
      onChange={setDays}
      options={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }]}
    />
  );

  if (variant === "profile") {
    const me = data?.people[0];
    return (
      <Card className="p-5 min-w-0">
        <CardHeader
          title="Working habits"
          description="Commit and pull request size in merged pull requests"
          actions={windowToggle}
        />
        {error && <ErrorBanner className="mt-4" message={`Couldn't load working habits: ${(error as Error).message}`} onRetry={() => mutate()} />}
        {isLoading && <div className="mt-4 h-24 rounded skeleton" />}
        {data && (
          <>
            {EmptyState({ data }) ?? (me ? (
              <>
                <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
                  <div>
                    <p className="text-xs text-faint">Commits over the limit</p>
                    <p className={cn("text-2xl font-semibold tabular-nums", tone(me.oversizedCommitPct).text)}>{me.oversizedCommitPct}%</p>
                    <p className="text-xs text-muted">{me.oversizedCommits} of {plural(me.commits, "commit")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-faint">Pull requests over {data.thresholds.maxPrCommits} commits</p>
                    <p className={cn("text-2xl font-semibold tabular-nums", me.oversizedPrs > 0 ? "text-status-warn-text" : "text-fg")}>{me.oversizedPrs}</p>
                    <p className="text-xs text-muted">of {plural(me.prs, "merged pull request")}</p>
                  </div>
                  {me.viaPrAuthor > 0 && <p className="text-xs text-faint">{me.viaPrAuthor} commits credited via PR author</p>}
                </div>
                {data.commits.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-[13px] font-semibold text-fg">Largest commits over the limit</h3>
                    <CommitsList data={data} person={me.login} limit={5} />
                  </div>
                )}
              </>
            ) : (
              <p className="mt-4 text-sm text-muted">No commits in merged pull requests in this window.</p>
            ))}
            <CoverageLine data={data} />
          </>
        )}
      </Card>
    );
  }

  return (
    <Card as="section" id="habits" className="p-5 min-w-0 scroll-mt-20" aria-labelledby="working-habits-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="working-habits-title" className="text-[15px] font-semibold text-fg">Working habits</h2>
          <p className="mt-1 text-[13px] text-muted">Are commits and pull requests kept small enough to review?</p>
          {data && <LimitsLine data={data} canChangeLimits={!!canChangeLimits} />}
        </div>
        {repo && (
          <SegmentedControl<Scope>
            label="Scope"
            value={scope}
            onChange={setScope}
            options={[{ value: "repo", label: "This repo" }, { value: "owner", label: "All repos" }]}
          />
        )}
      </div>
      {error && <ErrorBanner className="mt-4" message={`Couldn't load working habits: ${(error as Error).message}`} onRetry={() => mutate()} />}
      {isLoading && <div className="mt-4 h-40 rounded skeleton" />}
      {data && (
        <>
          {EmptyState({ data }) ?? (
            <>
              <SummaryCells data={data} />
              <CommitGroups commits={data.commits} total={data.totals.oversizedCommits} />
            </>
          )}
          <p className="mt-5 text-xs text-faint">{FOOTNOTE}</p>
        </>
      )}
    </Card>
  );
}

// ── Team v2 pieces ───────────────────────────────────────────────────────────

/** Limits, coverage and freshness — warning tone while the backfill runs. */
function LimitsLine({ data, canChangeLimits }: { data: WorkingHabitsResponse; canChangeLimits: boolean }) {
  const { coverage: c, thresholds: t } = data;
  return (
    <p className={cn("mt-1 text-xs", c.complete ? "text-faint" : "text-status-warn-text")}>
      Limits: {t.maxCommitFiles} files or {t.maxCommitLines} lines per commit · {t.maxPrCommits} commits per pull request
      {canChangeLimits && <> · <Link href="/settings?section=working-habits" className="text-link hover:underline">Change limits</Link></>}
      {" "}· {c.analysedPrs} of {plural(c.mergedPrs, "merged pull request")} analysed · updated {ago(c.lastSyncedAt)}
      {!c.complete && " · backfill in progress, figures may change"}
    </p>
  );
}

type Why = "both" | "lines" | "files";
const whyOf = (c: WorkingHabitsCommit): Why => (c.reasons.length > 1 ? "both" : c.reasons[0] === "files" ? "files" : "lines");
const WHY = {
  both: { label: "Files and lines", chip: "bg-status-fail-tint text-status-fail-text", bar: "bg-status-fail" },
  lines: { label: "Lines", chip: "bg-status-warn-tint text-status-warn-text", bar: "bg-status-warn" },
  files: { label: "Files", chip: "bg-status-warn-tint text-status-warn-text", bar: "bg-status-warn" },
} as const;
const size = (c: WorkingHabitsCommit) => c.additions + c.deletions;

function SummaryCells({ data }: { data: WorkingHabitsResponse }) {
  const { totals: t, thresholds } = data;
  const within = Math.max(0, t.commits - t.oversizedCommits);
  const complete = data.commits.length === t.oversizedCommits;
  const count = (w: Why) => data.commits.filter((c) => whyOf(c) === w).length;
  const segments = complete
    ? [
        { key: "both", label: "Files and lines", n: count("both"), cls: "bg-status-fail" },
        { key: "lines", label: "Lines", n: count("lines"), cls: "bg-status-warn" },
        { key: "files", label: "Files", n: count("files"), cls: "bg-status-warn/60" },
        { key: "within", label: "Within", n: within, cls: "bg-raised" },
      ]
    : [
        { key: "over", label: "Over", n: t.oversizedCommits, cls: "bg-status-fail" },
        { key: "within", label: "Within", n: within, cls: "bg-raised" },
      ];
  const largest = data.commits[0];
  const topPr = data.prs[0];
  return (
    <div className="mt-4 grid gap-px overflow-hidden rounded-control border border-line bg-line sm:grid-cols-3">
      <div className="bg-surface p-4 min-w-0">
        <p className="text-xs text-muted">Commits over the limit</p>
        <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-fg">
          {t.oversizedCommits.toLocaleString()} <span className="text-sm font-normal text-muted">of {t.commits.toLocaleString()} · {t.commits ? Math.round((t.oversizedCommits / t.commits) * 100) : 0}%</span>
        </p>
        {t.commits > 0 && (
          <>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-raised" aria-hidden="true">
              {segments.map((g) => g.n > 0 && <span key={g.key} className={g.cls} style={{ width: `${(g.n / t.commits) * 100}%` }} />)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              {segments.map((g) => (
                <span key={g.key} className="inline-flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 rounded-sm", g.cls)} aria-hidden="true" />{g.label} {g.n}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="bg-surface p-4 min-w-0">
        <p className="text-xs text-muted">Pull requests over {thresholds.maxPrCommits} commits</p>
        <p className={cn("mt-1 font-mono text-2xl font-semibold tabular-nums", t.oversizedPrs ? "text-status-warn-text" : "text-fg")}>
          {t.oversizedPrs} <span className="text-sm font-normal text-muted">of {t.prs}</span>
        </p>
        <p className="mt-2 text-xs text-muted">
          {topPr ? (
            <>Largest: <a href={topPr.url} target="_blank" rel="noopener noreferrer" className="font-mono text-link hover:underline">{repoName(topPr.repo)}#{topPr.number}</a> · {plural(topPr.commitCount, "commit")}</>
          ) : "All within the limit"}
        </p>
      </div>
      <div className="bg-surface p-4 min-w-0">
        <p className="text-xs text-muted">Largest commit</p>
        {largest ? (
          <>
            <a href={largest.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-mono text-2xl font-semibold text-link hover:underline">{shortSha(largest.sha)}</a>
            <p className="mt-2 text-xs text-muted">
              {largest.files === null ? "? files" : plural(largest.files, "file")} · <span className="text-status-pass-text">+{largest.additions.toLocaleString()}</span>{" "}
              <span className="text-status-fail-text">−{largest.deletions.toLocaleString()}</span> · {repoName(largest.repo)}#{largest.prNumber}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">None over the limit</p>
        )}
      </div>
    </div>
  );
}

/** Oversized commits grouped by pull request, most offenders first; the first two groups open. */
function CommitGroups({ commits, total }: { commits: WorkingHabitsCommit[]; total: number }) {
  const groups = useMemo(() => {
    const m = new Map<string, WorkingHabitsCommit[]>();
    for (const c of commits) {
      const k = `${c.repo}#${c.prNumber}`;
      const g = m.get(k);
      if (g) g.push(c);
      else m.set(k, [c]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || size(b[1][0]) - size(a[1][0]));
  }, [commits]);
  // Explicit open/closed per group (by PR), so a refresh that reorders groups never flips them.
  const [openState, setOpenState] = useState<Map<string, boolean>>(new Map());
  if (!commits.length) return null;
  const max = Math.max(1, ...commits.map(size));
  const people = new Set(commits.map((c) => c.person.toLowerCase())).size;

  return (
    <div className="mt-5 -mx-5 overflow-x-auto">
      <div className="min-w-[560px] px-5">
        <div className="grid grid-cols-[6.5rem_4.5rem_minmax(80px,1fr)_9rem_7.5rem] gap-3 border-b border-line pb-2 text-xs font-medium text-faint">
          <span>Commit</span><span>Files</span><span aria-hidden="true" /><span>Lines</span><span>Over</span>
        </div>
        {groups.map(([key, rows], i) => {
          const open = openState.get(key) ?? i < 2;
          const [repo, pr] = key.split("#");
          const of = rows[0].prCommitCount;
          return (
            <div key={key} className="border-b border-line last:border-0">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenState((m) => new Map(m).set(key, !open))}
                className="flex w-full items-center gap-2 py-2.5 text-left text-[13px] hover:text-fg"
              >
                <ChevronRight className={cn("h-3.5 w-3.5 text-muted transition-transform", open && "rotate-90")} aria-hidden="true" />
                <span className="font-mono text-fg">{repoName(repo)}#{pr}</span>
                <span className="text-xs text-muted">{rows.length}{of !== null ? ` of ${plural(of, "commit")}` : ` ${rows.length === 1 ? "commit" : "commits"}`} over</span>
              </button>
              {open && rows.map((c) => {
                const w = WHY[whyOf(c)];
                return (
                  <div key={c.sha} className="grid grid-cols-[6.5rem_4.5rem_minmax(80px,1fr)_9rem_7.5rem] items-center gap-3 pb-2 pl-5 text-[13px]">
                    <span className="min-w-0">
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-mono text-link hover:underline">{shortSha(c.sha)}</a>
                      {people > 1 && <span className="block text-[11px] text-faint truncate">{c.person}</span>}
                    </span>
                    <span className="font-mono text-muted tabular-nums">{c.files === null ? "?" : c.files}</span>
                    <span className="h-1.5 rounded-full bg-raised overflow-hidden" aria-hidden="true">
                      <span className={cn("block h-full rounded-full", w.bar)} style={{ width: `${Math.max(2, Math.round((size(c) / max) * 100))}%` }} />
                    </span>
                    <span className="font-mono tabular-nums whitespace-nowrap">
                      <span className="text-status-pass-text">+{c.additions.toLocaleString()}</span> <span className="text-status-fail-text">−{c.deletions.toLocaleString()}</span>
                    </span>
                    <span><span className={cn("inline-flex h-[22px] items-center px-2 rounded-chip text-xs font-medium", w.chip)}>{w.label}</span></span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {total > commits.length && <p className="mt-2 text-xs text-faint">Showing the {commits.length} largest of {total} commits over the limit.</p>}
      </div>
    </div>
  );
}
