"use client";

/**
 * Settings → Access by group, Members and Audit log (`Settings` artboard,
 * contract §5 "Access matrix"). Native checkboxes in 44 px cells labelled
 * "{Group}: {Feature}"; the Admin column is checked and disabled.
 */

import { useState } from "react";
import Link from "next/link";
import { Lock, Search } from "lucide-react";
import { cn, formatRelative } from "@/lib/utils";
import { fetcher } from "@/lib/swr";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/Card";
import { Avatar } from "@/components/team/WorkloadList";
import { FEATURE_GROUPS, GROUP_LABEL, GROUP_ORDER } from "@/components/settings/feature-groups";
import { adminPut, useAdminUsers, useAudit, usePermissions, type AdminUser, type AuditEntry } from "@/components/settings/admin-api";

type Notify = (msg: string, error?: boolean) => void;

function SectionHead({ title, children, right }: { title: string; children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-6 flex-wrap mb-4">
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        {children && <div className="mt-1.5 text-sm leading-[22px] text-muted">{children}</div>}
      </div>
      {right && <div className="text-xs text-muted">{right}</div>}
    </div>
  );
}

export function AccessByGroup({ notify }: { notify: Notify }) {
  const perms = usePermissions();
  const users = useAdminUsers();
  const [saving, setSaving] = useState(0);
  const [failed, setFailed] = useState(false);

  const counts = new Map<string, number>();
  for (const u of users.data?.users ?? []) {
    const gs = new Set(u.groups);
    if (u.isBootstrapAdmin) gs.add("admin");
    for (const g of gs) counts.set(g, (counts.get(g) ?? 0) + 1);
  }

  async function toggle(group: string, flag: string, granted: boolean) {
    const data = perms.data;
    if (!data) return;
    const grants = { ...data.grants, [group]: granted ? [...(data.grants[group] ?? []), flag] : (data.grants[group] ?? []).filter((f) => f !== flag) };
    setSaving((n) => n + 1);
    setFailed(false);
    await perms.mutate({ ...data, grants }, { revalidate: false });
    const r = await adminPut("/api/admin/permissions", { group, flag, granted });
    setSaving((n) => n - 1);
    if (!r.ok) { setFailed(true); notify(r.error ?? "Couldn't save that change", true); }
    else notify(`${granted ? "Granted" : "Removed"} for ${GROUP_LABEL[group] ?? group} · applies to new requests within 60 seconds`);
    await perms.mutate();
  }

  const status = saving > 0 ? "Saving…" : failed ? <span className="text-status-fail-text">Last change failed</span> : "Saved · no unsaved changes";
  const groups = GROUP_ORDER.filter((g) => g === "admin" || perms.data?.groups.includes(g));

  return (
    <section aria-labelledby="access-title">
      <SectionHead title="Access by group" right={perms.data && status}>
        People see only the features their group grants. Anyone can hide a granted feature for themselves under My features. Changes save immediately and are recorded in the audit log.
      </SectionHead>
      <h2 id="access-title" className="sr-only">Access by group</h2>

      {perms.error && <ErrorBanner message="Couldn't load group permissions. The admin API may not be available on this deployment." onRetry={() => perms.mutate()} />}
      {perms.data && !perms.data.enforce && (
        <p className="mb-4 px-4 py-3 rounded-control bg-status-warn-tint text-[13px] text-status-warn-text">
          Enforcement is off, so everyone keeps full access until <span className="font-mono">GITDASH_RBAC_ENFORCE=true</span> is set. Grants you save now apply then.
        </p>
      )}

      {!perms.data && !perms.error && <div className="card h-[520px] skeleton" />}

      {perms.data && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <caption className="sr-only">Features granted to each group</caption>
            <thead className="bg-panel border-b border-line">
              <tr>
                <th scope="col" className="h-14 pl-5 text-left text-xs font-medium text-faint">Feature</th>
                {groups.map((g) => (
                  <th key={g} scope="col" className="w-[104px] px-2 text-center">
                    <span className="block text-sm font-semibold text-fg">{GROUP_LABEL[g] ?? g}</span>
                    <span className="block text-xs font-normal text-muted">{counts.get(g) ?? 0} {counts.get(g) === 1 ? "person" : "people"}</span>
                  </th>
                ))}
              </tr>
            </thead>
            {FEATURE_GROUPS.map((section) => (
              <tbody key={section.label}>
                <tr className="bg-panel/60 border-y border-line">
                  <th scope="rowgroup" colSpan={groups.length + 1} className="h-8 pl-5 text-left text-xs font-semibold text-muted">{section.label}</th>
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.key} className="border-b border-line last:border-0">
                    <th scope="row" className="py-2.5 pl-5 pr-4 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-fg">{row.name}</span>
                        {row.writes && <span className="inline-flex h-5 items-center px-1.5 rounded-chip bg-status-warn-tint text-xs font-medium text-status-warn-text">Writes to GitHub</span>}
                      </span>
                      <span className="block text-xs text-muted">{row.description}</span>
                    </th>
                    {groups.map((g) => {
                      const locked = g === "admin";
                      const on = locked || (perms.data!.grants[g] ?? []).includes(row.key);
                      return (
                        <td key={g} className="h-11 text-center">
                          <input
                            type="checkbox"
                            className={cn("w-[18px] h-[18px] align-middle", locked ? "cursor-not-allowed opacity-60" : "cursor-pointer")}
                            checked={on}
                            disabled={locked}
                            aria-label={`${GROUP_LABEL[g] ?? g}: ${row.name}`}
                            onChange={(e) => toggle(g, row.key, e.target.checked)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Admins always have every feature. Repositories and workflows are visible to every group.</p>

      <WaitingForAccess users={users.data?.users ?? []} loading={!users.data && !users.error} onChanged={() => users.mutate()} notify={notify} />
    </section>
  );
}

function WaitingForAccess({ users, loading, onChanged, notify }: { users: AdminUser[]; loading: boolean; onChanged: () => void; notify: Notify }) {
  const pending = users.filter((u) => u.groups.length === 0 && !u.isBootstrapAdmin);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  async function approve(u: AdminUser) {
    const g = choice[u.github_id];
    if (!g) return;
    setBusy(u.github_id);
    const r = await adminPut(`/api/admin/users/${u.github_id}/groups`, { groups: [g] });
    setBusy(null);
    if (!r.ok) notify(r.error ?? "Couldn't approve", true);
    else notify(`@${u.login} added to ${GROUP_LABEL[g] ?? g} · applies within 60 seconds`);
    onChanged();
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-fg">Waiting for access</h3>
        <Link href="/settings?section=members" className="text-[13px] font-medium text-link hover:text-violet-200">All {users.length} members →</Link>
      </div>
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-5"><div className="h-12 rounded skeleton" /></div>
        ) : pending.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">Nobody is waiting for access.</p>
        ) : (
          <ul>
            {pending.map((u) => (
              <li key={u.github_id} className="flex items-center gap-4 flex-wrap px-5 py-4 border-b border-line last:border-0">
                <Avatar login={u.login} src={u.avatar_url ?? undefined} />
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-medium text-fg">{u.login}</p>
                  <p className="font-mono text-xs text-muted">first seen {formatRelative(u.first_seen_at ?? u.last_seen_at)}</p>
                </div>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Group
                  <select
                    value={choice[u.github_id] ?? ""}
                    onChange={(e) => setChoice((c) => ({ ...c, [u.github_id]: e.target.value }))}
                    className="w-[180px] h-[38px] px-3 rounded-control bg-panel border border-control-strong text-sm text-fg focus:outline-none focus:border-brand-fg"
                  >
                    <option value="">Choose a group</option>
                    {GROUP_ORDER.filter((g) => g !== "admin").map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <span className="text-[13px] text-muted w-28">Asked {formatRelative(u.first_seen_at ?? u.last_seen_at)}</span>
                <Button variant="primary" onClick={() => approve(u)} disabled={!choice[u.github_id] || busy === u.github_id}>
                  {busy === u.github_id ? "Approving…" : "Approve"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function MembersSection({ notify }: { notify: Notify }) {
  const [q, setQ] = useState("");
  const { data, error, mutate } = useAdminUsers(q);

  async function toggle(u: AdminUser, g: string) {
    const next = u.groups.includes(g) ? u.groups.filter((x) => x !== g) : [...u.groups, g];
    await mutate({ users: (data?.users ?? []).map((x) => (x.github_id === u.github_id ? { ...x, groups: next } : x)) }, { revalidate: false });
    const r = await adminPut(`/api/admin/users/${u.github_id}/groups`, { groups: next });
    if (!r.ok) notify(r.error ?? "Couldn't update groups", true);
    else notify(`@${u.login}: ${next.length ? next.map((x) => GROUP_LABEL[x] ?? x).join(", ") : "no groups"} · applies within 60 seconds`);
    await mutate();
  }

  return (
    <section aria-labelledby="members-title">
      <SectionHead title="Members">People appear here after they first sign in. People without a group see a waiting page until an admin adds them.</SectionHead>
      <h2 id="members-title" className="sr-only">Members</h2>
      <div className="relative max-w-xs mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" aria-hidden="true" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by login"
          aria-label="Search members by login"
          className="w-full h-9 pl-9 pr-3 rounded-control bg-panel border border-control-strong text-[13px] text-fg placeholder:text-faint focus:outline-none focus:border-brand-fg"
        />
      </div>
      {error && <ErrorBanner message="Couldn't load members." onRetry={() => mutate()} />}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <caption className="sr-only">Members and their groups</caption>
          <thead className="bg-panel border-b border-line">
            <tr>
              <th scope="col" className="h-10 pl-5 text-left text-xs font-medium text-faint">Member</th>
              <th scope="col" className="h-10 px-3 text-left text-xs font-medium text-faint">Groups</th>
              <th scope="col" className="h-10 px-3 pr-5 text-left text-xs font-medium text-faint">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {(data?.users ?? []).map((u) => (
              <tr key={u.github_id} className="border-b border-line last:border-0">
                <td className="h-14 pl-5 pr-3">
                  <span className="flex items-center gap-3">
                    <Avatar login={u.login} src={u.avatar_url ?? undefined} />
                    <span className="font-mono text-sm text-fg">{u.login}</span>
                    {u.groups.length === 0 && !u.isBootstrapAdmin && (
                      <span className="inline-flex h-[22px] items-center px-2 rounded-chip bg-status-warn-tint text-xs font-semibold text-status-warn-text">Waiting</span>
                    )}
                  </span>
                </td>
                <td className="px-3">
                  <span className="flex flex-wrap gap-1.5" role="group" aria-label={`Groups for ${u.login}`}>
                    {GROUP_ORDER.map((g) => {
                      const locked = g === "admin" && u.isBootstrapAdmin;
                      const on = locked || u.groups.includes(g);
                      return (
                        <button
                          key={g}
                          type="button"
                          disabled={locked}
                          aria-pressed={on}
                          onClick={() => toggle(u, g)}
                          title={locked ? "Set by GITDASH_ADMIN_GITHUB_IDS; can't be removed here" : undefined}
                          className={cn(
                            "inline-flex items-center gap-1 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors duration-100",
                            on ? "bg-brand-soft border-brand-fg/60 text-violet-200" : "border-control text-muted hover:text-fg",
                            locked && "cursor-not-allowed",
                          )}
                        >
                          {locked && <Lock className="w-3 h-3" aria-hidden="true" />}
                          {GROUP_LABEL[g]}
                        </button>
                      );
                    })}
                  </span>
                </td>
                <td className="px-3 pr-5 text-[13px] text-muted whitespace-nowrap">{formatRelative(u.last_seen_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.users.length === 0 && <p className="px-5 py-5 text-sm text-muted">No members yet.</p>}
      </div>
    </section>
  );
}

const fmt = (v: unknown) => (Array.isArray(v) ? (v.length ? v.map((x) => GROUP_LABEL[String(x)] ?? String(x)).join(", ") : "none") : v === undefined || v === null ? "—" : String(v));
const ACTIONS: Record<string, string> = { group_grant: "Granted", group_revoke: "Removed", user_groups_set: "Set groups for" };

export function AuditSection() {
  const first = useAudit();
  const [more, setMore] = useState<AuditEntry[]>([]);
  const entries = [...(first.data?.entries ?? []), ...more];

  async function loadMore() {
    const last = entries[entries.length - 1];
    if (!last) return;
    const res = await fetcher<{ entries: AuditEntry[] }>(`/api/admin/audit?limit=50&before=${last.id}`);
    setMore((m) => [...m, ...res.entries]);
  }

  return (
    <section aria-labelledby="audit-title">
      <SectionHead title="Audit log">Every grant, removal and membership change, newest first.</SectionHead>
      <h2 id="audit-title" className="sr-only">Audit log</h2>
      {first.error && <ErrorBanner message="Couldn't load the audit log." onRetry={() => first.mutate()} />}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <caption className="sr-only">Permission changes</caption>
          <thead className="bg-panel border-b border-line">
            <tr>
              <th scope="col" className="h-10 pl-5 text-left text-xs font-medium text-faint">When</th>
              <th scope="col" className="h-10 px-3 text-left text-xs font-medium text-faint">Who</th>
              <th scope="col" className="h-10 px-3 text-left text-xs font-medium text-faint">Change</th>
              <th scope="col" className="h-10 px-3 pr-5 text-left text-xs font-medium text-faint">Before → after</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-line last:border-0 text-[13px]">
                <td className="h-12 pl-5 pr-3 text-muted whitespace-nowrap" title={e.created_at}>{formatRelative(e.created_at)}</td>
                <td className="px-3 font-mono text-fg">{e.actor_login ?? e.actor_github_id}</td>
                <td className="px-3 text-fg">{ACTIONS[e.action] ?? e.action.replace(/_/g, " ")} <span className="font-mono text-muted">{e.target}</span></td>
                <td className="px-3 pr-5 text-muted">{fmt(e.details?.before)} → <span className="text-fg">{fmt(e.details?.after)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {first.data && entries.length === 0 && <p className="px-5 py-5 text-sm text-muted">No permission changes yet.</p>}
      </div>
      {entries.length > 0 && entries.length % 50 === 0 && (
        <Button className="mt-4" onClick={loadMore}>Load more</Button>
      )}
    </section>
  );
}
