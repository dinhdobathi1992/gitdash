"use client";

/**
 * Outcomes + "Jobs that fail most" (`Repo` artboard, right column).
 * Outcomes count every workflow's runs in the last 30 days. Failing jobs come
 * from the job-stats endpoint for the workflow with the most failures — one
 * cached call, not one per workflow — and say which workflow they belong to.
 */

import { useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { JobStatsResponse, WorkflowOverview } from "@/lib/github";
import { OUTCOME_COLORS } from "@/components/charts";
import { Card, CardHeader } from "@/components/ui/Card";

const DAY = 86_400_000;

export function OutcomesCard({ owner, repo, workflows, now, jobsEnabled }: {
  owner: string;
  repo: string;
  workflows: WorkflowOverview[];
  now: number;
  jobsEnabled: boolean;
}) {
  const { counts, total, worst } = useMemo(() => {
    const c = { success: 0, failure: 0, cancelled: 0 };
    let worstWf: WorkflowOverview | null = null;
    let worstFails = 0;
    for (const wf of workflows) {
      let fails = 0;
      for (const r of wf.summary.window_runs ?? wf.summary.recent_runs) {
        if (r.status !== "completed" || now - new Date(r.created_at).getTime() > 30 * DAY) continue;
        if (r.conclusion === "success") c.success++;
        else if (r.conclusion === "failure" || r.conclusion === "timed_out" || r.conclusion === "startup_failure") { c.failure++; fails++; }
        else c.cancelled++;
      }
      if (fails > worstFails) { worstFails = fails; worstWf = wf; }
    }
    return { counts: c, total: c.success + c.failure + c.cancelled, worst: worstWf };
  }, [workflows, now]);

  const { data: jobs } = useSWR<JobStatsResponse>(
    jobsEnabled && worst ? `/api/github/job-stats?owner=${owner}&repo=${repo}&workflow_id=${worst.id}&per_page=20` : null,
    fetcher<JobStatsResponse>,
  );
  const failing = (jobs?.jobs ?? []).filter((j) => j.failure > 0).sort((a, b) => b.failure - a.failure).slice(0, 3);
  const maxFail = failing[0]?.failure ?? 1;

  const rows = [
    { key: "success", label: "Success", n: counts.success, color: OUTCOME_COLORS.success },
    { key: "failure", label: "Failure", n: counts.failure, color: OUTCOME_COLORS.failure },
    { key: "cancelled", label: "Cancelled or skipped", n: counts.cancelled, color: OUTCOME_COLORS.cancelled },
  ];
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const label = total
    ? `Outcomes over ${total} runs in 30 days: ${rows.map((r) => `${r.n} ${r.label.toLowerCase()} (${pct(r.n)}%)`).join(", ")}`
    : "No completed runs in 30 days";

  return (
    <Card className="p-5 flex flex-col min-w-0">
      <CardHeader title="Outcomes" description={`${total.toLocaleString()} runs in 30 days`} />
      {total > 0 ? (
        <>
          <div role="img" aria-label={label} className="mt-5 flex h-2 gap-0.5 rounded-full overflow-hidden">
            {rows.filter((r) => r.n > 0).map((r) => (
              <span key={r.key} style={{ width: `${(r.n / total) * 100}%`, background: r.color }} />
            ))}
          </div>
          <dl className="mt-4 space-y-2">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center justify-between text-[13px]">
                <dt className="flex items-center gap-2 text-muted">
                  <span className="w-2 h-2 rounded-[2px]" style={{ background: r.color }} aria-hidden="true" />
                  {r.label}
                </dt>
                <dd className="font-mono text-fg tabular-nums">{r.n} <span className="text-faint">·</span> {pct(r.n)}%</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="mt-4 text-sm text-muted">No completed runs in the last 30 days.</p>
      )}

      {jobsEnabled && worst && (
        <div className="mt-5 pt-5 border-t border-line">
          <h3 className="text-sm font-semibold text-fg">Jobs that fail most</h3>
          {!jobs ? (
            <div className="mt-3 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-7 rounded skeleton" />)}</div>
          ) : failing.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted">No job failures in <span className="font-mono">{worst.name}</span>&apos;s last 20 runs.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {failing.map((j) => (
                <li key={j.name}>
                  <div className="flex items-center justify-between gap-3 font-mono text-[13px]">
                    <span className="text-fg truncate">{worst.name} <span className="text-faint">›</span> {j.name}</span>
                    <span className="text-muted tabular-nums">{j.failure}</span>
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-control overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full bg-status-fail" style={{ width: `${(j.failure / maxFail) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
