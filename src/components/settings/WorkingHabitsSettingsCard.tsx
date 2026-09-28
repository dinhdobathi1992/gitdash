"use client";

/**
 * Working-habits thresholds (Settings → Working habits, organization admins).
 * They decide what counts as an oversized commit or pull request everywhere
 * the feature shows up: Team insights, the contributor profile, the alert
 * and the Monday digest line.
 */

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { WorkingHabitsSettingsResponse } from "@/app/api/settings/working-habits/route";
import type { WorkingHabitsThresholds } from "@/lib/working-habits-settings";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/Card";

const FIELDS: { key: keyof WorkingHabitsThresholds; label: string; hint: string }[] = [
  { key: "maxCommitFiles", label: "Files per commit", hint: "A commit changing more files is oversized" },
  { key: "maxCommitLines", label: "Lines per commit", hint: "Additions plus deletions" },
  { key: "maxPrCommits", label: "Commits per pull request", hint: "A pull request with more commits is oversized" },
];

export function WorkingHabitsSettingsCard({ notify }: { notify: (msg: string, error?: boolean) => void }) {
  const { data, error, mutate } = useSWR<WorkingHabitsSettingsResponse>("/api/settings/working-habits", fetcher<WorkingHabitsSettingsResponse>);
  const [draft, setDraft] = useState<Record<keyof WorkingHabitsThresholds, string> | null>(null);
  const [saving, setSaving] = useState(false);

  if (error) return <ErrorBanner message={`Couldn't load working-habits settings: ${(error as Error).message}`} onRetry={() => mutate()} />;
  if (!data) return <div className="card p-5"><div className="h-24 rounded skeleton" /></div>;

  const values = draft ?? {
    maxCommitFiles: String(data.thresholds.maxCommitFiles),
    maxCommitLines: String(data.thresholds.maxCommitLines),
    maxPrCommits: String(data.thresholds.maxPrCommits),
  };

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/working-habits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f.key, Number(values[f.key])]))),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(body.error ?? `Save failed (${res.status})`, true);
        return;
      }
      notify("Saved. Working-habits figures use the new limits on the next page load.");
      setDraft(null);
      mutate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="working-habits-settings-title" className="flex flex-col gap-4">
      <h2 id="working-habits-settings-title" className="text-lg font-semibold text-fg">Working habits</h2>
      <div className="card p-5">
        <p className="text-[13px] text-muted max-w-2xl">
          Limits for small commits and small pull requests. A commit is over the limit when it changes more files <em>or</em> more lines than set here.
          {!data.configurable && " Organization mode with a database is needed to change them; the defaults apply."}
        </p>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => { e.preventDefault(); save(); }}
        >
          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1.5 text-[13px] text-fg">
              {f.label}
              <input
                type="number"
                inputMode="numeric"
                min={data.min}
                max={data.max}
                step={1}
                required
                disabled={!data.configurable}
                value={values[f.key]}
                onChange={(e) => setDraft({ ...values, [f.key]: e.target.value })}
                className="h-9 px-3 rounded-control bg-panel border border-control-strong font-mono text-[13px] text-fg focus:outline-none focus:border-brand-fg disabled:opacity-60"
              />
              <span className="text-xs text-faint">{f.hint} · default {data.defaults[f.key]}</span>
            </label>
          ))}
          {data.configurable && (
            <div className="sm:col-span-3 flex items-center gap-3 flex-wrap">
              <Button type="submit" variant="primary" disabled={saving || draft === null}>{saving ? "Saving…" : "Save"}</Button>
              {draft && <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>}
              {data.updated_by && (
                <span className="text-xs text-faint">
                  Last changed by @{data.updated_by}{data.updated_at ? ` on ${new Date(data.updated_at).toLocaleDateString()}` : ""}
                </span>
              )}
            </div>
          )}
        </form>
      </div>
    </section>
  );
}
