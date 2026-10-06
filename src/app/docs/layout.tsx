import type { Metadata } from "next";
import { DocsTopBar } from "@/components/docs/DocsTopBar";

export const metadata: Metadata = {
  title: { default: "GitDash Docs", template: "%s — GitDash Docs" },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <DocsTopBar />
      {children}
    </div>
  );
}
