"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { RepoWorkflowBreadcrumb } from "@/components/Sidebar";
import type {
  SecurityScanResponse,
  WorkflowSecurityResult,
  SecurityFinding,
  FindingSeverity,
} from "@/app/api/github/security-scan/route";
import {
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Info,
  FileCode,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

// ── Severity helpers ──────────────────────────────────────────────────────────

const SEVERITY_STYLE: Record<
  FindingSeverity,
  { label: string; bg: string; border: string; text: string; icon: React.ElementType }
> = {
  critical: {
    label: "Critical",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-400",
    icon: ShieldX,
  },
  high: {
    label: "High",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    text: "text-orange-400",
    icon: ShieldAlert,
  },
  medium: {
    label: "Medium",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-400",
    icon: AlertCircle,
  },
  info: {
    label: "Info",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    icon: Info,
  },
};

function scoreColor(score: number): string {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-amber-400";
  if (score >= 50) return "text-orange-400";
  return "text-red-400";
}

function scoreLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  return "Poor";
}

// ── Score ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;

  const strokeColor =
    score >= 90
      ? "#4ade80"
      : score >= 70
        ? "#fbbf24"
        : score >= 50
          ? "#f97316"
          : "#f87171";

  return (
    <svg width="80" height="80" viewBox="0 0 80 80" className="rotate-[-90deg]">
      {/* Track */}
      <circle cx="40" cy="40" r={r} fill="none" stroke="#1e293b" strokeWidth="7" />
      {/* Fill */}
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        stroke={strokeColor}
        strokeWidth="7"
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Finding card ──────────────────────────────────────────────────────────────

function FindingCard({ finding }: { finding: SecurityFinding }) {
  const s = SEVERITY_STYLE[finding.severity];
  const Icon = s.icon;
  return (
    <div
      className={cn(
        "rounded-lg border p-4 space-y-2",
        s.bg,
        s.border
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn("w-4 h-4 shrink-0 mt-0.5", s.text)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{finding.title}</span>
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-medium border",
                s.bg,
                s.border,
                s.text
              )}
            >
              {s.label}
            </span>
            <span className="text-[10px] font-mono text-slate-500">{finding.rule_id}</span>
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            {finding.description}
          </p>
          {finding.context && (
            <pre className="mt-2 text-[10px] font-mono bg-slate-900/60 border border-slate-700 rounded p-2 overflow-x-auto text-slate-300">
              {finding.context}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Workflow result card ──────────────────────────────────────────────────────

function WorkflowResultCard({ result }: { result: WorkflowSecurityResult }) {
  const [expanded, setExpanded] = useState(result.findings.length > 0);
  const hasIssues = result.findings.length > 0;

  const critCount = result.findings.filter((f) => f.severity === "critical").length;
  const highCount = result.findings.filter((f) => f.severity === "high").length;
  const medCount = result.findings.filter((f) => f.severity === "medium").length;
  const infoCount = result.findings.filter((f) => f.severity === "info").length;

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-700/20 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Score ring (mini) */}
        <div className="relative shrink-0 w-10 h-10">
          <svg width="40" height="40" viewBox="0 0 40 40" className="rotate-[-90deg]">
            <circle cx="20" cy="20" r="14" fill="none" stroke="#1e293b" strokeWidth="4" />
            <circle
              cx="20"
              cy="20"
              r="14"
              fill="none"
              stroke={
                result.score >= 90
                  ? "#4ade80"
                  : result.score >= 70
                    ? "#fbbf24"
                    : result.score >= 50
                      ? "#f97316"
                      : "#f87171"
              }
              strokeWidth="4"
              strokeDasharray={`${(result.score / 100) * 2 * Math.PI * 14} ${2 * Math.PI * 14}`}
              strokeLinecap="round"
            />
          </svg>
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center text-[10px] font-bold",
              scoreColor(result.score)
            )}
          >
            {result.score}
          </span>
        </div>

        {/* File path */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <FileCode className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-sm font-mono text-white truncate">{result.file_path}</span>
          </div>
          {/* Finding badges */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {critCount > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 border border-red-500/30 text-red-400">
                {critCount} critical
              </span>
            )}
            {highCount > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/10 border border-orange-500/30 text-orange-400">
                {highCount} high
              </span>
            )}
            {medCount > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400">
                {medCount} medium
              </span>
            )}
            {infoCount > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 border border-blue-500/30 text-blue-400">
                {infoCount} info
              </span>
            )}
            {!hasIssues && (
              <span className="flex items-center gap-1 text-[10px] text-green-400">
                <CheckCircle className="w-3 h-3" /> No issues
              </span>
            )}
          </div>
        </div>

        {/* Checks summary */}
        <div className="hidden md:flex items-center gap-3 shrink-0 text-[11px]">
          <span
            className={cn(
              "flex items-center gap-1",
              result.pinned_actions ? "text-green-400" : "text-red-400"
            )}
          >
            {result.pinned_actions ? (
              <CheckCircle className="w-3 h-3" />
            ) : (
              <XCircle className="w-3 h-3" />
            )}{" "}
            Pinned
          </span>
          <span
            className={cn(
              "flex items-center gap-1",
              result.has_permissions ? "text-green-400" : "text-amber-400"
            )}
          >
            {result.has_permissions ? (
              <CheckCircle className="w-3 h-3" />
            ) : (
              <XCircle className="w-3 h-3" />
            )}{" "}
            Perms
          </span>
          <span
            className={cn(
              "flex items-center gap-1",
              result.has_timeout ? "text-green-400" : "text-amber-400"
            )}
          >
            {result.has_timeout ? (
              <CheckCircle className="w-3 h-3" />
            ) : (
              <XCircle className="w-3 h-3" />
            )}{" "}
            Timeout
          </span>
          <span
            className={cn(
              "flex items-center gap-1",
              !result.uses_pull_request_target ? "text-green-400" : "text-red-400"
            )}
          >
            {!result.uses_pull_request_target ? (
              <CheckCircle className="w-3 h-3" />
            ) : (
              <XCircle className="w-3 h-3" />
            )}{" "}
            PRT-safe
          </span>
        </div>

        {/* Expand toggle */}
        <div className="shrink-0 ml-2">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          )}
        </div>
      </button>

      {/* Findings */}
      {expanded && result.findings.length > 0 && (
        <div className="border-t border-slate-700/50 p-4 space-y-3">
          {result.findings.map((f, i) => (
            <FindingCard key={`${f.rule_id}-${i}`} finding={f} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Overall summary strip ─────────────────────────────────────────────────────

function SummaryStrip({ data }: { data: SecurityScanResponse }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {/* Score */}
      <div className="col-span-2 md:col-span-1 bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex items-center gap-4">
        <div className="relative w-20 h-20 shrink-0">
          <ScoreRing score={data.overall_score} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("text-xl font-bold", scoreColor(data.overall_score))}>
              {data.overall_score}
            </span>
            <span className="text-[9px] text-slate-500 -mt-0.5">/ 100</span>
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-400">Security Score</p>
          <p className={cn("text-sm font-semibold", scoreColor(data.overall_score))}>
            {scoreLabel(data.overall_score)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {data.workflows_scanned} file{data.workflows_scanned !== 1 ? "s" : ""} scanned
          </p>
        </div>
      </div>

      {/* Counts */}
      {(
        [
          { label: "Critical", count: data.critical_count, sev: "critical" as FindingSeverity },
          { label: "High", count: data.high_count, sev: "high" as FindingSeverity },
          { label: "Medium", count: data.medium_count, sev: "medium" as FindingSeverity },
          { label: "Info", count: data.info_count, sev: "info" as FindingSeverity },
        ] as const
      ).map(({ label, count, sev }) => {
        const s = SEVERITY_STYLE[sev];
        const Icon = s.icon;
        return (
          <div
            key={sev}
            className={cn(
              "bg-slate-800/60 border rounded-xl p-4",
              count > 0 ? s.border : "border-slate-700/50"
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className={cn("w-4 h-4", count > 0 ? s.text : "text-slate-600")} />
              <span className="text-xs text-slate-400">{label}</span>
            </div>
            <p
              className={cn(
                "text-2xl font-bold",
                count > 0 ? s.text : "text-slate-600"
              )}
            >
              {count}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SecurityPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();

  const { data, error, isLoading } = useSWR<SecurityScanResponse>(
    `/api/github/security-scan?owner=${owner}&repo=${repo}`,
    fetcher<SecurityScanResponse>,
    { revalidateOnFocus: false }
  );

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <RepoWorkflowBreadcrumb owner={owner} repo={repo} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Workflow Security</h1>
          <p className="text-sm text-slate-400">
            Static analysis of GitHub Actions workflow YAML files for security issues in{" "}
            <span className="font-mono text-slate-300">
              {owner}/{repo}
            </span>
          </p>
        </div>
        <Link
          href={`/repos/${owner}/${repo}`}
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to repo
        </Link>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 animate-pulse h-24"
              />
            ))}
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 animate-pulse h-16"
            />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">
              {error.message ?? "Failed to scan workflows"}
            </span>
          </div>
        </div>
      )}

      {/* Empty — no workflow files */}
      {data && !isLoading && data.workflows_scanned === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <ShieldCheck className="w-10 h-10 text-slate-600" />
          <p className="text-slate-400 text-sm">
            No GitHub Actions workflow files found in{" "}
            <code className="text-slate-300">.github/workflows/</code>.
          </p>
        </div>
      )}

      {/* Data */}
      {data && !isLoading && data.workflows_scanned > 0 && (
        <>
          <SummaryStrip data={data} />

          {/* Perfect score banner */}
          {data.total_findings === 0 && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-5 flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-green-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-400">
                  No security issues found
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  All {data.workflows_scanned} workflow file
                  {data.workflows_scanned !== 1 ? "s" : ""} passed all security checks.
                </p>
              </div>
            </div>
          )}

          {/* Per-file results */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-white">
              Workflow Files ({data.workflows_scanned})
            </h2>
            {data.results.map((result) => (
              <WorkflowResultCard key={result.file_path} result={result} />
            ))}
          </div>

          {/* Rule reference */}
          <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-slate-300">Security Rules Reference</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  These checks are based on{" "}
                  <a
                    href="https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-400 hover:text-violet-300 underline underline-offset-2"
                  >
                    GitHub&apos;s official security hardening guide
                  </a>{" "}
                  and common Actions security best practices. They are static pattern checks on
                  YAML — not a substitute for a full security audit. False positives are possible.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {[
                {
                  id: "SEC-001",
                  desc: "pull_request_target trigger",
                  sev: "critical",
                  href: "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections",
                },
                {
                  id: "SEC-002",
                  desc: "Secret echoed to logs",
                  sev: "critical",
                  href: "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-secrets",
                },
                {
                  id: "SEC-003",
                  desc: "Secret passed as CLI argument",
                  sev: "high",
                  href: "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-secrets",
                },
                {
                  id: "SEC-004",
                  desc: "Secret written to GITHUB_OUTPUT",
                  sev: "critical",
                  href: "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-secrets",
                },
                {
                  id: "SEC-005",
                  desc: "Unquoted workflow_dispatch input in run step",
                  sev: "high",
                  href: "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections",
                },
                {
                  id: "SEC-006",
                  desc: "Action pinned to mutable ref (main/master/HEAD)",
                  sev: "high",
                  href: "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions",
                },
                {
                  id: "SEC-007",
                  desc: "No timeout-minutes set",
                  sev: "medium",
                  href: "https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#jobsjob_idtimeout-minutes",
                },
                {
                  id: "SEC-008",
                  desc: "No permissions block declared",
                  sev: "medium",
                  href: "https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication#modifying-the-permissions-for-the-github_token",
                },
                {
                  id: "SEC-009",
                  desc: "workflow_dispatch inputs without type declaration",
                  sev: "info",
                  href: "https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#onworkflow_dispatchinputsinput_idtype",
                },
                {
                  id: "SEC-010",
                  desc: "ECR login without mask-password: true",
                  sev: "medium",
                  href: "https://github.com/aws-actions/amazon-ecr-login#inputs",
                },
              ].map(({ id, desc, sev, href }) => {
                const sevColor =
                  sev === "critical"
                    ? "text-red-400 bg-red-500/10 border-red-500/30"
                    : sev === "high"
                      ? "text-orange-400 bg-orange-500/10 border-orange-500/30"
                      : sev === "medium"
                        ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
                        : "text-blue-400 bg-blue-500/10 border-blue-500/30";
                return (
                  <div key={id} className="flex items-center gap-3 text-xs">
                    <code className="text-violet-400 shrink-0 w-16">{id}</code>
                    <span className="text-slate-300 flex-1">{desc}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded border text-[10px] font-medium shrink-0 ${sevColor}`}
                    >
                      {sev}
                    </span>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-slate-500 hover:text-violet-400 transition-colors shrink-0"
                      title="GitHub docs"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
