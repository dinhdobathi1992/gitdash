"use client";

/** Contributors table (`Team` artboard) with sortable headers and CSV export. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ContributorRow } from "@/app/api/github/repo-contributors/route";
import type { WorkloadRiskEntry } from "@/app/api/github/team-workload-risk/route";
import { cn } from "@/lib/utils";
import { ExportButton } from "@/components/ExportButton";
import { Avatar } from "@/components/team/WorkloadList";

function fmtHours(h: number): string {
  if (!h || h <= 0) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return h < 10 ? `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, "0")}m` : `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

type Key = "prs_merged" | "reviews_given" | "avg_hours_to_merge" | "avg_review_turnaround_hours" | "first_pass_approval_rate" | "self_merge_count" | "after";

export function ContributorsTable({ rows, owner, repo, workload }: {
  rows: ContributorRow[];
  owner: string;
  repo: string;
  workload: WorkloadRiskEntry[];
}) {
  const [sort, setSort] = useState<{ key: Key; dir: "asc" | "desc" }>({ key: "prs_merged", dir: "desc" });
  const after = useMemo(() => new Map(workload.map((w) => [w.login, w.after_hours_pct])), [workload]);
  const sorted = useMemo(() => {
    const v = (r: ContributorRow) => (sort.key === "after" ? after.get(r.login) ?? -1 : r[sort.key]);
    return [...rows].sort((a, b) => (sort.dir === "asc" ? v(a) - v(b) : v(b) - v(a)));
  }, [rows, sort, after]);

  const cols: { key: Key; label: string; hide?: string }[] = [
    { key: "prs_merged", label: "Merged" },
    { key: "reviews_given", label: "Reviews" },
    { key: "avg_hours_to_merge", label: "Cycle time" },
    { key: "avg_review_turnaround_hours", label: "Review response", hide: "hidden md:table-cell" },
    { key: "first_pass_approval_rate", label: "First-pass approval", hide: "hidden lg:table-cell" },
    { key: "self_merge_count", label: "Self-merged", hide: "hidden lg:table-cell" },
    { key: "after", label: "After hours", hide: "hidden xl:table-cell" },
  ];

  return (
    <section aria-labelledby="contributors-title" className="card overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 h-16 border-b border-line">
        <h2 id="contributors-title" className="text-[15px] font-semibold text-fg">Contributors</h2>
        <ExportButton
          data={rows}
          filenameBase={`${repo}-contributors`}
          csvRows={() => rows.map((r) => ({
            login: r.login,
            merged: r.prs_merged,
            opened: r.prs_opened,
            reviews: r.reviews_given,
            cycle_hours: Math.round(r.avg_hours_to_merge * 10) / 10,
            review_response_hours: Math.round(r.avg_review_turnaround_hours * 10) / 10,
            first_pass_approval_pct: r.first_pass_approval_rate,
            self_merged: r.self_merge_count,
          }))}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <caption className="sr-only">Contributors in {owner}/{repo}</caption>
          <thead className="bg-panel border-b border-line">
            <tr>
              <th scope="col" className="h-10 pl-5 pr-3 text-left text-xs font-medium text-faint">Contributor</th>
              {cols.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th key={c.key} scope="col" className={cn("h-10 px-3 text-left text-xs font-medium text-faint", c.hide)} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <button
                      type="button"
                      onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === "desc" ? "asc" : "desc" }))}
                      className={cn("inline-flex items-center gap-1 hover:text-fg", active && "text-fg")}
                    >
                      {c.label}
                      {active && (sort.dir === "desc" ? <ArrowDown className="w-3 h-3" aria-hidden="true" /> : <ArrowUp className="w-3 h-3" aria-hidden="true" />)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const ah = after.get(r.login);
              return (
                <tr key={r.login} className="border-b border-line last:border-0 hover:bg-[#161B23]/60">
                  <td className="h-14 pl-5 pr-3">
                    <Link href={`/contributor/${r.login}?owner=${owner}&repo=${repo}`} className="group flex items-center gap-3 min-w-0">
                      <Avatar login={r.login} src={r.avatar_url} />
                      <span className="font-mono text-sm text-fg group-hover:text-link truncate">{r.login}</span>
                    </Link>
                  </td>
                  <td className="px-3 font-mono text-[13px] text-fg tabular-nums">{r.prs_merged}</td>
                  <td className="px-3 font-mono text-[13px] text-fg tabular-nums">{r.reviews_given}</td>
                  <td className="px-3 font-mono text-[13px] text-fg">{fmtHours(r.avg_hours_to_merge)}</td>
                  <td className="px-3 font-mono text-[13px] text-fg hidden md:table-cell">{fmtHours(r.avg_review_turnaround_hours)}</td>
                  <td className="px-3 font-mono text-[13px] text-fg hidden lg:table-cell">{r.reviews_given || r.prs_merged ? `${Math.round(r.first_pass_approval_rate)}%` : "—"}</td>
                  <td className={cn("px-3 font-mono text-[13px] hidden lg:table-cell", r.self_merge_count > 0 ? "text-status-warn-text" : "text-fg")}>{r.self_merge_count}</td>
                  <td className={cn("px-3 font-mono text-[13px] hidden xl:table-cell", ah == null ? "text-faint" : ah >= 30 ? "text-status-fail-text" : ah >= 20 ? "text-status-warn-text" : "text-fg")}>
                    {ah == null ? "—" : `${Math.round(ah)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
