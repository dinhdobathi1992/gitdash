"use client";

import { AlertTriangle, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContributorRow, ReviewerLoadCell } from "@/app/api/github/repo-contributors/route";

/**
 * Surfaces two review-process risks that aren't visible anywhere else in the
 * app: reviewers carrying a disproportionate share of the review load, and
 * authors whose PRs are reviewed almost exclusively by one person (a single
 * point of failure distinct from bus factor, which tracks commits not
 * reviews). Built entirely from data repo-contributors already fetches —
 * no additional GitHub API calls.
 */
export default function ReviewBottleneck({
  contributors,
  matrix,
}: {
  contributors: ContributorRow[];
  matrix: ReviewerLoadCell[];
}) {
  const reviewers = contributors
    .filter((c) => c.reviews_given > 0)
    .sort((a, b) => b.reviews_given - a.reviews_given);

  const totalReviews = reviewers.reduce((s, r) => s + r.reviews_given, 0);
  const meanReviews = reviewers.length ? totalReviews / reviewers.length : 0;

  // Sole-reviewer risk: for each author, does one reviewer account for
  // ≥80% of the reviews their PRs received?
  const byAuthor = new Map<string, ReviewerLoadCell[]>();
  for (const cell of matrix) {
    const list = byAuthor.get(cell.author) ?? [];
    list.push(cell);
    byAuthor.set(cell.author, list);
  }
  const soleReviewerRisks: { author: string; reviewer: string; pct: number }[] = [];
  for (const [author, cells] of byAuthor) {
    const authorTotal = cells.reduce((s, c) => s + c.count, 0);
    if (authorTotal < 3) continue; // not enough signal
    const top = [...cells].sort((a, b) => b.count - a.count)[0];
    const pct = Math.round((top.count / authorTotal) * 100);
    if (pct >= 80) soleReviewerRisks.push({ author, reviewer: top.reviewer, pct });
  }
  soleReviewerRisks.sort((a, b) => b.pct - a.pct);

  if (reviewers.length === 0) {
    return (
      <p className="text-xs text-slate-600 italic py-4 text-center">
        No review data available for this repo.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* Reviewer load ranking */}
      <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Reviewer Load
        </h4>
        <div className="flex flex-col gap-2">
          {reviewers.slice(0, 10).map((r) => {
            const share = totalReviews > 0 ? r.reviews_given / totalReviews : 0;
            const overloaded = share > 0.4 || r.reviews_given > meanReviews * 2;
            return (
              <div key={r.login} className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.avatar_url} alt={r.login} width={18} height={18} className="w-[18px] h-[18px] rounded-full shrink-0" />
                    <span className="text-sm text-white truncate">{r.login}</span>
                    {overloaded && (
                      <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 shrink-0">
                        <AlertTriangle className="w-2.5 h-2.5" /> Overloaded
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">
                    {r.reviews_given} reviews ({Math.round(share * 100)}%)
                  </span>
                </div>
                <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", overloaded ? "bg-amber-500" : "bg-violet-500")}
                    style={{ width: `${Math.max(2, share * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sole-reviewer risk */}
      {soleReviewerRisks.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Sole-Reviewer Risk
          </h4>
          <p className="text-[11px] text-slate-500 mb-2">
            These authors&apos; PRs are reviewed almost exclusively by one person — if that
            reviewer is unavailable, reviews stall.
          </p>
          <div className="flex flex-col gap-1.5">
            {soleReviewerRisks.slice(0, 8).map((risk) => (
              <div
                key={`${risk.author}::${risk.reviewer}`}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-900/40 border border-slate-800 text-xs"
              >
                <UserCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-slate-300">
                  <span className="text-white font-medium">{risk.author}</span>&apos;s PRs are{" "}
                  <span className="text-amber-400 font-medium">{risk.pct}%</span> reviewed by{" "}
                  <span className="text-white font-medium">{risk.reviewer}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
