"use client";

/**
 * Team insights workday (Settings → Team insights, organization admins).
 * One time zone and one set of hours for the organization; commits outside
 * them count as after hours, and Saturday/Sunday in that zone as weekend, on
 * Team insights and the repo Team tab.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { TeamSettingsResponse } from "@/app/api/settings/team/route";
import { formatWorkday, type Workday } from "@/lib/team-settings";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/Card";

const HOURS = Array.from({ length: 25 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const field = "h-9 px-3 rounded-control bg-panel border border-control-strong font-mono text-[13px] text-fg focus:outline-none focus:border-brand-fg disabled:opacity-60";

function zones(current: string): string[] {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch { /* older browsers: the current zone and UTC only */ }
  return [...new Set([current, "UTC", ...list])].sort((a, b) => (a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b)));
}

export function TeamSettingsCard({ notify }: { notify: (msg: string, error?: boolean) => void }) {
  const { data, error, mutate } = useSWR<TeamSettingsResponse>("/api/settings/team", fetcher<TeamSettingsResponse>);
  const [draft, setDraft] = useState<Workday | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? data?.workday;
  const options = useMemo(() => zones(value?.timezone ?? "Asia/Saigon"), [value?.timezone]);

  if (error) return <ErrorBanner message={`Couldn't load team settings: ${(error as Error).message}`} onRetry={() => mutate()} />;
  if (!data || !value) return <div className="card p-5"><div className="h-24 rounded skeleton" /></div>;

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/team", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(body.error ?? `Save failed (${res.status})`, true);
        return;
      }
      notify("Saved. After-hours and weekend figures use the new workday on the next load.");
      setDraft(null);
      mutate();
    } finally {
      setSaving(false);
    }
  }

  const invalid = value.end <= value.start;
  return (
    <section aria-labelledby="team-settings-title" className="flex flex-col gap-4">
      <h2 id="team-settings-title" className="text-lg font-semibold text-fg">Team insights</h2>
      <div className="card p-5">
        <h3 className="text-[15px] font-semibold text-fg">Workday</h3>
        <p className="mt-1 text-[13px] text-muted max-w-2xl">
          Commits outside these hours count as after hours, and Saturday or Sunday in this time zone as weekend — on Team insights and on each repository&apos;s Team tab.
          {!data.configurable && " Organization mode with a database is needed to change it; the default applies."}
        </p>
        <form className="mt-4 grid gap-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label className="flex flex-col gap-1.5 text-[13px] text-fg">
            Time zone
            <select disabled={!data.configurable} value={value.timezone} onChange={(e) => setDraft({ ...value, timezone: e.target.value })} className={field}>
              {options.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-fg">
            Workday starts
            <select disabled={!data.configurable} value={value.start} onChange={(e) => setDraft({ ...value, start: Number(e.target.value) })} className={field}>
              {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{hh(h)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-fg">
            Workday ends
            <select disabled={!data.configurable} value={value.end} onChange={(e) => setDraft({ ...value, end: Number(e.target.value) })} className={field}>
              {HOURS.slice(1).map((h) => <option key={h} value={h}>{hh(h)}</option>)}
            </select>
          </label>
          <p className="sm:col-span-3 text-xs text-faint">
            Now: {formatWorkday(value)} · default {formatWorkday(data.defaults)}
            {invalid && <span className="text-status-fail-text"> · the workday must end after it starts</span>}
          </p>
          {data.configurable && (
            <div className="sm:col-span-3 flex items-center gap-3 flex-wrap">
              <Button type="submit" variant="primary" disabled={saving || draft === null || invalid}>{saving ? "Saving…" : "Save"}</Button>
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
