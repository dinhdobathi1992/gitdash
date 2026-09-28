"use client";

/**
 * Working habits — commit and PR size per engineer (GET /api/db/working-habits).
 *
 * `team` (Team insights): everyone in the repo or owner, a person filter, and
 * the oversized commits / PRs lists. `profile` (contributor profile): one
 * person's share and their largest commits. No rank numbers anywhere — this
 * is for coaching, not a league table.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, FetchError } from "@/lib/swr";
import type { WorkingHabitsResponse, WorkingHabitsPerson } from "@/lib/working-habits";
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

function PctBar({ pct }: { pct: number }) {
  const t = tone(pct);
  return (
    <span className="flex items-center gap-2 min-w-[96px]">
      <span className="h-1.5 w-16 rounded-full bg-raised overflow-hidden" aria-hidden="true">
        <span className={cn("block h-full rounded-full", t.bar)} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className={cn("font-mono text-[13px] tabular-nums", t.text)}>{pct}%</span>
    </span>
  );
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
  const rows = data.commits.filter((c) => !person || c.author.toLowerCase() === person.toLowerCase());
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

function PrsList({ data, person }: { data: WorkingHabitsResponse; person: string | null }) {
  const rows = data.prs.filter((p) => !person || p.author.toLowerCase() === person.toLowerCase());
  if (!rows.length) return <p className="mt-2 text-[13px] text-muted">None over the limit.</p>;
  return (
    <ul className="mt-2">
      {rows.map((p) => (
        <li key={`${p.repo}#${p.number}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-t border-line text-[13px]">
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">{repoName(p.repo)}#{p.number}</a>
          {!person && <span className="font-mono text-fg">{p.author}</span>}
          <span className="font-mono text-status-warn-text tabular-nums">{plural(p.commitCount, "commit")}</span>
          <span className="text-xs text-muted">merged {new Date(p.mergedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        </li>
      ))}
    </ul>
  );
}

function PeopleTable({ people, owner, selected, onSelect }: {
  people: WorkingHabitsPerson[];
  owner: string;
  selected: string | null;
  onSelect: (login: string | null) => void;
}) {
  return (
    <div className="mt-4 overflow-x-auto -mx-5">
      <table className="w-full border-collapse">
        <caption className="sr-only">Commit and pull request size per person</caption>
        <thead className="bg-panel border-y border-line">
          <tr>
            <th scope="col" className="h-10 pl-5 pr-3 text-left text-xs font-medium text-faint">Person</th>
            <th scope="col" className="h-10 px-3 text-left text-xs font-medium text-faint">Commits</th>
            <th scope="col" className="h-10 px-3 text-left text-xs font-medium text-faint">Over the limit</th>
            <th scope="col" className="h-10 px-3 text-left text-xs font-medium text-faint hidden sm:table-cell">Pull requests</th>
            <th scope="col" className="h-10 pl-3 pr-5 text-left text-xs font-medium text-faint">Pull requests over the limit</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const active = selected?.toLowerCase() === p.login.toLowerCase();
            return (
              <tr
                key={p.login}
                onClick={() => onSelect(active ? null : p.login)}
                aria-selected={active}
                className={cn("border-b border-line last:border-0 cursor-pointer hover:bg-raised/40", active && "bg-raised/60")}
              >
                <td className="h-12 pl-5 pr-3">
                  <Link href={`/contributor/${p.login}?owner=${owner}`} onClick={(e) => e.stopPropagation()} className="font-mono text-sm text-fg hover:text-link">
                    {p.login}
                  </Link>
                  {p.viaPrAuthor > 0 && <span className="block text-[11px] text-faint">{p.viaPrAuthor} via PR author</span>}
                </td>
                <td className="px-3 font-mono text-[13px] text-fg tabular-nums">{p.commits}</td>
                <td className="px-3">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[13px] text-fg tabular-nums w-8">{p.oversizedCommits}</span>
                    <PctBar pct={p.oversizedCommitPct} />
                  </span>
                </td>
                <td className="px-3 font-mono text-[13px] text-fg tabular-nums hidden sm:table-cell">{p.prs}</td>
                <td className={cn("pl-3 pr-5 font-mono text-[13px] tabular-nums", p.oversizedPrs > 0 ? "text-status-warn-text" : "text-fg")}>{p.oversizedPrs}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const FOOTNOTE =
  "Counts commits inside merged pull requests, so squash merges are measured correctly. Commits pushed straight to the default branch are not counted.";

export function WorkingHabitsPanel({ owner, repo, login, variant }: {
  owner: string;
  repo?: string;
  /** Profile variant: the person to show. */
  login?: string;
  variant: "team" | "profile";
}) {
  const [days, setDays] = useState<Days>("30");
  const [scope, setScope] = useState<Scope>("repo");
  const [person, setPerson] = useState<string | null>(null);

  const url = useMemo(() => {
    const q = new URLSearchParams({ owner, days });
    if (variant === "team" && scope === "repo" && repo) q.set("repo", repo);
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
    <Card className="p-5 min-w-0" aria-labelledby="working-habits-title">
      <CardHeader
        id="working-habits-title"
        title="Working habits"
        description="Who keeps commits and pull requests small, from merged pull requests"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {repo && (
              <SegmentedControl<Scope>
                label="Scope"
                value={scope}
                onChange={(v) => { setScope(v); setPerson(null); }}
                options={[{ value: "repo", label: "This repo" }, { value: "owner", label: `All of ${owner}` }]}
              />
            )}
            {windowToggle}
          </div>
        }
      />
      {error && <ErrorBanner className="mt-4" message={`Couldn't load working habits: ${(error as Error).message}`} onRetry={() => mutate()} />}
      {isLoading && <div className="mt-4 h-40 rounded skeleton" />}
      {data && (
        <>
          <CoverageLine data={data} />
          {EmptyState({ data }) ?? (
            <>
              <PeopleTable people={data.people} owner={owner} selected={person} onSelect={setPerson} />
              {person && (
                <p className="mt-3 text-xs text-muted">
                  Showing {person} only.{" "}
                  <button type="button" className="text-link hover:underline" onClick={() => setPerson(null)}>Show everyone</button>
                </p>
              )}
              <div className="mt-5 grid gap-6 xl:grid-cols-2">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold text-fg">
                    Commits over {data.thresholds.maxCommitFiles} files or {data.thresholds.maxCommitLines} lines
                  </h3>
                  <CommitsList data={data} person={person} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold text-fg">Pull requests over {data.thresholds.maxPrCommits} commits</h3>
                  <PrsList data={data} person={person} />
                </div>
              </div>
            </>
          )}
          <p className="mt-5 text-xs text-faint">{FOOTNOTE}</p>
        </>
      )}
    </Card>
  );
}
