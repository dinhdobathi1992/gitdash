"use client";

/**
 * Repository table (`Main` artboard, contract §5 "Data table" and "Run strip").
 * Name cell carries the link; the pin sits outside it. Mono for data columns.
 */

import { memo, useEffect, useRef } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { cn, formatDurationShort, formatRelative, highlightSegments } from "@/lib/utils";
import type { Repo, RepoSummary } from "@/lib/github";
import { StatusPill } from "@/components/ui/StatusPill";
import { RunStrip } from "@/components/ui/RunStrip";
import { repoHealth } from "@/lib/repo-health";

export type Density = "comfortable" | "compact";

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  return (
    <>
      {highlightSegments(text, indices).map((seg, i) =>
        seg.highlight
          ? <mark key={i} className="bg-transparent text-link">{seg.text}</mark>
          : <span key={i}>{seg.text}</span>,
      )}
    </>
  );
}

/** Success figure + 84 px bar. <80% failure, <90% warning, else success. */
export function SuccessBar({ rate }: { rate: number | null | undefined }) {
  if (rate === null || rate === undefined) {
    return (
      <div className="flex items-center gap-3">
        <span className="w-11 font-mono text-[13px] text-faint">—</span>
        <span className="w-[84px] h-1 rounded-full bg-control" />
      </div>
    );
  }
  const tone = rate < 80 ? "bg-status-fail" : rate < 90 ? "bg-status-warn" : "bg-status-pass";
  return (
    <div className="flex items-center gap-3">
      <span className="w-11 font-mono text-[13px] font-medium text-fg tabular-nums">{Math.round(rate)}%</span>
      <span className="relative w-[84px] h-1 rounded-full bg-control overflow-hidden" aria-hidden="true">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${Math.max(2, rate)}%` }} />
      </span>
    </div>
  );
}

const Row = memo(function Row({
  repo, nameIndices, summary, active, pinned, onTogglePin, density, now,
}: {
  repo: Repo;
  nameIndices: number[];
  summary: RepoSummary | undefined;
  active: boolean;
  pinned: boolean;
  onTogglePin: (fullName: string) => void;
  density: Density;
  now: number;
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const health = summary ? repoHealth(summary, now) : null;
  const h = density === "compact" ? "h-11" : "h-[58px]";
  const live = health?.key === "running" || health?.key === "queued";
  const noRuns = health?.key === "none";

  return (
    <tr
      ref={ref}
      aria-selected={active || undefined}
      className={cn("border-b border-line last:border-0 transition-colors duration-100", active ? "bg-[#161B23]" : "hover:bg-[#161B23]/60")}
    >
      <td className={cn(h, "w-12 pl-4")}>
        <button
          type="button"
          onClick={() => onTogglePin(repo.full_name)}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${repo.name}` : `Pin ${repo.name}`}
          className="flex items-center justify-center w-8 h-8 rounded-control text-faint hover:text-fg hover:bg-raised"
        >
          <Star className={cn("w-4 h-4", pinned && "fill-brand-fg text-brand-fg")} aria-hidden="true" />
        </button>
      </td>
      <td className={cn(h, "pr-4 min-w-0")}>
        <Link href={`/repos/${repo.owner}/${repo.name}`} className="group block min-w-0">
          <span className="block font-mono text-sm font-semibold text-fg group-hover:text-link truncate">
            <Highlighted text={repo.name} indices={nameIndices} />
          </span>
          {density === "comfortable" && (
            <span className="block text-xs text-muted truncate">
              {[repo.language, repo.private ? "Private" : "Public"].filter(Boolean).join(" · ")}
            </span>
          )}
        </Link>
      </td>
      <td className={cn(h, "px-3 w-[148px]")}>
        {health ? <StatusPill tone={health.tone} pulse={health.key === "running"}>{health.label}</StatusPill> : <div className="h-6 w-20 rounded-full skeleton" />}
      </td>
      <td className={cn(h, "px-3 w-[166px] hidden md:table-cell")}>
        {summary ? <SuccessBar rate={summary.success_rate_30d ?? (summary.recent_runs.length ? summary.success_rate : null)} /> : <div className="h-4 w-32 rounded skeleton" />}
      </td>
      <td className={cn(h, "px-3 w-[148px] hidden sm:table-cell")}>
        {!summary ? (
          <div className="flex gap-[3px]">{Array.from({ length: 10 }).map((_, i) => <span key={i} className="w-2 h-[18px] rounded-[2px] skeleton" />)}</div>
        ) : noRuns ? (
          <span className="text-[13px] text-muted">No runs in 30 days</span>
        ) : (
          <RunStrip runs={summary.recent_runs} />
        )}
      </td>
      <td className={cn(h, "px-3 w-[116px] hidden lg:table-cell font-mono text-[13px] text-fg tabular-nums")}>
        {summary ? formatDurationShort(summary.p95_duration_ms) : <div className="h-4 w-14 rounded skeleton" />}
      </td>
      <td className={cn(h, "px-3 pr-5 w-[170px] hidden xl:table-cell")}>
        {summary ? (
          <>
            <span className="block text-[13px] font-medium text-fg">
              {live ? (health?.key === "running" ? "Running now" : "Queued now") : formatRelative(summary.latest_run_at, now)}
            </span>
            {density === "comfortable" && summary.latest_branch && (
              <span className="block font-mono text-xs text-muted truncate max-w-[160px]">{summary.latest_branch}</span>
            )}
          </>
        ) : <div className="h-4 w-20 rounded skeleton" />}
      </td>
    </tr>
  );
});

