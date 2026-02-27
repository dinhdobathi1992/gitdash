"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const isLogin = path === "/login";
  const isSetup = path === "/setup";

  if (isLogin || isSetup) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Suspense fallback={<div className="w-60 min-h-screen bg-slate-900 border-r border-slate-800 shrink-0" />}>
        <Sidebar />
      </Suspense>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
