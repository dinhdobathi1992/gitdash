"use client";

/**
 * Docs sidebar, search and mobile menu around a server-rendered docs page.
 * Every entry is a real link (/docs/<id>), so pages are shareable, crawlable
 * and work with back/forward.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BookOpen, ChevronDown, ChevronRight, ExternalLink, FlaskConical, Menu, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/components/shell/Logo";
import { DocSearch } from "@/components/docs/DocSearch";
import { NAV, HOME_SECTION, docHref } from "@/app/docs/_parts/nav";

function activeId(pathname: string): string {
  const slug = pathname.replace(/^\/docs\/?/, "").split("/")[0];
  return slug || HOME_SECTION;
}

function DocSidebar({ active, onSearchOpen, onNavigate }: {
  active: string;
  onSearchOpen: () => void;
  onNavigate: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-4 border-b border-slate-800">
        <BookOpen className="w-4 h-4 text-violet-400" aria-hidden="true" />
        <span className="text-sm font-semibold text-white">GitDash Docs</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/20 font-mono">
          v{APP_VERSION}
        </span>
      </div>

      <div className="px-3 py-3 border-b border-slate-800">
        <button
          onClick={onSearchOpen}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 text-sm hover:border-violet-500/40 hover:text-white transition-colors"
        >
          <Search className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="flex-1 text-left">Search docs...</span>
          <kbd className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-500 font-mono">⌘K</kbd>
        </button>
        <Link
          href="/docs/playground"
          onClick={onNavigate}
          className="mt-2 w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-300 text-sm hover:border-violet-500/40 hover:text-white transition-colors"
        >
          <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="flex-1 text-left">GitHub API playground</span>
          <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>

      <nav aria-label="Docs pages" className="flex-1 overflow-y-auto py-3 px-2">
        {NAV.map((section) => {
          const isCollapsed = collapsed[section.title];
          return (
            <div key={section.title} className="mb-1">
              <button
                onClick={() => setCollapsed((prev) => ({ ...prev, [section.title]: !prev[section.title] }))}
                aria-expanded={!isCollapsed}
                className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-300 transition-colors"
              >
                {section.title}
                <ChevronDown className={cn("w-3 h-3 transition-transform", isCollapsed && "-rotate-90")} aria-hidden="true" />
              </button>
              {!isCollapsed && (
                <ul className="mt-0.5 space-y-0.5">
                  {section.items.map(({ id, label, icon: Icon, sub }) => (
                    <li key={id}>
                      <Link
                        href={docHref(id)}
                        onClick={onNavigate}
                        aria-current={active === id ? "page" : undefined}
                        className={cn(
                          "w-full flex items-center gap-2 rounded-lg text-left transition-colors",
                          sub ? "pl-7 pr-3 py-1.5 text-xs" : "px-3 py-2 text-sm",
                          active === id
                            ? "bg-violet-500/15 text-violet-300 border border-violet-500/20"
                            : sub
                              ? "text-slate-500 hover:text-slate-200 hover:bg-slate-800/40"
                              : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                        )}
                      >
                        <Icon className={cn("shrink-0", sub ? "w-3 h-3" : "w-3.5 h-3.5")} aria-hidden="true" />
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-slate-800 space-y-1">
        <a
          href="https://github.com/dinhdobathi1992/gitdash"
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-6 items-center gap-2 text-xs text-slate-500 hover:text-white transition-colors"
        >
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
          GitHub Repository
        </a>
        <a
          href="https://github.com/dinhdobathi1992/gitdash/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-6 items-center gap-2 text-xs text-slate-500 hover:text-white transition-colors"
        >
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
          Report an Issue
        </a>
      </div>
    </div>
  );
}

export function DocsFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeId(pathname);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // ⌘K / Ctrl+K opens search; Escape closes the mobile menu.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const sidebar = (
    <DocSidebar active={active} onSearchOpen={() => setSearchOpen(true)} onNavigate={() => setMobileOpen(false)} />
  );

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)]">
      <aside className="hidden lg:flex flex-col w-64 shrink-0 sticky top-0 h-screen border-r border-slate-800 bg-slate-950/80">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Docs navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside className="relative w-72 max-w-[85vw] h-full bg-slate-950 border-r border-slate-800 flex flex-col">
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close docs navigation"
              className="absolute top-3 right-3 w-8 h-8 inline-flex items-center justify-center text-slate-500 hover:text-white"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-2 px-2 h-12 bg-slate-950/90 backdrop-blur-sm border-b border-slate-800">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open docs navigation"
            className="w-10 h-10 inline-flex items-center justify-center text-slate-400 hover:text-white"
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
          <span className="text-sm font-semibold text-white truncate">GitDash Docs</span>
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search docs"
            className="ml-auto w-10 h-10 inline-flex items-center justify-center text-slate-400 hover:text-white"
          >
            <Search className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {children}
      </div>

      <DocSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(id) => { setSearchOpen(false); router.push(docHref(id)); }}
      />
    </div>
  );
}
