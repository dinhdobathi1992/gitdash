"use client";

/**
 * Connected apps — the AI apps (Claude, Cursor, …) a user has signed in to
 * GitDash's /mcp/me endpoint, with a Revoke action. `scope="all"` is the admin
 * variant: every user's apps, labelled with the owner.
 *
 * The card learns that MCP is enabled from the grants API itself: it answers
 * 404 when MCP is off, and the card then renders nothing. Standalone mode has
 * no MCP, so it never even asks.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { X } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, EmptyLine, ErrorBanner } from "@/components/ui/Card";
import { FetchError, fetcher } from "@/lib/swr";

interface ConnectedApp {
  grant_id: string;
  client_name: string;
  redirect_host: string;
  created_at: string;
  last_used_at: string | null;
  /** Admin view only. */
  github_id?: number;
  login?: string | null;
}

/** "18 min ago" under 7 days, "Sep 24" after (contract §7). */
function when(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  if (min < 7 * 1440) return `${Math.round(min / 1440)} d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ConnectedAppsCard({ scope = "own" }: { scope?: "own" | "all" }) {
  const { mode } = useAuth();
  const all = scope === "all";
  const url = `/api/mcp/grants${all ? "?all=1" : ""}`;
  const { data, error, isLoading, mutate } = useSWR<{ grants: ConnectedApp[] }>(
    mode === "organization" ? url : null,
    fetcher,
    { dedupingInterval: 0, shouldRetryOnError: false },
  );

  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<ConnectedApp | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (target && d && !d.open) d.showModal();
  }, [target]);

  if (mode !== "organization") return null;
  // 404: MCP is not enabled on this deployment, so there is nothing to show.
  if (error instanceof FetchError && error.status === 404) return null;

  const closeDialog = () => {
    dialog.current?.close();
    setTarget(null);
    setFailure(null);
    returnFocus.current?.focus();
  };

  async function revoke() {
    if (!target || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch(`/api/mcp/grants/${encodeURIComponent(target.grant_id)}`, { method: "DELETE", credentials: "same-origin" });
      const label = target.redirect_host;
      if (res.ok) {
        setAnnounce(`Revoked ${label}. GitDash stops accepting its token within a minute.`);
      } else if (res.status === 404) {
        setAnnounce(`${label} was already disconnected.`);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setFailure(body.error ?? `Could not revoke (HTTP ${res.status}).`);
        return;
      }
      await mutate();
      closeDialog();
    } catch {
      setFailure("Network error. Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const grants = data?.grants ?? [];
  const title = all ? "Connected apps, all users" : "Connected apps";

  return (
    <Card aria-labelledby={`connected-apps-${scope}`} className="p-5 flex flex-col gap-4">
      <CardHeader
        id={`connected-apps-${scope}`}
        title={title}
        description={
          all
            ? "AI apps signed in to /mcp/me by anyone in the organization. Revoking one stops GitDash accepting its token."
            : "AI apps you signed in to GitDash's /mcp/me endpoint. They read GitDash data as you, read-only."
        }
      />

      {/* Always mounted so assistive tech registers the region before it changes. */}
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>

      {error && <ErrorBanner message="Could not load connected apps." onRetry={() => void mutate()} />}

      {isLoading && !data && <p className="text-[13px] text-muted">Loading…</p>}

      {data && grants.length === 0 && (
        <EmptyLine className="px-0 py-1">
          {all ? (
            "No AI apps are connected."
          ) : (
            <>
              No AI apps connected. Add{" "}
              <code className="font-mono text-[13px] text-fg">{typeof window !== "undefined" ? window.location.origin : "https://<host>"}/mcp/me</code>{" "}
              in Claude or Cursor — see <Link href="/docs/mcp" className="text-link hover:text-violet-200 underline underline-offset-2">Docs → MCP server</Link>.
            </>
          )}
        </EmptyLine>
      )}

      {grants.length > 0 && (
        <ul className="rounded-control border border-line overflow-hidden">
          {grants.map((g) => (
            <li key={g.grant_id} className="flex items-center gap-4 px-4 py-3 border-b border-line last:border-0 bg-surface/60">
              <div className="flex-1 min-w-0">
                <p className="font-mono text-[13px] text-fg break-all">{g.redirect_host}</p>
                <p className="mt-0.5 text-[13px] text-muted break-words">
                  calls itself <span className="text-fg">{g.client_name}</span>
                  {all && <> · <span className="font-mono">{g.login ? `@${g.login}` : `user ${g.github_id}`}</span></>}
                </p>
                <p className="mt-0.5 text-xs text-faint">
                  Connected {when(g.created_at)} · {g.last_used_at ? `last used ${when(g.last_used_at)}` : "not used yet"}
                </p>
              </div>
              <Button
                size="sm"
                aria-label={`Revoke ${g.redirect_host}${all && g.login ? ` for @${g.login}` : ""}`}
                onClick={(e) => {
                  returnFocus.current = e.currentTarget;
                  setFailure(null);
                  setTarget(g);
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      <dialog
        ref={dialog}
        onClose={() => { setTarget(null); setFailure(null); }}
        onClick={(e) => { if (e.target === e.currentTarget && !busy) closeDialog(); }}
        aria-labelledby={`revoke-title-${scope}`}
        className="m-auto w-[min(480px,calc(100vw-32px))] max-w-none p-0 bg-transparent backdrop:bg-black/60"
      >
        {target && (
          <div className="float-card p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 id={`revoke-title-${scope}`} className="text-[15px] font-semibold text-fg">
                Revoke <span className="font-mono">{target.redirect_host}</span>?
              </h2>
              <button type="button" onClick={closeDialog} aria-label="Close" className="inline-flex h-7 w-7 items-center justify-center rounded-control text-muted hover:text-fg hover:bg-panel">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-3 text-[13px] text-muted">
              {all && target.login ? <>This is <span className="font-mono text-fg">@{target.login}</span>&apos;s app. </> : null}
              GitDash stops accepting this app&apos;s token within a minute, so it can no longer read your data.
              It can sign in again if you allow it.
            </p>
            <p className="mt-2 text-xs text-faint">
              The token holds a GitHub token. To cut GitHub access too, revoke GitDash in{" "}
              <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer" className="text-link hover:text-violet-200 underline underline-offset-2">GitHub → Settings → Applications</a>.
            </p>
            {failure && <ErrorBanner className="mt-3" message={failure} />}
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={closeDialog} disabled={busy}>Cancel</Button>
              <Button variant="primary" onClick={revoke} disabled={busy}>{busy ? "Revoking…" : "Revoke"}</Button>
            </div>
          </div>
        )}
      </dialog>
    </Card>
  );
}
