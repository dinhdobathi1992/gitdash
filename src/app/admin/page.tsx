"use client";

import { useState } from "react";
import useSWR from "swr";
import { Users, ShieldCheck, History, Lock, AlertTriangle, Search, Plug } from "lucide-react";
import { Breadcrumb } from "@/components/Sidebar";
import { FetchError, fetcher } from "@/lib/swr";
import { ConnectedAppsCard } from "@/components/settings/ConnectedAppsCard";
import { FLAG_DEFS } from "@/lib/feature-flags";
import { cn } from "@/lib/utils";

// Kept in sync with src/lib/permissions.ts GROUPS (client bundle can't import server code).
const GROUPS = ["devops", "security", "dev", "pm", "admin"] as const;
type Group = (typeof GROUPS)[number];

interface AdminUser {
  github_id: number;
  login: string;
  avatar_url: string | null;
  last_seen_at: string;
  groups: string[];
  isBootstrapAdmin: boolean;
}
interface PermissionsResponse {
  groups: Group[];
  flags: string[];
  grants: Record<Group, string[]>;
  enforce: boolean;
}
interface AuditEntry {
  id: number;
  actor_login: string | null;
  actor_github_id: number;
  action: string;
  target: string;
  details: { before?: unknown; after?: unknown } | null;
  created_at: string;
}

type Tab = "users" | "permissions" | "audit" | "apps";

async function send(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true };
  const j = await res.json().catch(() => ({}));
  return { ok: false, error: (j as { error?: string }).error ?? `HTTP ${res.status}` };
}

const fmt = (v: unknown) => (Array.isArray(v) ? (v.length ? v.join(", ") : "—") : String(v));
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

// ── Users ────────────────────────────────────────────────────────────────────

