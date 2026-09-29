"use client";

/**
 * "Are A and B the same person?" — the last card in What stands out, admins
 * only. Linking asks for confirmation first (it changes numbers on every Team
 * page for everyone); "Different people" never suggests the pair again. Both
 * can be undone in Settings → Account links.
 */

import { useRef, useState } from "react";
import { Users, X } from "lucide-react";
import type { Suggestion } from "@/lib/team-insights";
import { Button } from "@/components/ui/Button";
import { RichText } from "./RichText";

export function IdentityCard({ s, onLink, onDistinct }: {
  s: Suggestion;
  onLink: (alias: string, primary: string) => Promise<void>;
  onDistinct: (a: string, b: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState<"link" | "distinct" | null>(null);

  async function run(kind: "link" | "distinct") {
    setBusy(kind);
    try {
      if (kind === "link") await onLink(s.alias, s.primary);
      else await onDistinct(s.a, s.b);
      dialog.current?.close();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 border-t border-line">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-status-run-tint text-status-run-text" aria-hidden="true">
        <Users className="h-3.5 w-3.5" />
      </span>
      <span className="flex-1 min-w-[200px]">
        <span className="block text-sm font-medium text-fg"><RichText parts={s.title} /></span>
        <span className="block mt-0.5 text-[13px] text-muted"><RichText parts={s.detail} /></span>
      </span>
      <span className="flex items-center gap-2 ml-10 sm:ml-0">
        <Button size="sm" disabled={busy !== null} onClick={() => run("distinct")}>
          {busy === "distinct" ? "Saving…" : "Different people"}
        </Button>
        <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => dialog.current?.showModal()}>Link accounts</Button>
      </span>

      <dialog
        ref={dialog}
        onClick={(e) => { if (e.target === e.currentTarget) dialog.current?.close(); }}
        aria-labelledby={`link-title-${s.alias}`}
        className="m-auto w-[min(480px,calc(100vw-32px))] max-w-none p-0 bg-transparent backdrop:bg-black/60"
      >
        <div className="float-card p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={`link-title-${s.alias}`} className="text-[15px] font-semibold text-fg">Link these accounts?</h2>
            <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="inline-flex h-7 w-7 items-center justify-center rounded-control text-muted hover:text-fg hover:bg-panel">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-3 text-[13px] text-muted">
            <span className="font-mono text-fg">{s.alias}</span> will count as <span className="font-mono text-fg">{s.primary}</span> on every Team page, for everyone:
          </p>
          <ul className="mt-2 list-disc pl-5 text-[13px] text-muted space-y-1">
            <li>pull requests, reviews, commits and working habits are added together;</li>
            <li>reviews between the two become self-reviews — not a human review, not in the bus factor;</li>
            <li>it changes numbers only, never who can see what.</li>
          </ul>
          <p className="mt-3 text-xs text-faint">Admins can unlink at any time in Settings → Account links. The change is in the audit log.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => dialog.current?.close()}>Cancel</Button>
            <Button variant="primary" disabled={busy !== null} onClick={() => run("link")}>{busy === "link" ? "Linking…" : "Link accounts"}</Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
