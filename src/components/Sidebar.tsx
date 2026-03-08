"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  LayoutDashboard, Settings, GitBranch, ChevronRight,
  ChevronDown, LogOut, Key, DollarSign, BarChart3, Bell, BookOpen, Users, X,
  Pin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { fetcher } from "@/lib/swr";
import { GitHubOrg } from "@/lib/github";

const NAV = [
  { href: "/",               label: "Repositories",   icon: LayoutDashboard },
  { href: "/team",           label: "Team Insights",  icon: Users },
  { href: "/cost-analytics", label: "Cost Analytics", icon: DollarSign },
  { href: "/reports",        label: "Reports",        icon: BarChart3 },
  { href: "/alerts",         label: "Alerts",         icon: Bell },
  { href: "/docs",           label: "Docs",           icon: BookOpen },
  { href: "/settings",       label: "Settings",       icon: Settings },
];

export function useOrgs() {
  return useSWR<GitHubOrg[]>("/api/github/orgs", fetcher<GitHubOrg[]>);
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

const WATCHLIST_KEY = "gitdash:watchlist";
const EMPTY_PINNED: string[] = [];

function WatchlistSection({ onClose }: { onClose?: () => void }) {
  const [pinned, setPinned] = useState<string[]>(EMPTY_PINNED);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? "[]") as string[];
      if (stored.length > 0) setPinned(stored);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-5">
      <p className="px-3 mb-1 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">
        Watchlist
      </p>
      {pinned.length === 0 ? (
        <p className="px-3 py-1.5 text-[11px] text-slate-700 italic leading-snug">
          Pin repos with the bookmark icon on any row.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {pinned.slice(0, 8).map((fullName) => {
            const [owner, ...rest] = fullName.split("/");
            const name = rest.join("/");
            return (
              <Link
                key={fullName}
                href={`/repos/${owner}/${name}`}
                onClick={onClose}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer truncate"
              >
                <Pin className="w-3 h-3 text-slate-600 shrink-0" />
                <span className="font-mono truncate">{name}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ onClose }: { onClose?: () => void } = {}) {
  const path = usePathname();
  const searchParams = useSearchParams();
  const { user, mode } = useAuth();
  const { data: orgs } = useOrgs();
  const [menuOpen, setMenuOpen] = useState(false);
  const isStandalone = mode === "standalone";

  return (
    <aside className="flex flex-col w-full h-full bg-[#0d1117] py-4 px-3">

      {/* Mobile close */}
      {onClose && (
        <div className="flex justify-end mb-2 md:hidden">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Logo */}
      <div className="flex items-center gap-2.5 px-1 mb-1">
        <div className="w-8 h-8 shrink-0 rounded-xl overflow-hidden shadow-lg shadow-violet-500/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="GitDash" className="w-full h-full object-cover" />
        </div>
        <span className="font-bold text-white tracking-tight text-sm">GitDash</span>
        <span className={cn(
          "text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider border",
          isStandalone
            ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
            : "bg-violet-500/10 text-violet-400 border-violet-500/20",
        )}>
          {isStandalone ? "standalone" : "org"}
        </span>
      </div>

      {/* Version */}
      <div className="px-1 mb-5">
        <a
          href="https://github.com/dinhdobathi1992/gitdash/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/15 transition-colors"
        >
          <span className="text-xs font-bold text-violet-300 font-mono">
            v{process.env.NEXT_PUBLIC_APP_VERSION ?? "3.1.0"}
          </span>
          <span className="text-[10px] text-violet-500 group-hover:text-violet-400 transition-colors">
            Release Notes ↗
          </span>
        </a>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/60",
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Orgs */}
      {orgs && orgs.length > 0 && (
        <div className="mt-5">
          <p className="px-3 mb-1 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">
            Organizations
          </p>
          <div className="flex flex-col gap-0.5">
            {orgs.map((org) => {
              const isActive =
                path === `/org/${org.login}` ||
                (path === "/" && searchParams.get("org") === org.login);
              return (
                <Link
                  key={org.login}
                  href={`/?org=${org.login}`}
                  onClick={onClose}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer",
                    isActive
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/60",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={org.avatar_url} alt={org.login} width={20} height={20} className="w-5 h-5 rounded-md shrink-0" />
                  <span className="truncate font-mono text-xs">{org.login}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Watchlist — fills dead space with real content */}
      <WatchlistSection onClose={onClose} />

      {/* Spacer pushes account to bottom */}
      <div className="flex-1" />

      {/* Account — pinned to bottom with border, no floating gap */}
      {user && (
        <div className="border-t border-slate-800 pt-3 mt-3">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-800/60 transition-colors text-left"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={user.avatar_url} alt={user.login} width={28} height={28} className="w-7 h-7 rounded-full shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate">{user.name ?? user.login}</p>
              <p className="text-xs text-slate-500 truncate font-mono">@{user.login}</p>
            </div>
            <ChevronDown className={cn("w-3.5 h-3.5 text-slate-500 transition-transform shrink-0", menuOpen && "rotate-180")} />
          </button>

          {menuOpen && (
            <div className="mt-1 flex flex-col gap-0.5">
              {isStandalone ? (
                <button
                  onClick={() => {
                    fetch("/api/auth/logout", { method: "POST" })
                      .finally(() => { window.location.href = "/setup"; });
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors w-full text-left"
                >
                  <Key className="w-4 h-4 shrink-0" />
                  Change PAT
                </button>
              ) : (
                <button
                  onClick={() => {
                    fetch("/api/auth/logout", { method: "POST" })
                      .finally(() => { window.location.href = "/login"; });
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors w-full text-left"
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                  Sign out
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="flex items-center gap-1 text-xs text-slate-500 mb-4">
      {items.map((item, i) => (
        <React.Fragment key={item.href ?? item.label}>
          {i > 0 && <ChevronRight className="w-3 h-3 text-slate-700" />}
          {item.href ? (
            <Link href={item.href} className="hover:text-slate-300 transition-colors">{item.label}</Link>
          ) : (
            <span className="text-slate-300 font-medium">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

export function RepoWorkflowBreadcrumb({
  owner, repo, workflowName,
}: { owner: string; repo: string; workflowName?: string }) {
  return (
    <div className="flex items-center gap-1 text-sm text-slate-400 mb-6 flex-wrap">
      <Link href="/" className="hover:text-white transition-colors flex items-center gap-1">
        <GitBranch className="w-3.5 h-3.5" /> Repos
      </Link>
      <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
      <Link href={`/repos/${owner}/${repo}`} className="hover:text-white transition-colors font-mono">
        {owner}/{repo}
      </Link>
      {workflowName && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
          <span className="text-slate-200">{workflowName}</span>
        </>
      )}
    </div>
  );
}
