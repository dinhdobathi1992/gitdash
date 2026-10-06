"use client";

/**
 * Connected apps — the AI apps (Claude, Cursor, …) a user has signed in to
 * GitDash's /mcp/me endpoint, and their personal MCP keys, with a Revoke
 * action. `scope="all"` is the admin variant (organization mode only): every
 * user's apps and keys, labelled with the owner.
 *
 * The card learns that MCP is enabled from the grants API itself: it answers
 * 404 when MCP is off (or, in standalone mode, when there is no database),
 * and the card then renders nothing.
 *
 * A new key is shown once, in the create dialog, and lives only in that
 * dialog's state: closing the dialog drops it. The list and its refetches come
 * from the grants API, which never holds a key.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { X } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, EmptyLine, ErrorBanner } from "@/components/ui/Card";
import { FetchError, fetcher } from "@/lib/swr";
import { PERSONAL_KEY_CLIENT_ID, RESOURCE_PATH } from "@/lib/mcp/oauth/config";

interface ConnectedApp {
  grant_id: string;
  client_id: string;
  client_name: string;
  redirect_host: string;
  created_at: string;
  last_used_at: string | null;
  absolute_expiry: string;
  /** Admin view only. */
  github_id?: number;
  login?: string | null;
}

interface CreatedKey {
  key: string;
  grant_id: string;
  expires_at: string;
}

const MAX_LABEL = 80;

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

