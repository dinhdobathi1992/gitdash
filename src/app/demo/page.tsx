"use client";

/**
 * /demo — Demo mode landing page.
 *
 * Redirects the user to the main dashboard with ?demo=1 appended,
 * so all pages can read the demo flag from URL params.
 * Also accepts a `?tour=1` param to trigger the in-app walkthrough.
 */

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogoMark } from "@/components/shell/Logo";

export default function DemoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tour = searchParams.get("tour") === "1";

  useEffect(() => {
    const target = tour ? "/?demo=1&tour=1" : "/?demo=1";
    const timer = setTimeout(() => router.replace(target), 1200);
    return () => clearTimeout(timer);
  }, [router, tour]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-ground page-glow" aria-busy="true">
      <div className="text-center space-y-5">
        <div className="flex items-center justify-center gap-3">
          <LogoMark size={40} />
          <span className="text-2xl font-semibold text-fg tracking-tight">GitDash demo</span>
        </div>

        <p className="text-muted text-sm max-w-xs">
          Loading demo environment with sample data. No GitHub credentials required.
        </p>

        <div className="flex justify-center gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-brand-fg animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