export function RepoTable({
  rows, summaries, activeIndex, isPinned, onTogglePin, density, now, loading, footer,
}: {
  rows: { repo: Repo; nameIndices: number[] }[];
  summaries: Map<string, RepoSummary>;
  activeIndex: number;
  isPinned: (fullName: string) => boolean;
  onTogglePin: (fullName: string) => void;
  density: Density;
  now: number;
  loading: boolean;
  footer: React.ReactNode;
}) {
  const th = "h-10 px-3 text-left text-xs font-medium text-faint whitespace-nowrap";
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <caption className="sr-only">Repositories</caption>
          <thead className="bg-panel border-b border-line">
            <tr>
              <th className={cn(th, "w-12 pl-4")}><span className="sr-only">Pinned</span></th>
              <th className={cn(th, "pl-0")}>Repository</th>
              <th className={th}>Status</th>
              <th className={cn(th, "hidden md:table-cell")}>Success · 30d</th>
              <th className={cn(th, "hidden sm:table-cell")}>Last 10 runs</th>
              <th className={cn(th, "hidden lg:table-cell")}>p95 duration</th>
              <th className={cn(th, "hidden xl:table-cell pr-5")}>Last run</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="h-[58px] pl-4 w-12" />
                    <td className="h-[58px] pr-4"><div className="h-4 w-40 rounded skeleton mb-1.5" /><div className="h-3 w-24 rounded skeleton" /></td>
                    <td className="px-3"><div className="h-6 w-20 rounded-full skeleton" /></td>
                    <td className="px-3 hidden md:table-cell"><div className="h-4 w-32 rounded skeleton" /></td>
                    <td className="px-3 hidden sm:table-cell"><div className="h-[18px] w-28 rounded skeleton" /></td>
                    <td className="px-3 hidden lg:table-cell"><div className="h-4 w-14 rounded skeleton" /></td>
                    <td className="px-3 hidden xl:table-cell"><div className="h-4 w-20 rounded skeleton" /></td>
                  </tr>
                ))
              : rows.map(({ repo, nameIndices }, i) => (
                  <Row
                    key={repo.id}
                    repo={repo}
                    nameIndices={nameIndices}
                    summary={summaries.get(repo.full_name)}
                    active={i === activeIndex}
                    pinned={isPinned(repo.full_name)}
                    onTogglePin={onTogglePin}
                    density={density}
                    now={now}
                  />
                ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && (
        <p className="px-5 py-6 text-sm text-muted border-t border-line">No repositories match these filters.</p>
      )}
      {footer}
    </div>
  );
}

/** Phone cards (< 640 px): name, status pill, run strip, success, last run. */
export function RepoCards({
  rows, summaries, now,
}: {
  rows: { repo: Repo; nameIndices: number[] }[];
  summaries: Map<string, RepoSummary>;
  now: number;
}) {
  if (rows.length === 0) return <p className="card px-5 py-5 text-sm text-muted">No repositories match these filters.</p>;
  return (
    <ul className="card overflow-hidden">
      {rows.map(({ repo }) => {
        const s = summaries.get(repo.full_name);
        const health = s ? repoHealth(s, now) : null;
        const rate = s?.success_rate_30d ?? (s?.recent_runs.length ? s.success_rate : null);
        return (
          <li key={repo.id} className="border-b border-line last:border-0">
            <Link href={`/repos/${repo.owner}/${repo.name}`} className="block px-4 py-4 active:bg-raised/40">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-base font-semibold text-fg truncate">{repo.name}</span>
                {health ? <StatusPill tone={health.tone}>{health.label}</StatusPill> : <span className="h-6 w-20 rounded-full skeleton" />}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {s && s.recent_runs.length > 0 && <RunStrip runs={s.recent_runs} size="lg" />}
                  <span className="font-mono text-sm text-fg">{rate != null ? `${Math.round(rate)}%` : "—"}</span>
                </div>
                <span className="text-sm text-muted">
                  {health?.key === "running" ? "now" : s ? formatRelative(s.latest_run_at, now) : ""}
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
