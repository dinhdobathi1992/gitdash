"use client";

/** "Workload to watch" — people whose load or hours are out of range (`Team` artboard). */

import Link from "next/link";
import type { WorkloadRiskEntry } from "@/app/api/github/team-workload-risk/route";
import { Card, CardHeader } from "@/components/ui/Card";

export function initials(name: string): string {
  const parts = name.replace(/\[bot\]$/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

export function Avatar({ login, src, size = 32 }: { login: string; src?: string; size?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} className="rounded-full shrink-0 bg-raised" style={{ width: size, height: size }} />;
  }
  return (
    <span className="flex items-center justify-center rounded-full bg-raised text-xs font-semibold text-fg shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      {initials(login)}
    </span>
  );
}

function reason(p: WorkloadRiskEntry): string {
  const bits: string[] = [];
  if (p.flags.after_hours) bits.push(`${Math.round(p.after_hours_pct)}% of commits after hours`);
  if (p.flags.weekend) bits.push(`${Math.round(p.weekend_pct)}% of commits on weekends`);
  if (p.flags.concurrent_pr_overload) bits.push(`${p.open_pr_count} open pull requests`);
  if (p.flags.activity_cliff) bits.push(`went quiet: ${p.recent_period_commits} commits in 14 days after ${p.prior_period_commits} before`);
  return bits.join(" · ");
}

export function WorkloadList({ people, owner, loading, disabled, windowDays }: {
  people: WorkloadRiskEntry[];
  owner: string;
  loading: boolean;
  disabled?: boolean;
  windowDays?: number;
}) {
  const flagged = people.filter((p) => p.risk_score > 0).slice(0, 6);
  return (
    <Card className="p-5 min-w-0">
      <CardHeader title="Workload to watch" description={`People whose load or hours are out of their usual range${windowDays ? ` · last ${windowDays} days` : ""}`} />
      {disabled ? (
        <p className="mt-4 text-[13px] text-muted">Workload risk is turned off for you.</p>
      ) : loading ? (
        <div className="mt-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded skeleton" />)}</div>
      ) : flagged.length === 0 ? (
        <p className="mt-4 px-4 py-3 rounded-control bg-status-pass-tint text-sm text-status-pass-text">Nobody&apos;s workload looks unusual.</p>
      ) : (
        <ul className="mt-3">
          {flagged.map((p) => {
            const high = p.risk_score >= 2;
            return (
              <li key={p.login} className="border-t border-line">
                <Link href={`/contributor/${p.login}?owner=${owner}`} className="flex items-center gap-3 py-3 hover:bg-raised/30 -mx-2 px-2 rounded-control">
                  <Avatar login={p.login} src={p.avatar_url} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-fg truncate">{p.login}</span>
                    <span className="block text-[13px] text-muted truncate">{reason(p)}</span>
                  </span>
                  <span className={high ? "inline-flex h-[22px] items-center px-2 rounded-chip text-xs font-semibold bg-status-fail-tint text-status-fail-text" : "inline-flex h-[22px] items-center px-2 rounded-chip text-xs font-semibold bg-status-warn-tint text-status-warn-text"}>
                    {high ? "High" : "Watch"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
