"use client";

/**
 * Settings — `Settings` artboard, contract §9.
 * Sub-navigation (Organization: General, Access by group, Members, AI
 * provider, Email and digests, Audit log · You: My features, Notifications),
 * selected with ?section=. Visibility follows the permission model:
 * access/members/audit are organization-mode admin sections; AI and email
 * are deployment-wide (standalone, or admins in organization mode); a user
 * can switch off features granted to them, never switch on others.
 */

import { Suspense, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import EmailSettingsCard from "@/components/EmailSettingsCard";
import AiProviderCard from "@/components/AiProviderCard";
import { WorkingHabitsSettingsCard } from "@/components/settings/WorkingHabitsSettingsCard";
import { TeamSettingsCard } from "@/components/settings/TeamSettingsCard";
import { AccountLinksCard } from "@/components/settings/AccountLinksCard";
import { ConnectedAppsCard } from "@/components/settings/ConnectedAppsCard";
import { SETTINGS_SECTIONS } from "@/components/settings/sections";
import { FEATURE_GROUPS } from "@/components/settings/feature-groups";
import { AccessByGroup, MembersSection, AuditSection } from "@/components/settings/AccessSections";
import { useAdminUsers } from "@/components/settings/admin-api";
import { Page, PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { ErrorBanner } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { fetcher, FetchError } from "@/lib/swr";

// ── General: account and session ─────────────────────────────────────────────

function PatInlineForm({ login }: { login: string }) {
  const [editing, setEditing] = useState(false);
  const [newPat, setNewPat] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: newPat.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong."); return; }
      // The PAT just changed, so every cached response was fetched with the old
      // token. A hard reload discards that cache; router.push would keep it.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/settings";
    } catch {
      setError("Network error — could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[13px] text-muted max-w-xl">
          A personal access token is active for <span className="font-mono text-fg">@{login}</span>. It is kept in an encrypted, HTTP-only session cookie and never reaches the browser.
        </p>
        <div className="flex items-center gap-2">
          <Button onClick={() => setEditing(true)}>Replace token</Button>
          <Button
            onClick={() => {
              fetch("/api/auth/logout", { method: "POST" })
                // Full reload on sign-out is deliberate — it clears the SWR cache so the
                // previous session's data cannot render after logout.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                .finally(() => { window.location.href = "/setup"; });
            }}
          >
            Clear and sign out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleChange} className="flex items-center gap-2 flex-wrap">
      <label htmlFor="new-pat" className="sr-only">New personal access token</label>
      <div className="relative">
        <input
          id="new-pat"
          type={showToken ? "text" : "password"}
          value={newPat}
          onChange={(e) => setNewPat(e.target.value)}
          placeholder="ghp_… or github_pat_…"
          autoComplete="off"
          spellCheck={false}
          required
          className="w-72 h-9 pl-3 pr-9 rounded-control bg-panel border border-control-strong font-mono text-[13px] text-fg placeholder:text-faint focus:outline-none focus:border-brand-fg"
        />
        <button
          type="button"
          onClick={() => setShowToken((v) => !v)}
          aria-label={showToken ? "Hide token" : "Show token"}
          className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 text-faint hover:text-fg"
        >
          {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      <Button type="submit" variant="primary" disabled={loading || !newPat.trim()}>{loading ? "Checking…" : "Save"}</Button>
      <Button variant="ghost" onClick={() => { setEditing(false); setNewPat(""); setError(null); }}>Cancel</Button>
      {error && <p className="w-full text-[13px] text-status-fail-text">{error}</p>}
    </form>
  );
}

function GeneralSection() {
  const { user, mode, groups, isAdmin } = useAuth();
  const standalone = mode === "standalone";
  const shownGroups = isAdmin && !groups.includes("admin") ? ["admin", ...groups] : groups;
  return (
    <section aria-labelledby="general-title" className="flex flex-col gap-4">
      <h2 id="general-title" className="text-lg font-semibold text-fg">General</h2>
      <div className="card p-5">
        {user ? (
          <div className="flex items-center gap-4 flex-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={user.avatar_url} alt="" width={48} height={48} className="w-12 h-12 rounded-full bg-raised" />
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-fg">{user.name ?? user.login}</p>
              <p className="font-mono text-[13px] text-muted">@{user.login}{user.email ? ` · ${user.email}` : ""}</p>
            </div>
            <dl className="flex gap-6 text-[13px]">
              <div>
                <dt className="text-faint">Mode</dt>
                <dd className="text-fg">{standalone ? "Standalone" : "Organization"}</dd>
              </div>
              {!standalone && (
                <div>
                  <dt className="text-faint">Groups</dt>
                  <dd className="text-fg">{shownGroups.length ? shownGroups.join(", ") : "None yet"}</dd>
                </div>
              )}
            </dl>
          </div>
        ) : (
          <p className="text-sm text-muted">Not signed in.</p>
        )}
      </div>
      {user && (
        <div className="card p-5">
          <h3 className="text-[15px] font-semibold text-fg mb-3">Session</h3>
          {standalone ? (
            <PatInlineForm login={user.login} />
          ) : (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <p className="text-[13px] text-muted max-w-xl">Your GitHub session is kept in an encrypted, HTTP-only cookie and never reaches the browser.</p>
              <Button
                onClick={() => {
                  fetch("/api/auth/logout", { method: "POST" })
                    // Full reload on sign-out is deliberate — it clears the SWR cache.
                    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                    .finally(() => { window.location.href = "/login"; });
                }}
              >
                Sign out
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── You: My features, Notifications ──────────────────────────────────────────

function MyFeatures() {
  const { mode } = useAuth();
  const { preferences, granted, setFlag } = useFeatureFlags();
  const standalone = mode === "standalone";
  const grantedCount = FEATURE_GROUPS.flatMap((g) => g.rows).filter((r) => granted.has(r.key)).length;

  return (
    <section aria-labelledby="features-title" className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="max-w-2xl">
          <h2 id="features-title" className="text-lg font-semibold text-fg">My features</h2>
          <p className="mt-1.5 text-sm leading-[22px] text-muted">
            {standalone
              ? "Turn off what you don't use. Turned-off features skip their GitHub API calls entirely."
              : "Hide features your group grants that you don't use. Hidden features skip their API calls. Ask an admin for anything not granted."}
          </p>
        </div>
        {!standalone && grantedCount === 0 && <span className="text-[13px] text-status-warn-text">No features are granted to your groups yet.</span>}
      </div>
      <div className="card overflow-hidden">
        {FEATURE_GROUPS.map((section) => (
          <div key={section.label}>
            <p className="h-8 flex items-center px-5 bg-panel/60 border-y border-line first:border-t-0 text-xs font-semibold text-muted">{section.label}</p>
            <ul>
              {section.rows.map((row) => {
                const allowed = granted.has(row.key);
                const on = allowed && preferences[row.key];
                return (
                  <li key={row.key} className="flex items-center gap-4 px-5 py-3 border-b border-line last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className={cn("flex items-center gap-2 text-sm font-medium", allowed ? "text-fg" : "text-muted")}>
                        {row.name}
                        {row.writes && <span className="inline-flex h-5 items-center px-1.5 rounded-chip bg-status-warn-tint text-xs font-medium text-status-warn-text">Writes to GitHub</span>}
                      </p>
                      <p className="text-xs text-muted">{allowed ? row.description : "Not granted to your group"}</p>
                    </div>
                    <Switch
                      checked={on}
                      disabled={!allowed}
                      onChange={(v) => setFlag(row.key, v)}
                      label={`${on ? "Hide" : "Show"} ${row.name}`}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="text-xs text-faint">Saved to this browser straight away.</p>
    </section>
  );
}

function Notifications() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );
  return (
    <section aria-labelledby="notif-title" className="flex flex-col gap-4">
      <h2 id="notif-title" className="text-lg font-semibold text-fg">Notifications</h2>
      <div className="card p-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="max-w-xl">
          <p className="text-sm font-medium text-fg">Browser notifications</p>
          <p className="mt-1 text-[13px] text-muted">
            While a workflow page is open, GitDash can notify you when a new run fails.
            {permission === "denied" && " Notifications are blocked for this site in your browser settings."}
            {permission === "unsupported" && " This browser doesn't support notifications."}
          </p>
        </div>
        {permission === "granted" ? (
          <span className="text-[13px] font-medium text-status-pass-text">On</span>
        ) : (
          <Button disabled={permission !== "default"} onClick={async () => setPermission(await Notification.requestPermission())}>
            Turn on
          </Button>
        )}
      </div>
      <div className="card p-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="max-w-xl">
          <p className="text-sm font-medium text-fg">Alert rules</p>
          <p className="mt-1 text-[13px] text-muted">Thresholds that notify Slack, email or this browser are managed on the Alerts page.</p>
        </div>
        <Link href="/alerts" className="text-[13px] font-medium text-link hover:text-violet-200">Open Alerts →</Link>
      </div>
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function SettingsContent() {
  const { mode, isAdmin, resolvedMode } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const standalone = mode === "standalone";
  const orgAdmin = !standalone && isAdmin;
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null);
  const notify = (msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 4000);
  };
  const users = useAdminUsers("", orgAdmin);
  const pending = (users.data?.users ?? []).filter((u) => u.groups.length === 0 && !u.isBootstrapAdmin).length;

  // Same request (and SWR key) as the Connected apps card: a 404 means MCP is off here.
  const apps = useSWR(resolvedMode !== null ? "/api/mcp/grants" : null, fetcher, { dedupingInterval: 0, shouldRetryOnError: false });
  const mcpOff = resolvedMode === null || (apps.error instanceof FetchError && apps.error.status === 404);

  const visible = SETTINGS_SECTIONS.filter((s) => {
    if (s.key === "connected-apps") return !mcpOff;
    if (["access", "members", "audit", "working-habits", "team", "account-links"].includes(s.key)) return orgAdmin;
    if (s.key === "ai" || s.key === "email") return standalone || isAdmin;
    return true;
  });
  const requested = params.get("section");
  const active = visible.find((s) => s.key === requested)?.key ?? (orgAdmin ? "access" : "general");

  const meta = standalone
    ? "Standalone mode · your token, your dashboard"
    : orgAdmin
      ? "Organization mode · you're an admin, so you can change who sees what"
      : "Organization mode · your admin decides which features your group gets";

  return (
    <Page>
      <PageHeading title="Settings" meta={meta} />

      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)] items-start">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-20">
          {/* Phones: a select; larger screens: the sub-nav list. */}
          <label className="lg:hidden flex flex-col gap-1.5 text-xs text-muted">
            Section
            <select
              value={active}
              onChange={(e) => router.replace(`/settings?section=${e.target.value}`, { scroll: false })}
              className="h-11 px-3 rounded-control bg-panel border border-control-strong text-sm text-fg"
            >
              {visible.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <div className="hidden lg:flex flex-col gap-5">
            {(["Organization", "You"] as const).map((group) => {
              const items = visible.filter((s) => s.group === group);
              if (!items.length) return null;
              return (
                <div key={group} className="flex flex-col gap-0.5">
                  <span className="px-2.5 pb-1.5 text-xs font-medium text-faint">{group}</span>
                  {items.map((s) => (
                    <Link
                      key={s.key}
                      href={`/settings?section=${s.key}`}
                      replace
                      scroll={false}
                      aria-current={s.key === active ? "page" : undefined}
                      className={cn(
                        "flex items-center justify-between h-9 px-2.5 rounded-control text-sm transition-colors duration-100",
                        s.key === active ? "bg-raised text-fg font-medium" : "text-muted hover:text-fg hover:bg-surface",
                      )}
                    >
                      {s.label}
                      {s.key === "members" && pending > 0 && (
                        <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-status-warn-tint text-xs font-semibold text-status-warn-text" aria-label={`${pending} waiting`}>
                          {pending}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0">
          {active === "general" && <GeneralSection />}
          {active === "access" && <AccessByGroup notify={notify} />}
          {active === "members" && <MembersSection notify={notify} />}
          {active === "ai" && <AiProviderCard />}
          {active === "email" && <EmailSettingsCard />}
          {active === "audit" && <AuditSection />}
          {active === "working-habits" && <WorkingHabitsSettingsCard notify={notify} />}
          {active === "team" && <TeamSettingsCard notify={notify} />}
          {active === "account-links" && <AccountLinksCard notify={notify} />}
          {active === "features" && <MyFeatures />}
          {active === "connected-apps" && <ConnectedAppsCard />}
          {active === "notifications" && <Notifications />}
          {requested && !visible.some((s) => s.key === requested) && (
            <ErrorBanner className="mt-4" message="That section is only available to admins." />
          )}
        </div>
      </div>

      {toast && (
        <div role="status" className={cn("fixed bottom-20 sm:bottom-6 right-6 max-w-sm px-4 py-3 float-card text-sm", toast.error ? "text-status-fail-text" : "text-fg")}>
          {toast.msg}
        </div>
      )}
    </Page>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="px-10 pt-8 text-sm text-muted">Loading…</div>}>
      <SettingsContent />
    </Suspense>
  );
}
