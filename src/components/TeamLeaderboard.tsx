"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ArrowUpDown } from "lucide-react";
import type { ContributorRow } from "@/app/api/github/repo-contributors/route";

type SortKey = keyof Pick<
  ContributorRow,
  | "prs_merged"
  | "reviews_given"
  | "avg_hours_to_merge"
  | "avg_pr_size"
  | "avg_review_turnaround_hours"
  | "first_pass_approval_rate"
  | "self_merge_count"
  | "comment_count"
>;

const COLUMNS: { key: SortKey; label: string; unit?: string; align?: string }[] = [
  { key: "prs_merged", label: "PRs Merged" },
  { key: "reviews_given", label: "Reviews" },
  { key: "avg_hours_to_merge", label: "Avg Lead Time", unit: "h" },
  { key: "avg_pr_size", label: "Avg PR Size", unit: "LOC" },
  { key: "avg_review_turnaround_hours", label: "Review Response", unit: "h" },
  { key: "first_pass_approval_rate", label: "1st Pass Approval", unit: "%" },
  { key: "self_merge_count", label: "Self-Merges" },
  { key: "comment_count", label: "Comments" },
];

function fmtHours(h: number): string {
  if (h <= 0) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export function TeamLeaderboard({
  contributors,
  owner,
}: {
  contributors: ContributorRow[];
  owner: string;
  repo?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("prs_merged");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...contributors];
    copy.sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortAsc ? av - bv : bv - av;
    });
    return copy;
  }, [contributors, sortKey, sortAsc]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  function formatValue(key: SortKey, val: number): string {
    if (key === "avg_hours_to_merge" || key === "avg_review_turnaround_hours") {
      return fmtHours(val);
    }
    if (key === "first_pass_approval_rate") return `${val}%`;
    if (key === "avg_pr_size") return val.toLocaleString();
    return String(val);
  }

  if (contributors.length === 0) {
    return (
      <div className="text-center py-10 text-slate-600 text-sm italic">
        No contributor data available
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/60">
              <th className="py-2.5 pl-5 pr-4 text-left text-xs font-medium text-slate-400 tracking-wide sticky left-0 bg-slate-900/95 z-10">
                Contributor
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="py-2.5 px-3 text-right text-xs font-medium text-slate-400 tracking-wide cursor-pointer hover:text-white transition-colors whitespace-nowrap"
                  onClick={() => handleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key && (
                      <ArrowUpDown className="w-3 h-3 text-violet-400" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((c, i) => (
              <tr
                key={c.login}
                className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
              >
                <td className="py-3 pl-5 pr-4 sticky left-0 bg-slate-950/90 z-10">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs text-slate-600 font-mono w-4 text-right shrink-0">
                      {i + 1}
                    </span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.avatar_url}
                      alt={c.login}
                      className="w-6 h-6 rounded-full shrink-0"
                    />
                    <Link
                      href={`/contributor/${c.login}?owner=${owner}`}
                      className="text-sm font-medium text-white hover:text-violet-300 transition-colors"
                    >
                      {c.login}
                    </Link>
                  </div>
                </td>
                {COLUMNS.map((col) => {
                  const val = c[col.key] as number;
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        "py-3 px-3 text-right font-mono whitespace-nowrap",
                        col.key === "self_merge_count" && val > 0
                          ? "text-amber-400"
                          : col.key === "first_pass_approval_rate" && val >= 80
                            ? "text-green-400"
                            : "text-slate-300"
                      )}
                    >
                      {formatValue(col.key, val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
