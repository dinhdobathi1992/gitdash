"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl text-center">
        <div className="flex justify-center mb-4">
          <span className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-6 h-6 text-red-400" />
          </span>
        </div>
        <h1 className="text-lg font-semibold text-white mb-2">Something went wrong</h1>
        <p className="text-sm text-slate-400 mb-6">
          {error.message ?? "An unexpected error occurred. You can try refreshing the page."}
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Try again
        </button>
      </div>
    </div>
  );
}
