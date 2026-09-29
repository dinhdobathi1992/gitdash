"use client";

/**
 * "Workload to watch" — per flagged person, three bars with a marker at the
 * fixed healthy-range limit (after hours, weekends, open pull requests).
 * After hours means outside the org workday set in Settings.
 */

import Link from "next/link";
import type { WorkloadPerson } from "@/lib/team-workload";
import type { WorkloadInput } from "@/lib/team-insights";
import { formatWorkday } from "@/lib/team-settings";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";

const MAX_PEOPLE = 6;

function Bar({ label, value, shown, limit, max, over }: { label: string; value: number; shown: string; limit: number; max: number; over: boolean }) {
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / max) * 100))}%`;
  return (
    <>
      <span className="text-xs text-muted whitespace-nowrap">{label}</span>
      <span className="relative h-2 rounded-full bg-raised" role="img" aria-label={`${label}: ${shown}, limit ${limit}`}>
        <span className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-status-fail" : "bg-faint")} style={{ width: pct(value) }} />
        <span className="absolute -top-1 -bottom-1 w-px bg-fg/70" style={{ left: pct(limit) }} aria-hidden="true" />
      </span>
      <span className={cn("text-right font-mono text-[13px] tabular-nums", over ? "text-status-fail-text" : "text-fg")}>{shown}</span>
    </>
  );
}

export function WorkloadBars({ workload, owner, loading, disabled, error }: {
  workload: WorkloadInput | null;
  owner: string;
  loading: boolean;
  disabled: boolean;
  error?: string | null;
}) {
  const flagged: WorkloadPerson[] = (workload?.people ?? []).filter((p) => p.risk_score > 0 && !p.is_bot).slice(0, MAX_PEOPLE);
  const t = workload?.thresholds;
  return (
    <Card as="section" id="workload" aria-labelledby="work-title" className="p-5 min-w-0 scroll-mt-20">
      <h2 id="work-title" className="text-[15px] font-semibold text-fg">Workload to watch</h2>
      <p className="mt-1 text-[13px] text-muted">Hours and load outside the usual range</p>
      {disabled ? (
        <p className="mt-4 text-[13px] text-muted">Workload risk is turned off for you.</p>
      ) : error ? (
        <p className="mt-4 text-[13px] text-status-fail-text">{error}</p>
      ) : loading || !workload || !t ? (
        <div className="mt-4 space-y-3">{[0, 1].map((i) => <div key={i} className="h-20 rounded skeleton" />)}</div>
      ) : (
        <>
          {flagged.length === 0 ? (
            <p className="mt-4 px-4 py-3 rounded-control bg-status-pass-tint text-sm text-status-pass-text">Nobody&apos;s workload looks unusual.</p>
          ) : (
            <ul className="mt-3">
              {flagged.map((p) => {
                const high = p.risk_score >= 2;
                return (
                  <li key={p.login} className="py-3 border-t border-line">
                    <div className="flex items-center gap-3">
                      <Avatar login={p.login} src={p.avatar_url || undefined} size={28} />
                      {p.unlinked_name ? (
                        <span className="flex-1 min-w-0 font-mono text-[13px] text-fg truncate">{p.login}</span>
                      ) : (
                        <Link href={`/contributor/${p.login}?owner=${owner}`} className="flex-1 min-w-0 font-mono text-[13px] text-fg hover:text-link truncate">{p.login}</Link>
                      )}
                      <span className={cn("inline-flex h-[22px] items-center px-2 rounded-chip text-xs font-semibold", high ? "bg-status-fail-tint text-status-fail-text" : "bg-status-warn-tint text-status-warn-text")}>
                        {high ? "High" : "Watch"}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_2.75rem] items-center gap-x-3 gap-y-2.5">
                      <Bar label="After-hours commits" value={p.after_hours_pct} shown={`${p.after_hours_pct}%`} limit={t.after_hours_pct} max={100} over={p.flags.after_hours} />
                      <Bar label="Weekend commits" value={p.weekend_pct} shown={`${p.weekend_pct}%`} limit={t.weekend_pct} max={100} over={p.flags.weekend} />
                      <Bar label="Open pull requests" value={p.open_pr_count} shown={String(p.open_pr_count)} limit={t.open_prs} max={Math.max(t.open_prs * 2, p.open_pr_count)} over={p.flags.concurrent_pr_overload} />
                    </div>
                    {p.flags.activity_cliff && (
                      <p className="mt-2 text-xs text-status-warn-text">Went quiet: {p.recent_period_commits} commits in the last 14 days after {p.prior_period_commits} before.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 flex items-start gap-2 text-xs text-faint">
            <span className="mt-1 inline-block h-2.5 w-px bg-fg/70 shrink-0" aria-hidden="true" />
            <span>
              Healthy range: {t.after_hours_pct}% after hours (outside {formatWorkday(workload.workday)}) · {t.weekend_pct}% weekends · {t.open_prs} open pull requests · Workday set in Settings
            </span>
          </p>
        </>
      )}
    </Card>
  );
}
