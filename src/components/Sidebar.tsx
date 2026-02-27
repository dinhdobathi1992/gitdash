"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  LayoutDashboard, Settings, GitBranch, Activity, ChevronRight,
  ChevronDown, LogOut, Key, Building2, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { fetcher } from "@/lib/swr";
import { GitHubOrg } from "@/lib/github";

const NAV = [
  { href: "/", label: "Repositories", icon: LayoutDashboard },
  { href: "/settings", label: "Settings", icon: Settings },
];

// ── Org switcher ──────────────────────────────────────────────────────────────
export function useOrgs() {
  return useSWR<GitHubOrg[]>("/api/github/orgs", fetcher<GitHubOrg[]>);
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export default function Sidebar() {
  const path = usePathname();
  const searchParams = useSearchParams();
  const { user, mode } = useAuth();
  const { data: orgs } = useOrgs();
  const [menuOpen, setMenuOpen] = useState(false);

  const isStandalone = mode === "standalone";

  return (
    <aside className="flex flex-col w-60 min-h-screen bg-slate-900 border-r border-slate-800 py-6 px-3 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3 mb-8">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
          <Activity className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-white tracking-tight">GitDash</span>
          <span className={cn(
            "ml-2 text-[10px] px-1.5 py-0.5 rounded font-medium",
            isStandalone
              ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
              : "bg-violet-500/15 text-violet-400 border border-violet-500/20"
          )}>
            {isStandalone ? "standalone" : "organization"}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = path === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white hover:bg-slate-800/60"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Org switcher */}
      {orgs && orgs.length > 0 && (
        <div className="mt-6">
          <p className="px-3 mb-1.5 text-xs font-medium text-slate-600 uppercase tracking-wider">Organizations</p>
          <div className="flex flex-col gap-0.5">
            {orgs.map((org) => (
              <Link
                key={org.login}
                href={`/?org=${org.login}`}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                  path === "/" && searchParams.get("org") === org.login
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={org.avatar_url} alt={org.login} width={20} height={20} className="w-5 h-5 rounded-md shrink-0" />
                <span className="truncate font-mono text-xs">{org.login}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* User section */}
      {user && (
        <div className="border-t border-slate-800 pt-4">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-800/60 transition-colors text-left"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={user.avatar_url} alt={user.login} width={28} height={28} className="w-7 h-7 rounded-full shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">{user.name ?? user.login}</p>
              <p className="text-xs text-slate-500 truncate">@{user.login}</p>
            </div>
            <ChevronDown className={cn("w-3.5 h-3.5 text-slate-500 transition-transform", menuOpen && "rotate-180")} />
          </button>

          {menuOpen && (
            <div className="mt-1 flex flex-col gap-0.5">
              {isStandalone ? (
                // Standalone: change PAT — POST to avoid logout CSRF
                <button
                  onClick={() => {
                    fetch("/api/auth/logout", { method: "POST" }).then(() => {
                      window.location.href = "/setup";
                    }).catch(() => {
                      window.location.href = "/setup";
                    });
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors w-full text-left"
                >
                  <Key className="w-4 h-4 shrink-0" />
                  Change PAT
                </button>
              ) : (
                // Organization: sign out — POST to avoid logout CSRF
                <button
                  onClick={() => {
                    fetch("/api/auth/logout", { method: "POST" }).then(() => {
                      window.location.href = "/login";
                    }).catch(() => {
                      window.location.href = "/login";
                    });
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

// ── Breadcrumb components ─────────────────────────────────────────────────────
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="flex items-center gap-1 text-sm text-slate-400 mb-6">
      {items.map((item, i) => (
        <React.Fragment key={item.href ?? item.label}>
          {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-600" />}
          {item.href ? (
            <Link href={item.href} className="hover:text-white transition-colors">{item.label}</Link>
          ) : (
            <span className="text-slate-200">{item.label}</span>
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

// ── Org / Personal tab badge ──────────────────────────────────────────────────
export function OrgBadge({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 font-mono">
      {avatarUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={avatarUrl} alt={name} width={14} height={14} className="w-3.5 h-3.5 rounded-sm" />
        : <Building2 className="w-3 h-3" />}
      {name}
    </span>
  );
}

export function PersonalBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-700/50 border border-slate-600/50 text-xs text-slate-300">
      <User className="w-3 h-3" />
      Personal
    </span>
  );
}
