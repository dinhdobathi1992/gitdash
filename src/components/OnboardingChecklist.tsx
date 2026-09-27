"use client";

/**
 * OnboardingChecklist — settings page onboarding status widget.
 *
 * Shows completion status for each key setup step:
 *   1. Auth OK
 *   2. Org access OK
 *   3. DB configured
 *   4. Webhook configured (optional)
 *   5. Alerts configured (optional)
 */

import { useState, useSyncExternalStore } from "react";
import { CheckCircle2, Circle, ChevronRight, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────────

export type CheckStatus = "ok" | "warning" | "missing" | "loading";

export interface CheckItem {
  id: string;
  label: string;
  description: string;
  status: CheckStatus;
  actionLabel?: string;
  actionHref?: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface OnboardingChecklistProps {
  items: CheckItem[];
  className?: string;
}

export function OnboardingChecklist({ items, className }: OnboardingChecklistProps) {
  const total = items.length;
  const done = items.filter((i) => i.status === "ok").length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className={cn("bg-slate-900 border border-slate-800 rounded-xl overflow-hidden", className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Setup Checklist</p>
          <p className="text-xs text-slate-500 mt-0.5">{done} of {total} complete</p>
        </div>
        <div className="relative w-10 h-10">
          <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" stroke="#1E242D" strokeWidth="3" />
            <circle
              cx="18" cy="18" r="15" fill="none"
              stroke={progress === 100 ? "#3DD68C" : "#A48BFF"}
              strokeWidth="3"
              strokeDasharray={`${progress * 0.942} 94.2`}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
            {progress}%
          </span>
        </div>
      </div>

      {/* Items */}
      <div className="divide-y divide-slate-800">
        {items.map((item) => (
          <div key={item.id} className="flex items-start gap-3 px-4 py-3">
            <StatusIcon status={item.status} className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className={cn(
                "text-sm font-medium",
                item.status === "ok" ? "text-slate-300" : "text-white",
              )}>
                {item.label}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>
            </div>
            {item.actionHref && item.status !== "ok" && (
              <Link
                href={item.actionHref}
                className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors shrink-0"
              >
                {item.actionLabel ?? "Fix"}
                <ChevronRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusIcon({ status, className }: { status: CheckStatus; className?: string }) {
  if (status === "loading") {
    return <div className={cn("w-4 h-4 rounded-full border-2 border-slate-600 border-t-violet-500 animate-spin", className)} />;
  }
  if (status === "ok") {
    return <CheckCircle2 className={cn("w-4 h-4 text-green-400", className)} />;
  }
  if (status === "warning") {
    return <AlertCircle className={cn("w-4 h-4 text-amber-400", className)} />;
  }
  return <Circle className={cn("w-4 h-4 text-slate-600", className)} />;
}

// ── Hook: derive checklist from env + API ─────────────────────────────────────

export function useOnboardingChecklist(opts: {
  isAuthenticated: boolean;
  hasOrgAccess: boolean;
  hasDatabase: boolean;
  hasAlerts: boolean;
}): CheckItem[] {
  return [
    {
      id: "auth",
      label: "GitHub authentication",
      description: opts.isAuthenticated
        ? "Authenticated via GitHub OAuth or PAT."
        : "Sign in to enable repository access.",
      status: opts.isAuthenticated ? "ok" : "missing",
      actionLabel: "Sign in",
      actionHref: "/login",
    },
    {
      id: "org",
      label: "Organization access",
      description: opts.hasOrgAccess
        ? "Organization repositories are accessible."
        : "Grant your PAT read access to at least one org.",
      status: opts.isAuthenticated ? (opts.hasOrgAccess ? "ok" : "warning") : "missing",
      actionLabel: "Check PAT",
      actionHref: "/setup",
    },
    {
      id: "db",
      label: "Database (optional)",
      description: opts.hasDatabase
        ? "Neon PostgreSQL connected — historical metrics enabled."
        : "Set DATABASE_URL to unlock historical analytics and alerts.",
      status: opts.hasDatabase ? "ok" : "warning",
      actionLabel: "Docs",
      actionHref: "/docs#database",
    },
    {
      id: "alerts",
      label: "Alerts configured (optional)",
      description: opts.hasAlerts
        ? "At least one alert rule is configured."
        : "Create alert rules to get notified on threshold breaches.",
      status: opts.hasAlerts ? "ok" : "missing",
      actionLabel: "Set up alerts",
      actionHref: "/alerts",
    },
  ];
}

// ── PAT permission guidance ────────────────────────────────────────────────────

export function PatPermissionGuide({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  const PAT_SCOPES = [
    { scope: "repo", description: "Read private repositories, actions, and workflows", required: true },
    { scope: "read:org", description: "Read organization membership and repositories", required: true },
    { scope: "read:user", description: "Read user profile information", required: true },
    { scope: "read:packages", description: "Required for package registry analytics", required: false },
  ];

  async function copyScopes() {
    const text = PAT_SCOPES.filter((s) => s.required).map((s) => s.scope).join(", ");
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={cn("bg-slate-900 border border-slate-800 rounded-xl p-4", className)}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-white">Required PAT Scopes</p>
        <button
          onClick={copyScopes}
          className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
        >
          {copied ? "Copied!" : "Copy required scopes"}
        </button>
      </div>

      <div className="space-y-2">
        {PAT_SCOPES.map(({ scope, description, required }) => (
          <div key={scope} className="flex items-start gap-2.5">
            <span className={cn(
              "mt-0.5 text-xs font-mono px-1.5 py-0.5 rounded border shrink-0",
              required
                ? "bg-violet-500/10 border-violet-500/20 text-violet-400"
                : "bg-slate-800 border-slate-700 text-slate-500",
            )}>
              {scope}
            </span>
            <div>
              <p className="text-xs text-slate-300">{description}</p>
              {!required && <p className="text-xs text-slate-600">Optional</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-slate-800">
        <p className="text-xs text-slate-500">
          Generate a PAT at{" "}
          <a
            href="https://github.com/settings/tokens/new"
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-400 hover:text-violet-300 underline"
          >
            github.com/settings/tokens/new
          </a>
          . Classic tokens and fine-grained PATs are both supported.
        </p>
      </div>
    </div>
  );
}

// ── Copy block ────────────────────────────────────────────────────────────────

export function CopyBlock({ label, content, className }: { label: string; content: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={cn("bg-slate-950 border border-slate-800 rounded-lg overflow-hidden", className)}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800 bg-slate-900">
        <span className="text-xs text-slate-500 font-mono">{label}</span>
        <button
          onClick={copy}
          className="text-xs text-slate-400 hover:text-white transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="px-3 py-2.5 text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap break-all">
        {content}
      </pre>
    </div>
  );
}

// ── Suppress hydration mismatch for localStorage reads ───────────────────────

const emptySubscribe = () => () => {};

export function ClientOnly({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,   // client
    () => false,  // server
  );
  if (!mounted) return null;
  return <>{children}</>;
}