/** "Nov 6" — an absolute date for an expiry. */
function on(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const isPersonalKey = (g: Pick<ConnectedApp, "client_id">) => g.client_id === PERSONAL_KEY_CLIENT_ID;

/** The row title: "Personal key · <label>" for a key, the redirect host for an OAuth app. */
export function grantTitle(g: Pick<ConnectedApp, "client_id" | "client_name" | "redirect_host">): string {
  return isPersonalKey(g) ? `Personal key · ${g.client_name}` : g.redirect_host;
}

/** Ready-to-paste client configuration for a key. */
export function keySnippets(origin: string, key: string): { claude: string; cursor: string } {
  const url = `${origin}${RESOURCE_PATH}`;
  return {
    claude: `claude mcp add --transport http gitdash ${url} --header "Authorization: Bearer ${key}"`,
    cursor: JSON.stringify({ mcpServers: { gitdash: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
  };
}

/**
 * Copy at click time. The async Clipboard API needs a secure context; the
 * fallback copies from a hidden textarea. False when both fail.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or insecure context: try the fallback.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

function CopyBlock({ id, label, text, onCopied }: { id: string; label: string; text: string; onCopied: (ok: boolean, what: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span id={id} className="text-xs text-muted">{label}</span>
        <Button id={`${id}-copy`} size="sm" aria-label={`Copy ${label}`} onClick={async () => onCopied(await copyText(text), label)}>
          Copy
        </Button>
      </div>
      <pre aria-labelledby={id} className="max-h-40 overflow-auto rounded-control border border-line bg-panel px-3 py-2 font-mono text-xs text-fg whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  );
}

export function ConnectedAppsCard({ scope = "own" }: { scope?: "own" | "all" }) {
  const { resolvedMode } = useAuth();
  const all = scope === "all";
  const url = `/api/mcp/grants${all ? "?all=1" : ""}`;
  // Own grants and keys exist in both modes; the all-users view is organization only.
  const enabled = resolvedMode !== null && (!all || resolvedMode === "organization");
  const { data, error, isLoading, mutate } = useSWR<{ grants: ConnectedApp[] }>(
    enabled ? url : null,
    fetcher,
    { dedupingInterval: 0, shouldRetryOnError: false },
  );

  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<ConnectedApp | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);

  const createDialog = useRef<HTMLDialogElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createFailure, setCreateFailure] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    const d = dialog.current;
    if (target && d && !d.open) d.showModal();
  }, [target]);

  useEffect(() => {
    const d = createDialog.current;
    if (creating && d && !d.open) d.showModal();
  }, [creating]);

  // The form that had focus is gone once the key shows: move focus to its Copy button.
  useEffect(() => {
    if (created) document.getElementById("new-key-copy")?.focus();
  }, [created]);

  if (!enabled) return null;
  // 404: MCP is not enabled on this deployment, so there is nothing to show.
  if (error instanceof FetchError && error.status === 404) return null;

  const closeDialog = () => {
    dialog.current?.close();
    setTarget(null);
    setFailure(null);
    returnFocus.current?.focus();
  };

  // Drops the key from memory: once closed, it can never be shown again.
  const resetCreate = () => {
    setCreating(false);
    setCreated(null);
    setLabel("");
    setCreateFailure(null);
    setCopyStatus("");
  };
  const closeCreate = () => {
    createDialog.current?.close();
    resetCreate();
    createButton.current?.focus();
  };

  async function revoke() {
    if (!target || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch(`/api/mcp/grants/${encodeURIComponent(target.grant_id)}`, { method: "DELETE", credentials: "same-origin" });
      const name = grantTitle(target);
      if (res.ok) {
        setAnnounce(`Revoked ${name}. GitDash stops accepting it within a minute.`);
      } else if (res.status === 404) {
        setAnnounce(`${name} was already disconnected.`);
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

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    if (createBusy) return;
    const name = label.trim();
    if (!name) {
      setCreateFailure("Give the key a label.");
      return;
    }
    setCreateBusy(true);
    setCreateFailure(null);
    try {
      const res = await fetch("/api/mcp/keys", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: name }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<CreatedKey> & { error?: string };
      if (res.status === 201 && typeof body.key === "string" && typeof body.grant_id === "string" && typeof body.expires_at === "string") {
        setCreated({ key: body.key, grant_id: body.grant_id, expires_at: body.expires_at });
        setAnnounce(`Created key ${name}. Copy it now; it is shown only once.`);
        void mutate();
      } else {
        setCreateFailure(body.error ?? `Could not create the key (HTTP ${res.status}).`);
      }
    } catch {
      setCreateFailure("Network error. Could not reach the server.");
    } finally {
      setCreateBusy(false);
    }
  }

  const onCopied = (ok: boolean, what: string) =>
    setCopyStatus(ok ? `Copied ${what}.` : `Could not copy ${what}. Select the text and copy it yourself.`);

  const grants = data?.grants ?? [];
  const title = all ? "Connected apps, all users" : "Connected apps";
  const origin = typeof window !== "undefined" ? window.location.origin : "https://<host>";
  const snippets = created ? keySnippets(origin, created.key) : null;

  return (
    <Card aria-labelledby={`connected-apps-${scope}`} className="p-5 flex flex-col gap-4">
      <CardHeader
        id={`connected-apps-${scope}`}
        title={title}
        description={
          all
            ? "AI apps and personal MCP keys connected to /mcp/me by anyone in the organization. Revoking one stops GitDash accepting it."
            : "AI apps and personal MCP keys that read GitDash data as you, read-only, through /mcp/me."
        }
        actions={
          all ? undefined : (
            <Button
              ref={createButton}
              size="sm"
              onClick={() => {
                resetCreate();
                setCreating(true);
              }}
            >
              Create MCP key
            </Button>
          )
        }
      />

      {/* Always mounted so assistive tech registers the region before it changes. */}
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>

      {error && <ErrorBanner message="Could not load connected apps." onRetry={() => void mutate()} />}

      {isLoading && !data && <p className="text-[13px] text-muted">Loading…</p>}

      {data && grants.length === 0 && (
        <EmptyLine className="px-0 py-1">
          {all ? (
            "No AI apps or keys are connected."
          ) : (
            <>
              Nothing connected. Create an MCP key, or add{" "}
              <code className="font-mono text-[13px] text-fg">{origin}/mcp/me</code>{" "}
              in Claude or Cursor — see <Link href="/docs/mcp" className="text-link hover:text-violet-200 underline underline-offset-2">Docs → MCP server</Link>.
            </>
          )}
        </EmptyLine>
      )}

      {grants.length > 0 && (
        <ul className="rounded-control border border-line overflow-hidden">
          {grants.map((g) => {
            const key = isPersonalKey(g);
            const name = grantTitle(g);
            return (
              <li key={g.grant_id} className="flex items-center gap-4 px-4 py-3 border-b border-line last:border-0 bg-surface/60">
                <div className="flex-1 min-w-0">
                  <p className={`${key ? "" : "font-mono "}text-[13px] text-fg break-all`}>{name}</p>
                  {(!key || all) && (
                    <p className="mt-0.5 text-[13px] text-muted break-words">
                      {!key && <>calls itself <span className="text-fg">{g.client_name}</span></>}
                      {!key && all && " · "}
                      {all && <span className="font-mono">{g.login ? `@${g.login}` : `user ${g.github_id}`}</span>}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-faint">
                    {key ? "Created" : "Connected"} {when(g.created_at)} · {g.last_used_at ? `last used ${when(g.last_used_at)}` : "not used yet"}
                    {key && <> · expires {on(g.absolute_expiry)}</>}
                  </p>
                </div>
                <Button
                  size="sm"
                  aria-label={`Revoke ${name}${all && g.login ? ` for @${g.login}` : ""}`}
                  onClick={(e) => {
                    returnFocus.current = e.currentTarget;
                    setFailure(null);
                    setTarget(g);
                  }}
                >
                  Revoke
                </Button>
              </li>
            );
          })}
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
                Revoke {isPersonalKey(target) ? grantTitle(target) : <span className="font-mono">{target.redirect_host}</span>}?
              </h2>
              <button type="button" onClick={closeDialog} aria-label="Close" className="inline-flex h-7 w-7 items-center justify-center rounded-control text-muted hover:text-fg hover:bg-panel">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {isPersonalKey(target) ? (
              <>
                <p className="mt-3 text-[13px] text-muted">
                  {all && target.login ? <>This is <span className="font-mono text-fg">@{target.login}</span>&apos;s key. </> : null}
                  GitDash stops accepting this key within a minute. Apps configured with it lose access.
                </p>
                <p className="mt-2 text-xs text-faint">
                  The key holds the GitHub token it was created with. If it leaked and that was a personal access token,
                  also rotate the token in{" "}
                  <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-link hover:text-violet-200 underline underline-offset-2">GitHub → Settings → Tokens</a>.
                </p>
              </>
            ) : (
              <>
                <p className="mt-3 text-[13px] text-muted">
                  {all && target.login ? <>This is <span className="font-mono text-fg">@{target.login}</span>&apos;s app. </> : null}
                  GitDash stops accepting this app&apos;s token within a minute, so it can no longer read your data.
                  It can sign in again if you allow it.
                </p>
                <p className="mt-2 text-xs text-faint">
                  The token holds a GitHub token. To cut GitHub access too, revoke GitDash in{" "}
                  <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer" className="text-link hover:text-violet-200 underline underline-offset-2">GitHub → Settings → Applications</a>.
                </p>
              </>
            )}
            {failure && <ErrorBanner className="mt-3" message={failure} />}
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={closeDialog} disabled={busy}>Cancel</Button>
              <Button variant="primary" onClick={revoke} disabled={busy}>{busy ? "Revoking…" : "Revoke"}</Button>
            </div>
          </div>
        )}
      </dialog>

      {!all && (
        <dialog
          ref={createDialog}
          onClose={resetCreate}
          // Once the key shows, only Done or Close dismiss it: Escape or a stray
          // backdrop click must not throw away a key that is never shown again.
          onCancel={(e) => { if (created) e.preventDefault(); }}
          onClick={(e) => { if (e.target === e.currentTarget && !createBusy && !created) closeCreate(); }}
          aria-labelledby="create-key-title"
          aria-describedby={created ? "new-key-warning" : undefined}
          className="m-auto w-[min(560px,calc(100vw-32px))] max-w-none p-0 bg-transparent backdrop:bg-black/60"
        >
          {creating && (
            <div className="float-card p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 id="create-key-title" className="text-[15px] font-semibold text-fg">
                  {created ? "Your new MCP key" : "Create an MCP key"}
                </h2>
                <button type="button" onClick={closeCreate} aria-label="Close" className="inline-flex h-7 w-7 items-center justify-center rounded-control text-muted hover:text-fg hover:bg-panel">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {!created ? (
                <form onSubmit={createKey} className="mt-3 flex flex-col gap-3">
                  <p className="text-[13px] text-muted">
                    A key lets Claude Code, Cursor or Claude Desktop read GitDash as you, with one header and no sign-in
                    flow. It expires in 30 days.
                  </p>
                  <label className="flex flex-col gap-1.5 text-xs text-muted">
                    Label
                    <input
                      autoFocus
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      maxLength={MAX_LABEL}
                      required
                      placeholder="Claude Code on my laptop"
                      className="h-9 px-3 rounded-control bg-panel border border-control-strong text-sm text-fg"
                    />
                  </label>
                  {createFailure && <ErrorBanner message={createFailure} />}
                  <div className="mt-2 flex justify-end gap-2">
                    <Button onClick={closeCreate} disabled={createBusy}>Cancel</Button>
                    <Button type="submit" variant="primary" disabled={createBusy}>{createBusy ? "Creating…" : "Create key"}</Button>
                  </div>
                </form>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  <p id="new-key-warning" className="text-[13px] text-status-warn-text">
                    Copy it now: it is shown only once. Treat it like a password; it contains your GitHub access.
                  </p>
                  <CopyBlock id="new-key" label="key" text={created.key} onCopied={onCopied} />
                  {snippets && (
                    <>
                      <CopyBlock id="new-key-claude" label="Claude Code command" text={snippets.claude} onCopied={onCopied} />
                      <CopyBlock id="new-key-cursor" label="Cursor mcp.json" text={snippets.cursor} onCopied={onCopied} />
                    </>
                  )}
                  <p className="text-xs text-faint">Expires {on(created.expires_at)}. Revoke it here at any time.</p>
                  <p role="status" aria-live="polite" className="text-xs text-muted min-h-4">{copyStatus}</p>
                  <div className="flex justify-end">
                    <Button variant="primary" onClick={closeCreate}>Done</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </dialog>
      )}
    </Card>
  );
}
