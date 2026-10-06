"use client";

/** Sign in (organization mode) — `Login` artboard. */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { PatForm } from "@/components/PatForm";
import { AuthLayout } from "@/components/auth/AuthLayout";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You cancelled the GitHub sign-in.",
  config: "Server is missing OAuth credentials. Contact your admin.",
  token_exchange: "Failed to exchange code for a token. Try again.",
  state_mismatch: "Sign-in state mismatch. Please try again (possible CSRF attempt).",
  state_expired: "Sign-in session expired. Please try signing in again.",
  server: "An unexpected server error occurred. Try again.",
  org_not_allowed:
    "This GitHub account is not a member of an organization allowed to use this GitDash, or the sign-in lacks read:org.",
};

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-fg">{children}</code>;
}

function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");

  return (
    <AuthLayout>
      <p className="text-[13px] font-semibold text-link">Welcome back</p>
      <h2 className="mt-2 text-[28px] leading-[34px] font-semibold tracking-[-0.02em] text-fg">Sign in to GitDash</h2>
      <p className="mt-3 text-sm leading-[22px] text-muted">
        Use your GitHub account. Your organization&apos;s admin decides which dashboards you can see.
      </p>

      {error && (
        <p role="alert" className="mt-5 px-3.5 py-3 rounded-control bg-status-fail-tint border border-status-fail/25 text-[13px] text-status-fail-text">
          {ERROR_MESSAGES[error] ?? "Something went wrong. Try again."}
        </p>
      )}

      <a
        href="/api/auth/login"
        className="mt-6 flex items-center justify-center gap-2.5 w-full h-12 rounded-[12px] bg-primary text-white text-[15px] font-semibold hover:brightness-110 transition-[filter] duration-100"
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
        Continue with GitHub
      </a>

      <div className="flex items-center gap-3 my-7" aria-hidden="true">
        <div className="h-px flex-1 bg-line" />
        <span className="text-xs text-muted">or use a personal access token</span>
        <div className="h-px flex-1 bg-line" />
      </div>

      <PatForm>
        <p className="text-xs leading-[18px] text-muted">
          Needs <Code>repo</Code>, <Code>workflow</Code>, <Code>read:org</Code>, <Code>read:user</Code> and <Code>user:email</Code> — a
          fine-grained token needs org Members: read. The server keeps it only in your encrypted session cookie.
        </p>
      </PatForm>

      <p className="mt-6 text-xs leading-[18px] text-faint">
        Cost needs a separate fine-grained token with the Administration organization permission. <Link href="/docs" className="text-link hover:text-violet-200">Documentation</Link>
      </p>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-ground" />}>
      <LoginContent />
    </Suspense>
  );
}
