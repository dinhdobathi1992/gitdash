"use client";

/**
 * Sidebar — design contract §4.1 and the `Sidebar` artboard.
 * Logo + version · org switcher · Monitor / Analyze groups · Pinned repos ·
 * Docs + Settings · GitHub API budget · user row.
 */

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { ChevronsUpDown, ChevronRight, LogOut, Key, X, Building2, User, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { fetcher } from "@/lib/swr";
import type { GitHubOrg, Repo, RepoSummary } from "@/lib/github";
import type { RateLimitStatus } from "@/app/api/github/rate-limit/route";
import { NAV_GROUPS, NAV_BOTTOM, isActive, visibleNav, type NavItem } from "@/components/shell/nav-config";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import { LogoMark, APP_VERSION } from "@/components/shell/Logo";
import { useWatchlist } from "@/lib/watchlist";
import { useAlerts } from "@/lib/use-alerts";
import { useCurrentOrg, rememberOrg, reposHref } from "@/lib/current-org";
import { repoHealth } from "@/lib/repo-health";

export function useOrgs() {
  return useSWR<GitHubOrg[]>("/api/github/orgs", fetcher<GitHubOrg[]>);
}

function initials(s: string): string {
  const parts = s.replace(/[^A-Za-z0-9 _-]/g, "").split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

// ── Org switcher ──────────────────────────────────────────────────────────────

function OrgSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const org = useCurrentOrg();
  const { data: orgs } = useOrgs();
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Repo count, read from the SWR cache the repositories page fills. No
  // fetcher is passed, so this never triggers a request of its own.
  const { data: repos } = useSWR<Repo[]>(org ? `/api/github/org-repos?org=${org}` : "/api/github/repos");

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const current = orgs?.find((o) => o.login === org);
  const label = org ?? "Personal";

  function select(next: string | null) {
    rememberOrg(next);
    setOpen(false);
    onNavigate?.();
    router.push(reposHref(next));
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Switch organization, current: ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 w-full h-12 px-2.5 rounded-[10px] border border-control bg-surface text-left hover:bg-raised transition-colors duration-100"
      >
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.avatar_url} alt="" width={28} height={28} className="w-7 h-7 rounded-[7px] shrink-0" />
        ) : (
          <span className="flex items-center justify-center w-7 h-7 shrink-0 rounded-[7px] bg-[#2A2350] text-[#C9B8FF] text-xs font-semibold">
            {org ? initials(org) : <User className="w-3.5 h-3.5" />}
          </span>
        )}
        <span className="flex flex-col flex-1 min-w-0">
          <span className="text-sm font-semibold text-fg truncate">{label}</span>
          <span className="text-xs text-[#8E95A1] truncate">
            {org ? "Org" : "Your repositories"}
            {repos ? ` · ${repos.length} repos` : ""}
          </span>
        </span>
        <ChevronsUpDown className="w-4 h-4 text-faint shrink-0" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 float-card py-1.5">
          <button
            type="button"
            onClick={() => select(null)}
            className="w-full flex items-center gap-2.5 px-3 h-9 text-sm text-muted hover:text-fg hover:bg-raised text-left"
          >
            <User className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">Personal repositories</span>
            {!org && <Check className="w-4 h-4 text-brand-fg" aria-label="Current" />}
          </button>
          {orgs && orgs.length > 0 && <div className="my-1 border-t border-line" />}
          {orgs?.map((o) => (
            <button
              key={o.login}
              type="button"
              onClick={() => select(o.login)}
              className="w-full flex items-center gap-2.5 px-3 h-9 text-sm text-muted hover:text-fg hover:bg-raised text-left"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={o.avatar_url} alt="" width={16} height={16} className="w-4 h-4 rounded-sm shrink-0" />
              <span className="flex-1 font-mono text-[13px] truncate">{o.login}</span>
              {org === o.login && <Check className="w-4 h-4 text-brand-fg" aria-label="Current" />}
            </button>
          ))}
          {orgs && orgs.length === 0 && (
            <p className="px-3 py-2 text-xs text-faint leading-relaxed">
              No organizations found. A token issued before the <code className="font-mono text-muted">read:org</code> scope
              sees none — sign in again, or type the org below.
            </p>
          )}
          <div className="my-1 border-t border-line" />
          {/* GitHub only lists orgs the token's scope can see; reaching one by
              name still works because the repo fetch checks real access. */}
          <form
            className="px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = manual.trim();
              if (v) { setManual(""); select(v); }
            }}
          >
            <label htmlFor="org-by-name" className="block text-xs text-faint mb-1.5">Go to an org by name</label>
            <div className="flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-faint shrink-0" aria-hidden="true" />
              <input
                id="org-by-name"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="org-name"
                className="flex-1 min-w-0 h-8 px-2 rounded-control bg-panel border border-control-strong text-[13px] font-mono text-fg placeholder:text-faint focus:outline-none focus:border-brand-fg"
              />
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

