"use client";

/**
 * WorkspacePanel — 248px context panel that lives between PrimaryRail and main
 * content. Content is route-aware:
 *
 *  /                    → Workspace / Repositories: orgs, watchlist, account
 *  /repos/[o]/[r]*      → Repo context: repo nav (overview, workflows, audit,
 *                          security, team), account
 *  /docs, /settings     → Simple nav links + account
 *  all others           → Primary nav labels + account
 *
 * The panel uses deliberate stacked sections with no `flex-1` dead space.
 * Internal sections scroll independently when their content overflows.
 */

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  ChevronRight, ChevronDown, LogOut, Key, Pin,
  LayoutDashboard, GitBranch, Shield, Users, FileText,
  Zap, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { fetcher } from "@/lib/swr";
import type { GitHubOrg } from "@/lib/github";
// PRIMARY_NAV used by MobileNavDrawer and PrimaryRail; not needed here

// ── Orgs hook (re-exported so AppShell can use it too) ───────────────────────

export function useOrgs() {
  return useSWR<GitHubOrg[]>("/api/github/orgs", fetcher<GitHubOrg[]>);
}

// ── Watchlist (localStorage) ─────────────────────────────────────────────────

const WATCHLIST_KEY = "gitdash:watchlist";

function useWatchlistNames(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? "[]");
  } catch {
    return [];
  }
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title,
  children,
  scroll = false,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  scroll?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {title && (
        <p className="px-4 mb-1 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">
          {title}
        </p>
      )}
      <div className={cn("flex flex-col gap-0.5", scroll && "overflow-y-auto max-h-44 scrollbar-thin")}>
        {children}
      </div>
    </div>
  );
}

// ── Panel link item ───────────────────────────────────────────────────────────

function PanelLink({
  href,
  icon: Icon,
  label,
  active,
  muted,
}: {
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  muted?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 px-4 py-[7px] text-sm rounded-lg mx-1 transition-colors cursor-pointer",
        active
          ? "bg-slate-700/70 text-white font-medium"
          : muted
          ? "text-slate-600 hover:text-slate-300 hover:bg-slate-800/50"
          : "text-slate-400 hover:text-white hover:bg-slate-800/50",
      )}
    >
      {Icon && <Icon className={cn("w-3.5 h-3.5 shrink-0", active ? "text-violet-400" : "text-slate-500")} />}
      <span className="truncate">{label}</span>
    </Link>
  );
}

// ── Watchlist section ─────────────────────────────────────────────────────────

function WatchlistSection() {
  const pinned = useWatchlistNames();

  if (pinned.length === 0) {
    return (
      <p className="px-4 py-2 text-[11px] text-slate-700 italic">
        Pin repos with the bookmark icon on any row.
      </p>
    );
  }

  return (
    <>
      {pinned.slice(0, 6).map((fullName) => {
        const parts = fullName.split("/");
        const owner = parts[0];
        const name = parts.slice(1).join("/");
        return (
          <PanelLink
            key={fullName}
            href={`/repos/${owner}/${name}`}
            icon={Pin}
            label={name ?? fullName}
          />
        );
      })}
      {pinned.length > 6 && (
        <p className="px-5 text-[10px] text-slate-700 py-1">
          +{pinned.length - 6} more
        </p>
      )}
    </>
  );
}

// ── Account card ──────────────────────────────────────────────────────────────

