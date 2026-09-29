"use client";

/**
 * Account links (Settings → Account links, organization admins). Every
 * stored link (alias → main login, who, when, Unlink) and every "different
 * people" pair (Undo), including logins not on any Team page right now.
 * Links change numbers on Team insights, never access.
 */

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { formatRelative } from "@/lib/utils";
import type { IdentityLinksResponse } from "@/app/api/admin/identity-links/route";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/Card";

async function call(url: string, method: "DELETE"): Promise<string | null> {
  const res = await fetch(url, { method, credentials: "same-origin" });
  if (res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? `HTTP ${res.status}`;
}

const th = "h-10 px-3 text-left text-xs font-medium text-faint";

export function AccountLinksCard({ notify }: { notify: (msg: string, error?: boolean) => void }) {
  const { data, error, mutate } = useSWR<IdentityLinksResponse>("/api/admin/identity-links", fetcher<IdentityLinksResponse>, { dedupingInterval: 0 });
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, url: string, done: string) {
    setBusy(key);
    try {
      const err = await call(url, "DELETE");
      if (err) notify(err, true);
      else {
        notify(done);
        await mutate();
      }
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBanner message={`Couldn't load account links: ${(error as Error).message}`} onRetry={() => mutate()} />;

  return (
    <section aria-labelledby="links-title" className="flex flex-col gap-4">
      <div>
        <h2 id="links-title" className="text-lg font-semibold text-fg">Account links</h2>
        <p className="mt-1 text-[13px] text-muted max-w-2xl">
          GitHub logins that belong to one person count as one on Team insights: pull requests, reviews, commits and working habits are added together, and reviews between them are self-reviews.
          Links change numbers only, never access. Add them from the suggestions on Team insights.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <caption className="sr-only">Linked accounts</caption>
          <thead className="bg-panel border-b border-line">
            <tr>
              <th scope="col" className={`${th} pl-5`}>Login</th>
              <th scope="col" className={th}>Counts as</th>
              <th scope="col" className={th}>Linked by</th>
              <th scope="col" className={`${th} pr-5`}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={4} className="p-5"><div className="h-10 rounded skeleton" /></td></tr>}
            {data?.links.length === 0 && <tr><td colSpan={4} className="px-5 py-5 text-sm text-muted">No linked accounts.</td></tr>}
            {data?.links.map((l) => (
              <tr key={l.alias_login} className="border-b border-line last:border-0 text-[13px]">
                <td className="h-12 pl-5 pr-3 font-mono text-fg">{l.alias_login}</td>
                <td className="px-3 font-mono text-fg">{l.primary_login}</td>
                <td className="px-3 text-muted">
                  {l.created_by ? `@${l.created_by}` : "—"}
                  {l.created_at && <span className="text-faint" title={l.created_at}> · {formatRelative(l.created_at)}</span>}
                </td>
                <td className="px-3 pr-5 text-right">
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => run(l.alias_login, `/api/admin/identity-links?alias=${encodeURIComponent(l.alias_login)}`, `Unlinked ${l.alias_login}.`)}
                  >
                    {busy === l.alias_login ? "Unlinking…" : "Unlink"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-[15px] font-semibold text-fg">Different people</h3>
        <p className="mt-1 text-[13px] text-muted">Pairs an admin said are not the same person. They are never suggested again unless you undo it.</p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <caption className="sr-only">Pairs marked as different people</caption>
          <thead className="bg-panel border-b border-line">
            <tr>
              <th scope="col" className={`${th} pl-5`}>Logins</th>
              <th scope="col" className={th}>Marked by</th>
              <th scope="col" className={`${th} pr-5`}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data?.distinct.length === 0 && <tr><td colSpan={3} className="px-5 py-5 text-sm text-muted">None.</td></tr>}
            {data?.distinct.map((d) => {
              const key = `${d.login_a}+${d.login_b}`;
              return (
                <tr key={key} className="border-b border-line last:border-0 text-[13px]">
                  <td className="h-12 pl-5 pr-3 font-mono text-fg">{d.login_a} <span className="text-faint">·</span> {d.login_b}</td>
                  <td className="px-3 text-muted">
                    {d.created_by ? `@${d.created_by}` : "—"}
                    {d.created_at && <span className="text-faint" title={d.created_at}> · {formatRelative(d.created_at)}</span>}
                  </td>
                  <td className="px-3 pr-5 text-right">
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => run(key, `/api/admin/identity-links/distinct?a=${encodeURIComponent(d.login_a)}&b=${encodeURIComponent(d.login_b)}`, "Undone — the pair can be suggested again.")}
                    >
                      {busy === key ? "Undoing…" : "Undo"}
                    </Button>
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
