"use client";

/**
 * Top bar — design contract §4.1. Breadcrumb · ⌘K search · "Updated n min
 * ago" · refresh · alerts. Replaces per-page Refresh buttons. Below lg it
 * collapses to menu + current page + search + alerts.
 */

import Link from "next/link";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, Menu, RefreshCw, Search } from "lucide-react";
import { cn, formatRelative } from "@/lib/utils";
import { openCommandPalette } from "@/components/CommandPalette";
import { useLastLoadedAt, useRefreshAll } from "@/lib/swr";
import { useAlerts } from "@/lib/use-alerts";
import { crumbsFor, useCrumbVersion } from "@/lib/breadcrumbs";
import { useCurrentOrg } from "@/lib/current-org";
import { settingsSectionLabel } from "@/components/settings/sections";

function IconButton({ label, onClick, children, className }: { label: string; onClick?: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "relative flex items-center justify-center w-9 h-9 rounded-control border border-control bg-surface text-muted hover:text-fg hover:bg-raised transition-colors duration-100",
        className,
      )}
    >
      {children}
    </button>
  );
}

export default function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const path = usePathname();
  const params = useSearchParams();
  const org = useCurrentOrg();
  useCrumbVersion();
  const crumbs = crumbsFor(path, org, path === "/settings" ? settingsSectionLabel(params.get("section")) : null);
  const { firing, now } = useAlerts();
  const loadedAt = useLastLoadedAt();
  const refreshAll = useRefreshAll();
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    try { await refreshAll(); } finally { setRefreshing(false); }
  }

  const leaf = crumbs[crumbs.length - 1];

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 h-14 px-4 sm:px-6 lg:px-10 border-b border-line bg-ground/85 backdrop-blur-md">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open navigation"
        className="lg:hidden flex items-center justify-center w-9 h-9 -ml-1 rounded-control text-muted hover:text-fg hover:bg-surface"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Breadcrumb — full trail on desktop, leaf only when compact */}
      <nav aria-label="Breadcrumb" className="flex-1 min-w-0">
        <ol className="hidden lg:flex items-center gap-2 text-[13px] min-w-0">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={`${c.label}-${i}`} className="flex items-center gap-2 min-w-0">
                {i > 0 && <span aria-hidden="true" className="text-disabled">/</span>}
                {last || !c.href ? (
                  <span aria-current={last ? "page" : undefined} className={cn("truncate", last ? "text-fg font-medium" : "text-muted", c.mono && "font-mono")}>
                    {c.label}
                  </span>
                ) : (
                  <Link href={c.href} className={cn("truncate text-muted hover:text-fg", c.mono && "font-mono")}>
                    {c.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
        <p aria-current="page" className={cn("lg:hidden truncate text-sm font-medium text-fg", leaf?.mono && "font-mono")}>{leaf?.label}</p>
      </nav>

      <button
        type="button"
        onClick={openCommandPalette}
        className="hidden md:flex items-center gap-2.5 w-[340px] h-9 pl-3 pr-1.5 rounded-control border border-control bg-panel text-[13px] text-faint hover:text-muted hover:border-control-strong transition-colors duration-100"
      >
        <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left">Search repos, workflows, people</span>
        <kbd className="px-1.5 h-[22px] inline-flex items-center rounded-chip border border-control bg-surface font-mono text-xs text-muted">⌘K</kbd>
      </button>
      <IconButton label="Search" onClick={openCommandPalette} className="md:hidden">
        <Search className="w-4 h-4" />
      </IconButton>

      {loadedAt > 0 && (
        <span
          className="hidden xl:inline text-xs text-muted whitespace-nowrap"
          title="When this tab last received data. Server caches can be up to 15 minutes older; Refresh fetches straight from GitHub."
        >
          Updated {formatRelative(loadedAt, Math.max(now, loadedAt))}
        </span>
      )}
      <IconButton label="Refresh data" onClick={onRefresh} className="hidden sm:flex">
        <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
      </IconButton>

      {path !== "/alerts" && (
        <Link
          href="/alerts"
          aria-label={firing.length ? `Alerts, ${firing.length} firing` : "Alerts"}
          title="Alerts"
          className="relative flex items-center justify-center w-9 h-9 rounded-control border border-control bg-surface text-muted hover:text-fg hover:bg-raised transition-colors duration-100"
        >
          <Bell className="w-4 h-4" />
          {firing.length > 0 && (
            <span aria-hidden="true" className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-status-fail ring-2 ring-surface" />
          )}
        </Link>
      )}
    </header>
  );
}
