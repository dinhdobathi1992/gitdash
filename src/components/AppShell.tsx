"use client";

/**
 * App shell — design contract §4.1–4.2.
 *   ≥ 1024: fixed 232 px sidebar + top bar + centred content (max 1600).
 *   640–1023: sidebar becomes a slide-over drawer; top bar keeps search + alerts.
 *   < 640: compact top bar + bottom tab bar; "More" opens the drawer.
 * The footer is gone: the version lives in the sidebar, repo links in Docs.
 */

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import CommandPalette from "@/components/CommandPalette";
import TopBar from "@/components/shell/TopBar";
import MobileTabBar from "@/components/shell/MobileTabBar";

const FULL_PAGE_ROUTES = ["/login", "/setup", "/demo", "/pending"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  if (FULL_PAGE_ROUTES.some((r) => path === r || path.startsWith(r + "/"))) {
    return <>{children}</>;
  }

  return (
    <div className="flex items-stretch min-h-screen bg-ground">
      {/* Global ⌘K. Rendered inside the shell so it is absent from the
          full-page auth routes, where there is nothing to navigate to. */}
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>

      {/* Desktop sidebar — sticky, full viewport height, scrolls internally */}
      <div className="hidden lg:block w-[232px] shrink-0 bg-panel">
        <div className="sticky top-0 h-screen overflow-y-auto">
          <Suspense fallback={null}>
            <Sidebar />
          </Suspense>
        </div>
      </div>

      {/* Drawer (< 1024) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        className={[
          "fixed top-0 left-0 z-50 h-full w-[280px] overflow-y-auto bg-panel transform transition-transform duration-200 lg:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full invisible",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <Suspense fallback={null}>
          <Sidebar onClose={() => setDrawerOpen(false)} />
        </Suspense>
      </div>

      <div className="flex-1 flex flex-col min-w-0 page-glow">
        <Suspense fallback={<div className="h-14 border-b border-line" />}>
          <TopBar onOpenMenu={() => setDrawerOpen(true)} />
        </Suspense>

        {/* One centred content container for the whole app (v4.2.8): a
            generous cap because tables like the PR leaderboard are wide. */}
        <main className="flex-1 min-w-0">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>

      <Suspense fallback={null}>
        <MobileTabBar onMore={() => setDrawerOpen(true)} />
      </Suspense>
    </div>
  );
}
