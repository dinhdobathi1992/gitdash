"use client";

import { Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import CommandPalette from "@/components/CommandPalette";

const FULL_PAGE_ROUTES = ["/login", "/setup", "/demo"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (FULL_PAGE_ROUTES.some((r) => path === r || path.startsWith(r + "/"))) {
    return <>{children}</>;
  }

  return (
    // `items-stretch` makes all direct flex children fill the full row height
    <div className="flex items-stretch min-h-screen bg-[#0f1117]">

      {/* Global ⌘K. Rendered inside the shell so it is absent from the
          full-page auth routes, where there is nothing to navigate to. */}
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>


      {/* Desktop sidebar — sticky, full viewport height, scrolls internally */}
      <div className="hidden md:block md:w-60 shrink-0 bg-[#0d1117] border-r border-slate-800">
        <div className="sticky top-0 h-screen overflow-y-auto">
          <Suspense fallback={null}>
            <Sidebar />
          </Suspense>
        </div>
      </div>

      {/* Mobile backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile drawer */}
      <div
        className={[
          "fixed top-0 left-0 z-50 h-full w-72 transform transition-transform duration-200 md:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <Suspense fallback={null}>
          <Sidebar onClose={() => setDrawerOpen(false)} />
        </Suspense>
      </div>

      {/* Main content — scrolls independently */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 h-12 px-4 bg-[#0d1117]/95 border-b border-slate-800 backdrop-blur-sm md:hidden">
          <button
            onClick={() => setDrawerOpen((o) => !o)}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={drawerOpen}
          >
            {drawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <span className="font-semibold text-white text-sm tracking-tight">GitDash</span>
        </header>

        <main className="flex-1">{children}</main>

        {/* Footer — hidden on docs (it has its own) */}
        {!path.startsWith("/docs") && (
          <footer className="py-8 text-center">
            <p className="text-sm text-slate-600">
              GitDash v{process.env.NEXT_PUBLIC_APP_VERSION ?? "3.1.0"} — GitHub Actions Dashboard
            </p>
            <p className="text-sm text-slate-600 mt-1">
              <a
                href="https://github.com/dinhdobathi1992/gitdash"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-400 transition-colors"
              >
                Open source on GitHub
              </a>
              <span className="mx-1.5">·</span>
              <a
                href="https://github.com/dinhdobathi1992/gitdash/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-400 transition-colors"
              >
                Report an issue
              </a>
            </p>
          </footer>
        )}
      </div>
    </div>
  );
}
