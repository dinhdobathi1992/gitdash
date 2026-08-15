"use client";

/**
 * MobileNavDrawer — single full-height slide-in drawer used below `md`.
 *
 * Contains labeled nav items, org list, and account row.
 * Does NOT use the rail/panel split — that pattern is desktop-only.
 */

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  X, ChevronDown, LogOut, Key,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { PRIMARY_NAV } from "./nav-config";
import { useOrgs } from "./WorkspacePanel";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MobileNavDrawer({ open, onClose }: Props) {
  const path = usePathname();
  const searchParams = useSearchParams();
  const { user, mode } = useAuth();
  const { data: orgs } = useOrgs();
  const [accountOpen, setAccountOpen] = useState(false);
  const isStandalone = mode === "standalone";

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-72 flex flex-col bg-[#0d1117] border-r border-slate-800/60 transform transition-transform duration-200 ease-out md:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl overflow-hidden ring-1 ring-slate-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="GitDash" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-white text-sm tracking-tight">GitDash</span>
            <span
              className={cn(
                "text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-widest",
                isStandalone
                  ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                  : "bg-violet-500/10 text-violet-400 border border-violet-500/20",
              )}
            >
              {isStandalone ? "PAT" : "ORG"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto py-3 flex flex-col gap-4">
          {/* Primary nav */}
          <nav className="flex flex-col gap-0.5 px-2">
            {PRIMARY_NAV.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? path === "/" : path.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
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
            <div className="px-2">
              <p className="px-3 mb-1.5 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">
                Organizations
              </p>
              <div className="flex flex-col gap-0.5">
                {orgs.map((org) => {
                  const isActive = searchParams.get("org") === org.login;
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
                      <img
                        src={org.avatar_url}
                        alt={org.login}
                        width={20}
                        height={20}
                        className="w-5 h-5 rounded-md shrink-0"
                      />
                      <span className="truncate font-mono text-xs">{org.login}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Account row */}
        {user && (
          <div className="border-t border-slate-800/60 px-2 py-2">
            <button
              onClick={() => setAccountOpen((o) => !o)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-800/60 transition-colors text-left cursor-pointer"
              aria-expanded={accountOpen}
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
                <p className="text-xs font-semibold text-white truncate">{user.name ?? user.login}</p>
                <p className="text-[10px] text-slate-500 truncate font-mono">@{user.login}</p>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-slate-500 transition-transform shrink-0", accountOpen && "rotate-180")} />
            </button>

            {accountOpen && (
              <div className="mt-0.5 flex flex-col gap-0.5">
                {isStandalone ? (
                  <button
                    onClick={() => {
                      fetch("/api/auth/logout", { method: "POST" })
                        // Deliberate hard reload on sign-out — clears the SWR cache.
                        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                        .finally(() => { window.location.href = "/setup"; });
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors w-full text-left cursor-pointer"
                  >
                    <Key className="w-4 h-4 shrink-0" />
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
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors w-full text-left cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 shrink-0" />
                    Sign out
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