function NavLink({ item, path, onNavigate, firingCount, org }: {
  item: NavItem; path: string; onNavigate?: () => void; firingCount: number; org: string | null;
}) {
  const active = isActive(item.href, path);
  const Icon = item.icon;
  const href = item.href === "/" ? reposHref(org) : item.href;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 h-9 px-2.5 rounded-control text-sm font-medium transition-colors duration-100",
        active
          ? "bg-[linear-gradient(90deg,rgba(124,92,255,0.22)_0%,rgba(124,92,255,0.05)_100%)] text-fg"
          : "text-muted hover:text-fg hover:bg-surface",
      )}
    >
      <Icon className={cn("w-[18px] h-[18px] shrink-0", active ? "text-brand-fg" : "text-faint")} strokeWidth={1.75} aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      {item.badge === "alerts" && firingCount > 0 && (
        <span
          aria-label={`${firingCount} firing`}
          className="flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[rgba(255,107,107,0.16)] text-[#FF9C9C] text-xs font-semibold"
        >
          {firingCount}
        </span>
      )}
    </Link>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <span className="block px-2.5 pb-1.5 text-xs font-medium text-faint">{children}</span>;
}

// ── Pinned repositories ───────────────────────────────────────────────────────

function PinnedRepo({ fullName, onNavigate, path }: { fullName: string; onNavigate?: () => void; path: string }) {
  const [owner, ...rest] = fullName.split("/");
  const name = rest.join("/");
  const href = `/repos/${owner}/${name}`;
  // Same key as the repositories table, so a pinned repo's status is shared
  // with (and usually already loaded by) the home page.
  const { data } = useSWR<RepoSummary>(`/api/github/repo-summary?owner=${owner}&repo=${name}`, fetcher<RepoSummary>);
  const health = data ? repoHealth(data) : null;
  const active = path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 h-8 px-2.5 rounded-control font-mono text-[13px] transition-colors duration-100",
        active ? "bg-surface text-fg" : "text-muted hover:text-fg hover:bg-surface",
      )}
    >
      <span aria-hidden="true" className={cn("w-2 h-2 rounded-full shrink-0", health ? health.dot : "bg-status-neutral")} />
      <span className="flex-1 truncate">{name}</span>
      {health?.key === "failing" && <span className="font-sans text-xs text-[#FF9C9C]">Failing</span>}
      {health?.key === "running" && <span className="font-sans text-xs text-status-run-text">Running</span>}
    </Link>
  );
}

function PinnedSection({ onNavigate, path }: { onNavigate?: () => void; path: string }) {
  const { pinned } = useWatchlist();
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel>Pinned</GroupLabel>
      {pinned.length === 0 ? (
        <p className="px-2.5 text-xs text-faint leading-relaxed">Pin a repository with the star on its row.</p>
      ) : (
        pinned.slice(0, 8).map((r) => <PinnedRepo key={r} fullName={r} onNavigate={onNavigate} path={path} />)
      )}
    </div>
  );
}

// ── GitHub API budget ─────────────────────────────────────────────────────────
// GET /rate_limit never counts against the quota, so polling it is free.

