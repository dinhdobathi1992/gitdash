"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Activity } from "lucide-react";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You cancelled the GitHub sign-in.",
  config: "Server is missing OAuth credentials. Contact your admin.",
  token_exchange: "Failed to exchange code for a token. Try again.",
  state_mismatch: "Sign-in state mismatch. Please try again (possible CSRF attempt).",
  state_expired: "Sign-in session expired. Please try signing in again.",
  server: "An unexpected server error occurred. Try again.",
};

function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      {/* background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-violet-600/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 shrink-0 rounded-2xl overflow-hidden shadow-2xl shadow-violet-500/30 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="GitDash Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">GitDash</h1>
          <p className="text-sm text-slate-400 mt-1">GitHub Actions Dashboard</p>
        </div>

        {/* card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-1 text-center">Sign in</h2>
          <p className="text-sm text-slate-400 text-center mb-8">
            Connect your GitHub account to view your org&apos;s workflow metrics
          </p>

          {error && (
            <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm text-center">
              {ERROR_MESSAGES[error] ?? "Something went wrong. Try again."}
            </div>
          )}

          <a
            href="/api/auth/login"
            className="flex items-center justify-center gap-3 w-full px-5 py-3 bg-white hover:bg-slate-100 text-slate-900 font-semibold rounded-xl text-sm transition-colors shadow-lg"
          >
            {/* GitHub SVG mark */}
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            Continue with GitHub
          </a>

          <p className="text-xs text-slate-500 text-center mt-6 leading-relaxed">
            GitDash requests{" "}
            <code className="text-slate-400 bg-slate-800 px-1 rounded">read:user</code>,{" "}
            <code className="text-slate-400 bg-slate-800 px-1 rounded">repo</code>,{" "}
            <code className="text-slate-400 bg-slate-800 px-1 rounded">workflow</code> and{" "}
            <code className="text-slate-400 bg-slate-800 px-1 rounded">read:org</code> scopes.
            Your token is stored in an encrypted server-side session and never exposed to the browser.
          </p>
        </div>

        <p className="text-xs text-slate-600 text-center mt-6">
          For internal use only — self-hosted GitHub Actions dashboard
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LoginContent />
    </Suspense>
  );
}
