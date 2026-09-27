"use client";

/**
 * Attention list — design contract §5, replacing the coloured card grid.
 * One card, 64 px rows: tinted icon box · title + reason · repo (mono) ·
 * relative time · chevron. The whole row is one link. At most `max` rows,
 * then "View all alerts →". Empty: one success-tinted line.
 *
 * Rows merge firing alert events (src/lib/alert-copy.ts) with repositories
 * whose latest decisive run failed, so the list is useful without alert rules.
 */

import Link from "next/link";
import { ArrowRight, ChevronRight, CircleX, Clock, Layers, GitPullRequest, Users, Mail } from "lucide-react";
import { cn, formatRelative } from "@/lib/utils";
import { ruleThreshold, channelLabel, type AlertKind, type FiringAlert } from "@/lib/alert-copy";
import type { RepoAttention } from "@/lib/fleet";
import { SectionTitle } from "@/components/ui/Card";

export interface AttentionRow {
  key: string;
  kind: AlertKind;
  title: string;
  reason: string;
  repo: string | null;
  href: string;
  at: string | null;
}

const KIND: Record<AlertKind, { icon: React.ComponentType<{ className?: string }>; box: string }> = {
  failure: { icon: CircleX, box: "bg-status-fail-tint text-status-fail-text" },
  duration: { icon: Clock, box: "bg-status-warn-tint text-status-warn-text" },
  queue: { icon: Layers, box: "bg-status-warn-tint text-status-warn-text" },
  review: { icon: GitPullRequest, box: "bg-status-run-tint text-status-run-text" },
  people: { icon: Users, box: "bg-status-run-tint text-status-run-text" },
  digest: { icon: Mail, box: "bg-status-neutral-tint text-status-neutral-text" },
};

/** Merge alert events and failing repos, de-duplicating repos already covered by a failure alert. */
export function buildAttentionRows(firing: FiringAlert[], failing: RepoAttention[], now: number): AttentionRow[] {
  const rows: AttentionRow[] = firing.map((f) => ({
    key: f.key,
    kind: f.kind,
    title: f.title,
    reason: [
      f.rule ? `Rule: ${ruleThreshold(f.rule)}` : null,
      f.rule ? `sent to ${channelLabel(f.rule)}` : null,
      `firing for ${formatRelative(f.event.fired_at, now).replace(/ ago$/, "")}`,
    ].filter(Boolean).join(" · "),
    repo: f.event.scope.startsWith("repo:") ? f.event.scope.slice(5).split("/").pop() ?? null : null,
    href: f.href ?? "/alerts",
    at: f.event.fired_at,
  }));
  const covered = new Set(rows.filter((r) => r.kind === "failure" && r.repo).map((r) => r.repo));
  for (const f of failing) {
    if (covered.has(f.repo)) continue;
    rows.push({ key: f.key, kind: "failure", title: f.title, reason: f.reason, repo: f.repo, href: f.href, at: f.at });
  }
  return rows.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());
}

export function AttentionList({
  rows, now, loading, max = 6, className, compact,
}: {
  rows: AttentionRow[];
  now: number;
  loading?: boolean;
  max?: number;
  className?: string;
  /** Phone layout: title + "repo · time" only. */
  compact?: boolean;
}) {
  const shown = rows.slice(0, max);
  return (
    <section aria-labelledby="attention-title" className={className}>
      <SectionTitle
        count={loading ? undefined : rows.length}
        actions={
          <Link href="/alerts" className="inline-flex items-center gap-1 text-[13px] font-medium text-link hover:text-violet-200">
            {compact ? "See all" : "View all alerts"} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        }
      >
        <span id="attention-title">Needs attention</span>
      </SectionTitle>
      <div className="card overflow-hidden">
        {loading ? (
          <ul>
            {Array.from({ length: 2 }).map((_, i) => (
              <li key={i} className="flex items-center gap-4 h-16 px-5 border-b border-line last:border-0">
                <div className="w-8 h-8 rounded-control skeleton" />
                <div className="flex-1"><div className="h-3.5 w-64 rounded skeleton mb-2" /><div className="h-3 w-80 rounded skeleton" /></div>
              </li>
            ))}
          </ul>
        ) : shown.length === 0 ? (
          <p className="px-5 py-4 text-sm text-status-pass-text bg-status-pass-tint">Nothing needs attention.</p>
        ) : (
          <ul>
            {shown.map((r) => {
              const k = KIND[r.kind];
              const Icon = k.icon;
              return (
                <li key={r.key} className="border-b border-line last:border-0">
                  <Link
                    href={r.href}
                    className="group flex items-center gap-4 min-h-16 px-5 py-3 hover:bg-raised/40 transition-colors duration-100"
                  >
                    <span className={cn("flex items-center justify-center w-8 h-8 rounded-control shrink-0", k.box)}>
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-fg truncate">{r.title}</span>
                      <span className={cn("block text-[13px] text-muted truncate", compact && "font-mono")}>
                        {compact ? [r.repo, formatRelative(r.at, now)].filter(Boolean).join(" · ") : r.reason}
                      </span>
                    </span>
                    {!compact && (
                      <>
                        <span className="hidden md:block w-44 shrink-0 font-mono text-[13px] text-muted truncate">{r.repo ?? "—"}</span>
                        <span className="hidden md:block w-24 shrink-0 text-[13px] text-faint">{formatRelative(r.at, now)}</span>
                      </>
                    )}
                    <ChevronRight className="w-4 h-4 shrink-0 text-faint group-hover:text-fg" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