function UsersTab({ notify }: { notify: (msg: string, error?: boolean) => void }) {
  const [q, setQ] = useState("");
  const key = `/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`;
  const { data, error, mutate } = useSWR<{ users: AdminUser[] }>(key, fetcher, { dedupingInterval: 0 });

  async function toggle(u: AdminUser, g: Group) {
    const next = u.groups.includes(g) ? u.groups.filter((x) => x !== g) : [...u.groups, g];
    const optimistic = { users: (data?.users ?? []).map((x) => (x.github_id === u.github_id ? { ...x, groups: next } : x)) };
    await mutate(optimistic, { revalidate: false });
    const r = await send(`/api/admin/users/${u.github_id}/groups`, { groups: next });
    if (!r.ok) notify(r.error ?? "Update failed", true);
    else notify(`@${u.login}: ${next.length ? next.join(", ") : "no groups"} · applies to new requests within 60s`);
    await mutate();
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by login"
          aria-label="Search users by login"
          className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
      </div>
      {error && <p className="text-sm text-red-400">Could not load users.</p>}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-700/50">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Groups</th>
              <th className="px-4 py-3 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {(data?.users ?? []).map((u) => (
              <tr key={u.github_id} className="border-b border-slate-800 last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {u.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.avatar_url} alt="" width={28} height={28} className="w-7 h-7 rounded-full" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-slate-700" />
                    )}
                    <span className="font-mono text-slate-200">@{u.login}</span>
                    {u.groups.length === 0 && !u.isBootstrapAdmin && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400">pending</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {GROUPS.map((g) => {
                      const locked = g === "admin" && u.isBootstrapAdmin;
                      const on = locked || u.groups.includes(g);
                      return (
                        <button
                          key={g}
                          type="button"
                          disabled={locked}
                          onClick={() => toggle(u, g)}
                          aria-pressed={on}
                          title={locked ? "Bootstrap admin (GITDASH_ADMIN_GITHUB_IDS)" : undefined}
                          className={cn(
                            "text-xs px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1",
                            on
                              ? "bg-violet-500/15 border-violet-500/40 text-violet-200"
                              : "bg-transparent border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600",
                            locked && "opacity-70 cursor-not-allowed",
                          )}
                        >
                          {locked && <Lock className="w-3 h-3" />}
                          {g}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{ago(u.last_seen_at)}</td>
              </tr>
            ))}
            {data && data.users.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                  No users yet. People appear here after they first sign in.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Permissions matrix ───────────────────────────────────────────────────────

function PermissionsTab({ notify }: { notify: (msg: string, error?: boolean) => void }) {
  const { data, error, mutate } = useSWR<PermissionsResponse>("/api/admin/permissions", fetcher, { dedupingInterval: 0 });

  async function toggle(group: Group, flag: string, granted: boolean) {
    if (!data) return;
    const grants = { ...data.grants, [group]: granted ? [...data.grants[group], flag] : data.grants[group].filter((f) => f !== flag) };
    await mutate({ ...data, grants }, { revalidate: false });
    const r = await send("/api/admin/permissions", { group, flag, granted });
    if (!r.ok) notify(r.error ?? "Update failed", true);
    else notify(`${granted ? "Granted" : "Revoked"} ${flag} for ${group} · applies to new requests within 60s`);
    await mutate();
  }

  if (error) return <p className="text-sm text-red-400">Could not load permissions.</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-4">
      {!data.enforce && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Enforcement is OFF. Everyone keeps today&apos;s access until{" "}
            <code className="text-amber-200">GITDASH_RBAC_ENFORCE=true</code> is set. Grants saved now apply then.
          </span>
        </div>
      )}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 border-b border-slate-700/50">
              <th className="px-4 py-3 text-left font-medium">Feature</th>
              {data.groups.map((g) => (
                <th key={g} className="px-3 py-3 font-medium text-center">{g}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FLAG_DEFS.map((def) => (
              <tr key={def.key} className="border-b border-slate-800 last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-200">{def.label}</span>
                    {def.writes && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-400">write</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{def.affects}</p>
                </td>
                {data.groups.map((g) => {
                  const on = data.grants[g]?.includes(def.key) ?? false;
                  const locked = g === "admin";
                  return (
                    <td key={g} className="px-3 py-3 text-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`${def.label} for ${g}`}
                        disabled={locked}
                        onClick={() => toggle(g, def.key, !on)}
                        className={cn(
                          "relative inline-flex h-5 w-9 items-center rounded-full border transition-colors",
                          on ? "bg-violet-600/80 border-violet-500" : "bg-slate-800 border-slate-600",
                          locked && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform", on ? "translate-x-4" : "translate-x-0.5")} />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Audit log ────────────────────────────────────────────────────────────────

function AuditTab() {
  const first = useSWR<{ entries: AuditEntry[] }>("/api/admin/audit?limit=50", fetcher, { dedupingInterval: 0 });
  const [more, setMore] = useState<AuditEntry[]>([]);
  const entries = [...(first.data?.entries ?? []), ...more];

  async function loadMore() {
    const last = entries[entries.length - 1];
    if (!last) return;
    const res = await fetcher<{ entries: AuditEntry[] }>(`/api/admin/audit?limit=50&before=${last.id}`);
    setMore((m) => [...m, ...res.entries]);
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-700/50">
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Change</th>
              <th className="px-4 py-3 font-medium">Before → after</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-slate-800 last:border-0">
                <td className="px-4 py-3 text-slate-400 whitespace-nowrap" title={e.created_at}>{ago(e.created_at)}</td>
                <td className="px-4 py-3 font-mono text-slate-300">@{e.actor_login ?? e.actor_github_id}</td>
                <td className="px-4 py-3 text-slate-200">
                  {e.action.replace(/_/g, " ")} <span className="font-mono text-slate-400">{e.target}</span>
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {fmt(e.details?.before)} → <span className="text-slate-200">{fmt(e.details?.after)}</span>
                </td>
              </tr>
            ))}
            {first.data && entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">No permission changes yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {entries.length > 0 && entries.length % 50 === 0 && (
        <button
          type="button"
          onClick={loadMore}
          className="text-sm px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
        >
          Load more
        </button>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null);
  const notify = (msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 4000);
  };

  // The grants API answers 404 when MCP is off; the tab then stays hidden.
  // Same key as the card's own request, so SWR shares one fetch.
  const apps = useSWR("/api/mcp/grants?all=1", fetcher, { dedupingInterval: 0, shouldRetryOnError: false });
  const mcpOff = apps.error instanceof FetchError && apps.error.status === 404;

  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: "users", label: "Users", icon: Users },
    { id: "permissions", label: "Permissions", icon: ShieldCheck },
    { id: "audit", label: "Audit", icon: History },
    ...(mcpOff ? [] : [{ id: "apps" as const, label: "Connected apps", icon: Plug }]),
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <Breadcrumb items={[{ label: "Repositories", href: "/" }, { label: "Admin" }]} />
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Admin</h1>
        <p className="text-sm text-slate-400">Who can see which GitDash features</p>
      </div>

      <div role="tablist" aria-label="Admin sections" className="flex gap-1 border-b border-slate-800">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors",
              tab === id ? "border-violet-500 text-white" : "border-transparent text-slate-400 hover:text-slate-200",
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab notify={notify} />}
      {tab === "permissions" && <PermissionsTab notify={notify} />}
      {tab === "audit" && <AuditTab />}
      {tab === "apps" && !mcpOff && <ConnectedAppsCard scope="all" />}

      {toast && (
        <div
          role="status"
          className={cn(
            "fixed bottom-6 right-6 max-w-sm px-4 py-3 rounded-lg border text-sm shadow-xl",
            toast.error ? "bg-red-950/90 border-red-500/40 text-red-200" : "bg-slate-900/95 border-slate-700 text-slate-200",
          )}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