function ApiBudget() {
  const { data } = useSWR<RateLimitStatus>("/api/github/rate-limit", fetcher<RateLimitStatus>, {
    refreshInterval: 60_000,
  });
  if (!data) return null;
  const { core } = data;
  const pct = core.limit > 0 ? core.remaining / core.limit : 1;
  const resetAt = new Date(core.reset * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const low = pct < 0.2;
  const critical = pct < 0.05;
  return (
    <div className="rounded-card border border-line bg-surface px-3 py-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">GitHub API budget</span>
        <span className={cn("font-mono font-semibold", critical ? "text-status-fail-text" : low ? "text-status-warn-text" : "text-fg")}>
          {Math.round(pct * 100)}%
        </span>
      </div>
      <div
        className="mt-2 h-1 rounded-full bg-control overflow-hidden"
        role="meter"
        aria-label="GitHub API budget remaining"
        aria-valuemin={0}
        aria-valuemax={core.limit}
        aria-valuenow={core.remaining}
      >
        <div
          className={cn("h-full rounded-full", critical ? "bg-status-fail" : low ? "bg-status-warn" : "bg-accent")}
          style={{ width: `${Math.max(2, pct * 100)}%` }}
        />
      </div>
      <p className={cn("mt-2 text-xs", low ? "text-status-warn-text" : "text-muted")}>
        <span className="font-mono">{core.remaining.toLocaleString()}</span> of{" "}
        <span className="font-mono">{core.limit.toLocaleString()}</span> left · resets {resetAt}
      </p>
      {low && <p className="mt-1 text-xs text-status-warn-text">Some views may fail until then.</p>}
    </div>
  );
}

// ── User row ──────────────────────────────────────────────────────────────────

const GROUP_NAMES: Record<string, string> = { admin: "Admin", devops: "DevOps", security: "Security", dev: "Developer", pm: "PM" };

function UserRow() {
  const { user, mode, groups, isAdmin } = useAuth();
  if (!user) return null;
  const standalone = mode === "standalone";
  // Role line: "Admin · DevOps" in organization mode, the login otherwise.
  const roles = [...new Set([...(isAdmin ? ["admin"] : []), ...groups])].map((g) => GROUP_NAMES[g] ?? g);
  const signOut = () => {
    fetch("/api/auth/logout", { method: "POST" })
      // Deliberate hard reload on sign-out — clears the SWR cache.
      .finally(() => { window.location.href = standalone ? "/setup" : "/login"; });
  };
  return (
    <div className="flex items-center gap-2.5 px-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={user.avatar_url} alt="" width={32} height={32} className="w-8 h-8 rounded-full shrink-0 bg-raised" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-fg truncate">{user.name ?? user.login}</p>
        <p className="text-xs text-muted truncate">
          {!standalone && roles.length ? roles.join(" · ") : <span className="font-mono">@{user.login}</span>}
        </p>
      </div>
      <button
        type="button"
        onClick={signOut}
        aria-label={standalone ? "Change personal access token" : "Sign out"}
        title={standalone ? "Change personal access token" : "Sign out"}
        className="flex items-center justify-center w-9 h-9 rounded-control text-faint hover:text-fg hover:bg-surface transition-colors duration-100"
      >
        {standalone ? <Key className="w-[18px] h-[18px]" /> : <LogOut className="w-[18px] h-[18px]" />}
      </button>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function Sidebar({ onClose }: { onClose?: () => void } = {}) {
  const path = usePathname();
  const org = useCurrentOrg();
  const { firing } = useAlerts();
  const { isAdmin, mode } = useAuth();
  const { granted } = useFeatureFlags();
  // Standalone has no roles: the single user administers their own instance,
  // but the org-mode admin console does not apply.
  const access = { isAdmin: mode !== "standalone" && isAdmin, granted };

  return (
    <nav aria-label="Primary" className="flex flex-col gap-[22px] w-full min-h-full bg-panel px-3 py-4 shadow-[inset_-1px_0_0_var(--border-subtle)]">
      <div className="flex items-center gap-2.5 px-1.5 py-1">
        <LogoMark />
        <span className="flex-1 text-[15px] font-semibold tracking-[-0.01em] text-fg">GitDash</span>
        <a
          href="https://github.com/dinhdobathi1992/gitdash/releases"
          target="_blank"
          rel="noopener noreferrer"
          title="Release notes"
          className="font-mono text-xs text-faint hover:text-link"
        >
          v{APP_VERSION}
        </a>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="flex items-center justify-center w-9 h-9 -mr-1 rounded-control text-muted hover:text-fg hover:bg-surface"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <OrgSwitcher onNavigate={onClose} />

      {NAV_GROUPS.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <GroupLabel>{g.label}</GroupLabel>
          {visibleNav(g.items, access).map((item) => (
            <NavLink key={item.href} item={item} path={path} onNavigate={onClose} firingCount={firing.length} org={org} />
          ))}
        </div>
      ))}

      <PinnedSection onNavigate={onClose} path={path} />

      <div className="flex-1" />

      <div className="flex flex-col gap-0.5">
        {visibleNav(NAV_BOTTOM, access).map((item) => (
          <NavLink key={item.href} item={item} path={path} onNavigate={onClose} firingCount={0} org={org} />
        ))}
      </div>

      <ApiBudget />
      <UserRow />
    </nav>
  );
}

// ── In-page breadcrumbs ───────────────────────────────────────────────────────
// Desktop shows breadcrumbs in the top bar (components/shell/TopBar.tsx), so
// these render below the lg breakpoint only, where the top bar is compact.

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="lg:hidden flex items-center gap-1 text-xs text-faint mb-4 flex-wrap">
      {items.map((item, i) => (
        <React.Fragment key={item.href ?? item.label}>
          {i > 0 && <ChevronRight className="w-3 h-3" aria-hidden="true" />}
          {item.href ? (
            <Link href={item.href} className="hover:text-fg">{item.label}</Link>
          ) : (
            <span aria-current="page" className="text-muted font-medium">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

export function RepoWorkflowBreadcrumb({
  owner, repo, workflowName,
}: { owner: string; repo: string; workflowName?: string }) {
  const items: { label: string; href?: string }[] = [
    { label: "Repositories", href: "/" },
    { label: repo, href: workflowName ? `/repos/${owner}/${repo}` : undefined },
  ];
  if (workflowName) items.push({ label: workflowName });
  return <Breadcrumb items={items} />;
}
