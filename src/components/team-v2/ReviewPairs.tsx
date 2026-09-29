"use client";

/**
 * "Who reviews whom" — each pair, busiest first; a heatmap once 4 or more
 * people review. Both show pull requests (not review events), so the numbers
 * agree whichever view is on screen.
 */

import Link from "next/link";
import type { TeamInsights } from "@/lib/team-insights";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { ReviewHeatmap } from "@/components/team/ReviewHeatmap";
import { cn } from "@/lib/utils";

export function ReviewPairs({ pairs, owner, loading, avatars }: {
  pairs: TeamInsights["pairs"] | null;
  owner: string;
  loading: boolean;
  /** Avatar URL per lowercase login, from the contributors response. */
  avatars?: Map<string, string>;
}) {
  if (pairs?.mode === "heatmap") {
    return (
      <div id="reviews" className="min-w-0 scroll-mt-20 flex flex-col gap-2">
        <ReviewHeatmap matrix={pairs.cells} owner={owner} />
        <p className="px-1 text-xs text-faint">{pairs.footnote}</p>
      </div>
    );
  }
  return (
    <Card as="section" id="reviews" aria-labelledby="pairs-title" className="p-5 min-w-0 scroll-mt-20">
      <h2 id="pairs-title" className="text-[15px] font-semibold text-fg">Who reviews whom</h2>
      <p className="mt-1 text-[13px] text-muted">Each pair, busiest first. Switches to a heatmap once 4 or more people review.</p>
      {loading || !pairs ? (
        <div className="mt-4 space-y-3">{[0, 1].map((i) => <div key={i} className="h-10 rounded skeleton" />)}</div>
      ) : pairs.rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No reviews in this window.</p>
      ) : (
        <ul className="mt-3">
          {pairs.rows.map((p) => (
            <li key={`${p.author}|${p.reviewer}`} className={cn("grid grid-cols-[minmax(0,1fr)_minmax(60px,32%)_2.5rem] items-center gap-3 py-2.5 border-t border-line", p.bot && "opacity-60")}>
              <span className="flex items-center gap-3 min-w-0">
                <Avatar login={p.reviewer} src={avatars?.get(p.reviewer.toLowerCase()) || undefined} size={28} dim={p.bot} />
                <span className="min-w-0">
                  <Link href={`/contributor/${p.reviewer}?owner=${owner}`} className="block font-mono text-[13px] text-fg hover:text-link truncate">{p.reviewer}</Link>
                  <span className="block text-xs text-muted truncate">
                    reviewed <span className="font-mono">{p.author}</span>{p.bot && " · bot, not counted"}
                  </span>
                </span>
              </span>
              <span className="h-1.5 rounded-full bg-raised overflow-hidden" aria-hidden="true">
                <span className={cn("block h-full rounded-full", p.bot ? "bg-faint" : "bg-brand-fg")} style={{ width: `${Math.max(2, p.width)}%` }} />
              </span>
              <span className="text-right font-mono text-[13px] text-fg tabular-nums" aria-label={`${p.prs} pull requests`}>{p.prs}</span>
            </li>
          ))}
        </ul>
      )}
      {pairs && <p className="mt-3 text-xs text-faint">{pairs.footnote}</p>}
    </Card>
  );
}
