"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { ReviewerLoadCell } from "@/app/api/github/repo-contributors/route";

/**
 * Author × Reviewer heatmap matrix.
 * Rows = PR authors, Columns = reviewers, Cell = review count.
 */
export function ReviewerLoadMatrix({
  matrix,
}: {
  matrix: ReviewerLoadCell[];
}) {
  const { authors, reviewers, grid, maxCount } = useMemo(() => {
    if (matrix.length === 0) return { authors: [], reviewers: [], grid: new Map(), maxCount: 0 };

    const authorsSet = new Set<string>();
    const reviewersSet = new Set<string>();
    const gridMap = new Map<string, number>();
    let max = 0;

    for (const cell of matrix) {
      authorsSet.add(cell.author);
      reviewersSet.add(cell.reviewer);
      const key = `${cell.author}::${cell.reviewer}`;
      gridMap.set(key, cell.count);
      if (cell.count > max) max = cell.count;
    }

    // Sort by total reviews given (columns) and total PRs authored (rows)
    const reviewerTotals = new Map<string, number>();
    const authorTotals = new Map<string, number>();
    for (const cell of matrix) {
      reviewerTotals.set(cell.reviewer, (reviewerTotals.get(cell.reviewer) ?? 0) + cell.count);
      authorTotals.set(cell.author, (authorTotals.get(cell.author) ?? 0) + cell.count);
    }

    const sortedAuthors = Array.from(authorsSet).sort(
      (a, b) => (authorTotals.get(b) ?? 0) - (authorTotals.get(a) ?? 0)
    );
    const sortedReviewers = Array.from(reviewersSet).sort(
      (a, b) => (reviewerTotals.get(b) ?? 0) - (reviewerTotals.get(a) ?? 0)
    );

    return {
      authors: sortedAuthors,
      reviewers: sortedReviewers,
      grid: gridMap,
      maxCount: max,
    };
  }, [matrix]);

  if (matrix.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-600 text-sm italic">
        No review data available for matrix
      </div>
    );
  }

  function getCellColor(count: number): string {
    if (count === 0) return "bg-slate-800/30";
    const ratio = count / maxCount;
    if (ratio <= 0.25) return "bg-violet-900/40";
    if (ratio <= 0.5) return "bg-violet-700/50";
    if (ratio <= 0.75) return "bg-violet-500/50";
    return "bg-violet-400/60";
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="py-1.5 px-2 text-xs text-slate-500 text-left font-normal">
                Author \ Reviewer
              </th>
              {reviewers.map((r) => (
                <th
                  key={r}
                  className="py-1.5 px-1 text-xs text-slate-400 font-medium"
                  style={{ writingMode: "vertical-lr", transform: "rotate(180deg)", maxHeight: 80 }}
                >
                  <span className="truncate block max-w-[80px]">{r}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {authors.map((author) => (
              <tr key={author}>
                <td className="py-0.5 px-2 text-xs text-slate-400 font-medium whitespace-nowrap">
                  {author}
                </td>
                {reviewers.map((reviewer) => {
                  const key = `${author}::${reviewer}`;
                  const count = grid.get(key) ?? 0;
                  return (
                    <td key={reviewer} className="p-0.5">
                      <div
                        title={`${author} → ${reviewer}: ${count} review${count !== 1 ? "s" : ""}`}
                        className={cn(
                          "w-7 h-7 rounded-sm flex items-center justify-center text-xs font-mono transition-colors",
                          getCellColor(count),
                          count > 0 ? "text-slate-200" : "text-transparent"
                        )}
                      >
                        {count > 0 ? count : ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-600">Fewer</span>
        <div className="w-4 h-4 rounded-sm bg-slate-800/30" />
        <div className="w-4 h-4 rounded-sm bg-violet-900/40" />
        <div className="w-4 h-4 rounded-sm bg-violet-700/50" />
        <div className="w-4 h-4 rounded-sm bg-violet-500/50" />
        <div className="w-4 h-4 rounded-sm bg-violet-400/60" />
        <span className="text-xs text-slate-600">More reviews</span>
      </div>
    </div>
  );
}