function AccountCard() {
  const { user, mode } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  const isStandalone = mode === "standalone";

  return (
    <div className="border-t border-slate-800/80 mt-auto pt-3 pb-3 px-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-800/60 transition-colors text-left cursor-pointer"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={user.avatar_url}
          alt={user.login}
          width={28}
          height={28}
          className="w-7 h-7 rounded-full ring-1 ring-slate-700 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate leading-tight">
            {user.name ?? user.login}
          </p>
          <p className="text-[10px] text-slate-500 truncate font-mono">
            @{user.login}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "w-3 h-3 text-slate-600 transition-transform shrink-0",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="mt-0.5 mx-1 flex flex-col gap-0.5">
          {isStandalone ? (
            <button
              onClick={() => {
                fetch("/api/auth/logout", { method: "POST" })
                  // Deliberate hard reload on sign-out — clears the SWR cache.
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                  .finally(() => { window.location.href = "/setup"; });
              }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors w-full text-left cursor-pointer"
            >
              <Key className="w-3.5 h-3.5 shrink-0" />
              Change PAT
            </button>
          ) : (
            <button
              onClick={() => {
                fetch("/api/auth/logout", { method: "POST" })
                  // Deliberate hard reload on sign-out — clears the SWR cache.
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                  .finally(() => { window.location.href = "/login"; });
              }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors w-full text-left cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Route matchers ────────────────────────────────────────────────────────────

function parseRepoRoute(path: string): { owner: string; repo: string } | null {
  const m = path.match(/^\/repos\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

// ── Panel variants ────────────────────────────────────────────────────────────

/** Home / Repos panel */
function HomePanel() {
  const path = usePathname();
  const searchParams = useSearchParams();
  const { data: orgs } = useOrgs();

  return (
    <div className="flex flex-col flex-1 overflow-hidden gap-4 pt-1">
      {/* Workspace header */}
      <div className="px-4 pt-3">
        <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-0.5">Workspace</p>
        <p className="text-sm font-semibold text-white">Repositories</p>
      </div>

      <div className="w-full h-px bg-slate-800/60" />

      {/* Orgs section */}
      {orgs !== undefined && (
        <Section title="Organizations" scroll={orgs.length > 6}>
          {orgs.length === 0 ? (
            <p className="px-4 py-1 text-[11px] text-slate-700 italic">No organizations</p>
          ) : (
            orgs.map((org) => {
              const orgHref = `/?org=${org.login}`;
              const isActive = searchParams.get("org") === org.login;
              return (
                <Link
                  key={org.login}
                  href={orgHref}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 px-4 py-[7px] text-sm rounded-lg mx-1 transition-colors cursor-pointer",
                    isActive
                      ? "bg-slate-700/70 text-white font-medium"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/50",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={org.avatar_url}
                    alt={org.login}
                    width={18}
                    height={18}
                    className="w-[18px] h-[18px] rounded-md shrink-0"
                  />
                  <span className="truncate font-mono text-[12px]">{org.login}</span>
                  {isActive && <ChevronRight className="w-3 h-3 text-violet-400 ml-auto shrink-0" />}
                </Link>
              );
            })
          )}
        </Section>
      )}

      <div className="w-full h-px bg-slate-800/60" />

      {/* Watchlist */}
      <Section title="Watchlist">
        <WatchlistSection />
      </Section>

      <div className="w-full h-px bg-slate-800/60" />

      {/* Quick links */}
      <Section title="Quick links">
        <PanelLink href="/cost-analytics" icon={Zap}     label="Cost Analytics" active={path === "/cost-analytics"} />
        <PanelLink href="/alerts"          icon={BookOpen} label="Alerts"          active={path === "/alerts"} />
      </Section>
    </div>
  );
}

/** Repo detail panel */
function RepoPanel({ owner, repo }: { owner: string; repo: string }) {
  const path = usePathname();
  const base = `/repos/${owner}/${repo}`;

  const repoLinks = [
    { href: base,                   icon: LayoutDashboard, label: "Overview"   },
    { href: `${base}/workflows`,    icon: GitBranch,       label: "Workflows"  },
    { href: `${base}/audit`,        icon: FileText,        label: "Audit Log"  },
    { href: `${base}/security`,     icon: Shield,          label: "Security"   },
    { href: `${base}/team`,         icon: Users,           label: "Team"       },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden gap-4 pt-1">
      {/* Repo header */}
      <div className="px-4 pt-3">
        <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-0.5">Repository</p>
        <Link
          href={base}
          className="text-sm font-semibold text-white hover:text-violet-300 transition-colors font-mono truncate block"
        >
          <span className="text-slate-500 font-normal">{owner}/</span>
          {repo}
        </Link>
      </div>

      <div className="w-full h-px bg-slate-800/60" />

      <Section title="Navigation">
        {repoLinks.map(({ href, icon, label }) => {
          const active = path === href || (href !== base && path.startsWith(href));
          return (
            <PanelLink key={href} href={href} icon={icon} label={label} active={active} />
          );
        })}
      </Section>

      <div className="w-full h-px bg-slate-800/60" />

      <Section title="Watchlist">
        <WatchlistSection />
      </Section>
    </div>
  );
}

/**
 * SimplePanel — used for pages that have no real sub-navigation.
 * Shows the page title + watchlist (pinned repos are always useful)
 * + a back-to-repos link. No fake links.
 */
function SimplePanel({ title }: { title: string }) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden gap-4 pt-1">
      <div className="px-4 pt-3">
        <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-0.5">Workspace</p>
        <p className="text-sm font-semibold text-white">{title}</p>
      </div>

      <div className="w-full h-px bg-slate-800/60" />

      <Section title="Watchlist">
        <WatchlistSection />
      </Section>

      <div className="w-full h-px bg-slate-800/60" />

      <div className="px-2">
        <PanelLink href="/" icon={LayoutDashboard} label="Back to Repositories" />
      </div>
    </div>
  );
}

// ── WorkspacePanel ────────────────────────────────────────────────────────────

export default function WorkspacePanel() {
  const path = usePathname();
  const repoCtx = parseRepoRoute(path);

  // Pick panel based on current route
  function renderPanel() {
    if (path === "/" || path.startsWith("/?")) return <HomePanel />;
    if (repoCtx) return <RepoPanel owner={repoCtx.owner} repo={repoCtx.repo} />;
    // Pages without real sub-routes — show watchlist + back link only
    if (path.startsWith("/docs"))            return <SimplePanel title="Docs" />;
    if (path.startsWith("/settings"))        return <SimplePanel title="Settings" />;
    if (path.startsWith("/alerts"))          return <SimplePanel title="Alerts" />;
    if (path.startsWith("/reports"))         return <SimplePanel title="Reports" />;
    if (path.startsWith("/team"))            return <SimplePanel title="Team Insights" />;
    if (path.startsWith("/cost-analytics"))  return <SimplePanel title="Cost Analytics" />;
    return <HomePanel />;
  }

  return (
    <aside
      aria-label="Workspace panel"
      className="hidden md:flex flex-col w-[248px] min-h-screen shrink-0 bg-[#0d1117] border-r border-slate-800/50"
    >
      {renderPanel()}

      {/* Account card — always at the bottom, never floats mid-panel */}
      <AccountCard />
    </aside>
  );
}
