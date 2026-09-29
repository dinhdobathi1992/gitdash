"use client";

/**
 * People — one row per person, grouped columns (As author / As reviewer /
 * Habits), sortable by Merged, CSV export with only the granted columns.
 * Linked accounts show "Linked: a + b" with Unlink for admins.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { fmtHours, peopleCsvRows, type PersonRow, type TeamInsights } from "@/lib/team-insights";
import { ExportButton } from "@/components/ExportButton";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";

const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));
const pct = (n: number | null) => (n === null ? "—" : `${n}%`);
function pctTone(n: number | null, warn: number, fail: number) {
  if (n === null) return "text-faint";
  return n >= fail ? "text-status-fail-text" : n >= warn ? "text-status-warn-text" : "text-fg";
}

const th = "h-9 px-3 text-left text-xs font-medium text-faint whitespace-nowrap";
const td = "px-3 font-mono text-[13px] tabular-nums whitespace-nowrap";

export function PeopleTable({ people, botLine, showBots, onToggleBots, owner, repo, grants, loading, canUnlink, onUnlink }: {
  people: PersonRow[];
  botLine: TeamInsights["botLine"];
  showBots: boolean;
  onToggleBots: () => void;
  owner: string;
  repo: string;
  grants: { workload: boolean; habits: boolean };
  loading: boolean;
  /** Admin in organization mode, with the stored links (to know which login is the alias). */
  canUnlink: { aliases: Set<string> } | null;
  onUnlink: (aliases: string[]) => Promise<void>;
}) {
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const sorted = useMemo(() => {
    const humans = people.filter((p) => !p.isBot);
    const bots = people.filter((p) => p.isBot);
    const v = (p: PersonRow) => p.merged ?? -1;
    humans.sort((a, b) => (dir === "desc" ? v(b) - v(a) : v(a) - v(b)) || (b.reviews ?? -1) - (a.reviews ?? -1));
    return [...humans, ...bots];
  }, [people, dir]);
  const habitsCols = (grants.workload ? 1 : 0) + (grants.habits ? 1 : 0);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <section id="people" aria-labelledby="people-title" className="card overflow-hidden scroll-mt-20 min-w-0">
      <div className="flex items-center justify-between gap-4 px-5 h-16 border-b border-line">
        <h2 id="people-title" className="text-[15px] font-semibold text-fg">People</h2>
        {people.length > 0 && (
          <ExportButton
            data={people}
            csvOnly
            label="Export CSV"
            filenameBase={`${repo}-people`}
            csvRows={() => peopleCsvRows(sorted, grants)}
          />
        )}
      </div>
      {loading ? (
        <div className="p-5 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-10 rounded skeleton" />)}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <caption className="sr-only">People in {owner}/{repo}</caption>
            <thead className="bg-panel border-b border-line">
              <tr>
                <td className="h-7" />
                <th scope="colgroup" colSpan={4} className="h-7 px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-faint border-l border-line">As author</th>
                <th scope="colgroup" colSpan={2} className="h-7 px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-faint border-l border-line">As reviewer</th>
                {habitsCols > 0 && <th scope="colgroup" colSpan={habitsCols} className="h-7 px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-faint border-l border-line">Habits</th>}
              </tr>
              <tr>
                <th scope="col" className={cn(th, "pl-5")}>Person</th>
                <th scope="col" className={cn(th, "border-l border-line")} aria-sort={dir === "desc" ? "descending" : "ascending"}>
                  <button type="button" onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))} className="inline-flex items-center gap-1 text-fg hover:text-link">
                    Merged
                    {dir === "desc" ? <ArrowDown className="w-3 h-3" aria-hidden="true" /> : <ArrowUp className="w-3 h-3" aria-hidden="true" />}
                  </button>
                </th>
                <th scope="col" className={th}>To merge</th>
                <th scope="col" className={th}>First-pass OK</th>
                <th scope="col" className={th}>Self</th>
                <th scope="col" className={cn(th, "border-l border-line")}>Reviews</th>
                <th scope="col" className={th}>Responds in</th>
                {grants.workload && <th scope="col" className={cn(th, "border-l border-line")}>After hours</th>}
                {grants.habits && <th scope="col" className={cn(th, !grants.workload && "border-l border-line")}>Oversized</th>}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={9} className="px-5 py-5 text-sm text-muted">
                  No merged pull requests or reviews in this window. If this repository is active, check that your GitHub
                  sign-in is authorized for the organization&apos;s single sign-on — GitHub search returns nothing otherwise.
                </td></tr>
              )}
              {sorted.map((p) => {
                const aliases = canUnlink && p.linkedLogins ? p.linkedLogins.filter((l) => canUnlink.aliases.has(l.toLowerCase())) : [];
                return (
                  <tr key={p.key} className={cn("border-b border-line last:border-0 hover:bg-[#161B23]/60", p.isBot && "opacity-60")}>
                    <td className="py-2.5 pl-5 pr-3">
                      <span className="flex items-center gap-3 min-w-0">
                        <Avatar login={p.login} src={p.avatar_url || undefined} size={28} dim={p.isBot} />
                        <span className="min-w-0">
                          {p.isBot || p.unlinkedName ? (
                            <span className="block font-mono text-[13px] text-fg truncate max-w-[220px]">{p.login}</span>
                          ) : (
                            <Link href={`/contributor/${p.login}?owner=${owner}&repo=${repo}`} className="block font-mono text-[13px] text-fg hover:text-link truncate max-w-[220px]">{p.login}</Link>
                          )}
                          <span className="block text-xs text-muted">
                            {p.unlinkedName ? "Git author name, not a GitHub account" : p.role}
                          </span>
                          {p.linkedLogins && (
                            <span className="block text-xs text-faint">
                              Linked: <span className="font-mono">{p.linkedLogins.join(" + ")}</span>
                              {aliases.length > 0 && (
                                <button
                                  type="button"
                                  disabled={busy === p.key}
                                  onClick={async () => { setBusy(p.key); try { await onUnlink(aliases); } finally { setBusy(null); } }}
                                  className="ml-2 text-link hover:underline disabled:opacity-50"
                                >
                                  {busy === p.key ? "Unlinking…" : "Unlink"}
                                </button>
                              )}
                            </span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className={cn(td, "text-fg border-l border-line")}>{num(p.merged)}</td>
                    <td className={cn(td, "text-fg")}>{p.merged === null ? "—" : fmtHours(p.toMergeHours)}</td>
                    <td className={cn(td, "text-fg")}>{pct(p.firstPassPct)}</td>
                    <td className={cn(td, p.selfMerged ? "text-status-warn-text" : "text-fg")}>{num(p.selfMerged)}</td>
                    <td className={cn(td, "text-fg border-l border-line")}>{num(p.reviews)}</td>
                    <td className={cn(td, "text-fg")}>{p.respondsInHours === null ? "—" : fmtHours(p.respondsInHours)}</td>
                    {grants.workload && <td className={cn(td, "border-l border-line", pctTone(p.afterHoursPct, 20, 30))}>{pct(p.afterHoursPct)}</td>}
                    {grants.habits && <td className={cn(td, !grants.workload && "border-l border-line", pctTone(p.oversizedPct, 20, 40))}>{pct(p.oversizedPct)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {botLine && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-line text-xs text-muted">
          <span>{botLine.text}</span>
          <button type="button" onClick={onToggleBots} className="font-medium text-link hover:text-violet-200">
            {showBots ? "Hide bots" : "Show bots"}
          </button>
        </div>
      )}
    </section>
  );
}
