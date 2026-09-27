"use client";

/**
 * "Who reviews whom" — reviewer columns × author rows on the violet heat
 * ramp (contract §3.1). Every cell shows its number, so colour is never the
 * only signal; empty cells show a muted 0.
 */

import Link from "next/link";
import type { ReviewerLoadCell } from "@/app/api/github/repo-contributors/route";
import { HEAT_RAMP } from "@/components/charts";
import { Card, CardHeader } from "@/components/ui/Card";

const MAX_PEOPLE = 8;

function step(count: number, max: number): number {
  if (count <= 0) return 0;
  return Math.min(4, 1 + Math.floor((count / max) * 3.999));
}

export function ReviewHeatmap({ matrix, owner }: { matrix: ReviewerLoadCell[]; owner: string }) {
  const volume = (key: "author" | "reviewer") => {
    const m = new Map<string, number>();
    for (const c of matrix) m.set(c[key], (m.get(c[key]) ?? 0) + c.count);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_PEOPLE).map(([k]) => k);
  };
  const reviewers = volume("reviewer");
  const authors = volume("author");
  const lookup = new Map(matrix.map((c) => [`${c.author}|${c.reviewer}`, c.count]));
  const max = Math.max(1, ...matrix.map((c) => c.count));

  return (
    <Card className="p-5 min-w-0">
      <CardHeader
        title="Who reviews whom"
        description="Reviews given, by reviewer (columns) and author (rows)"
        actions={
          <span className="inline-flex items-center gap-1.5 font-mono" aria-hidden="true">
            0
            {HEAT_RAMP.slice(1).map((c) => <span key={c} className="w-3.5 h-2.5 rounded-[2px]" style={{ background: c }} />)}
            {max}
          </span>
        }
      />
      {authors.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No cross-reviews in the analysed pull requests.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="border-separate border-spacing-1 text-[13px]">
            <caption className="sr-only">Pull request reviews by reviewer and author</caption>
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Author</span></th>
                {reviewers.map((r) => (
                  <th key={r} scope="col" className="h-6 px-1 text-xs font-normal text-muted text-center max-w-[80px] truncate">
                    <Link href={`/contributor/${r}?owner=${owner}`} className="hover:text-fg">{r}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {authors.map((a) => (
                <tr key={a}>
                  <th scope="row" className="pr-3 text-left text-xs font-normal text-muted whitespace-nowrap max-w-[110px] truncate">
                    <Link href={`/contributor/${a}?owner=${owner}`} className="hover:text-fg">{a}</Link>
                  </th>
                  {reviewers.map((r) => {
                    if (a === r) return <td key={r} className="w-[76px] h-10" aria-label="Self" />;
                    const n = lookup.get(`${a}|${r}`) ?? 0;
                    const s = step(n, max);
                    return (
                      <td
                        key={r}
                        className="w-[76px] h-10 rounded-[4px] text-center font-mono text-[13px]"
                        style={{ background: HEAT_RAMP[s], color: s === 4 ? "#14102B" : s === 0 ? "#7A818D" : "#EDEAE3" }}
                        title={`${r} reviewed ${n} of ${a}'s pull requests`}
                      >
                        {n}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
