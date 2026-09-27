"use client";

import { useEffect } from "react";

/** Route error boundary — failure-tint banner with a retry action (contract §10). */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console so it shows in Vercel function logs
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <div className="px-4 pt-8 sm:px-6 lg:px-10">
      <div role="alert" className="card p-6 max-w-2xl">
        <h1 className="text-lg font-semibold text-fg">This page hit an error</h1>
        <p className="mt-2 text-sm text-muted">{error.message || "Something unexpected went wrong. Try again, or reload the page."}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex items-center h-9 px-3.5 rounded-control bg-primary text-[13px] font-semibold text-white hover:brightness-110"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
