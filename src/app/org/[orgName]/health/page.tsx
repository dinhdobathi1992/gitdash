"use client";

import { use, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { Breadcrumb } from "@/components/Sidebar";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import { LEVEL_COLORS, LEVEL_LABELS } from "@/lib/dora";
import type { OrgHealthScorecardResponse, RepoScorecardEntry } from "@/app/api/github/org-health-scorecard/route";
import {
  Building2, ShieldCheck, TrendingUp, TrendingDown, Minus,
  ExternalLink, AlertTriangle, ChevronRight, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

const RISK_META: Record<RepoScorecardEntry["risk_band"], { label: string; text: string; bg: string; border: string }> = {
  healthy: { label: "Healthy", text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/25" },
  watch: { label: "Watch", text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/25" },
  at_risk: { label: "At Risk", text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/25" },
};

function TrendIcon({ trend }: { trend: RepoScorecardEntry["trend"] }) {
  if (trend === "up") return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
  if (trend === "down") return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
  return <Minus className="w-3.5 h-3.5 text-slate-500" />;
}

function ScoreBar({ score }: { score: number }) {
  const tone = score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="w-24 h-1.5 rounded-full bg-slate-800 overflow-hidden shrink-0">
      <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(2, score)}%` }} />
    </div>
  );
}

function RepoScoreRow({ entry }: { entry: RepoScorecardEntry }) {
  const risk = RISK_META[entry.risk_band];
  const doraMeta = LEVEL_COLORS[entry.dora_level];

  return (
    <div className={cn("rounded-xl border p-4 flex items-center gap-4 flex-wrap", risk.border, risk.bg)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Link
            href={`/repos/${entry.owner}/${entry.repo}`}
            className="text-sm font-semibold text-white hover:text-violet-300 transition-colors font-mono truncate"
          >
            {entry.repo}
          </Link>
          <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full border", risk.text, risk.border)}>
            {risk.label}
          </span>
          {entry.partial && (
            <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" aria-label="Computed from partial data" />
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
          <span className={cn("px-1.5 py-0.5 rounded font-medium", doraMeta.bg, doraMeta.text)}>
            DORA: {LEVEL_LABELS[entry.dora_level]}
          </span>
          <span>
            Bus factor: <span className="text-slate-300 font-medium">{entry.overall_bus_factor}</span>
          </span>
          {entry.critical_modules > 0 && (
            <span className="text-red-400">{entry.critical_modules} critical module{entry.critical_modules === 1 ? "" : "s"}</span>
          )}
          <span className="flex items-center gap-1">
            <TrendIcon trend={entry.trend} /> throughput {entry.trend}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <ScoreBar score={entry.composite_score} />
        <span className="text-lg font-bold text-white w-8 text-right">{entry.composite_score}</span>
        <Link
          href={`/repos/${entry.owner}/${entry.repo}`}
          className="text-slate-600 hover:text-slate-300 transition-colors"
          aria-label={`Open ${entry.repo}`}
        >
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

function ScorecardSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[72px] rounded-xl skeleton" />
      ))}
    </div>
  );
}

export default function OrgHealthScorecardPage({
  params,
}: {
  params: Promise<{ orgName: string }>;
}) {
  const { orgName } = use(params);
  const { flags } = useFeatureFlags();
  const [limit, setLimit] = useState(10);

  const { data, error, isLoading } = useSWR<OrgHealthScorecardResponse>(
    flags.healthScorecard
      ? `/api/github/org-health-scorecard?org=${encodeURIComponent(orgName)}&limit=${limit}`
      : null,
    fetcher<OrgHealthScorecardResponse>,
  );

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <Breadcrumb
        items={[
          { label: "Repositories", href: "/" },
          { label: orgName, href: `/org/${orgName}` },
          { label: "Team Health" },
        ]}
      />

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Team Health Scorecard</h1>
          <p className="text-sm text-slate-400">
            Every repo in <span className="font-mono text-slate-300">{orgName}</span>, ranked worst-first
          </p>
        </div>
      </div>

      {!flags.healthScorecard ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-800 bg-slate-900/30 text-sm text-slate-500">
          <span>Team Health Scorecard is disabled —</span>
          <a href="/settings" className="text-violet-400 hover:underline">Enable in Settings → Feature Flags</a>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Info className="w-3.5 h-3.5" />
              Composite score: 60% DORA tier + 40% bus-factor risk. Trend compares recent vs. prior throughput.
            </div>
            <div className="ml-auto flex items-center gap-2">
              <label className="text-xs text-slate-500">Repos analysed</label>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="px-2 py-1 bg-slate-900/60 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500/40 cursor-pointer"
              >
                {[5, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>

          {isLoading && <ScorecardSkeleton />}

          {error && (
            <div className="px-4 py-3 rounded-xl border border-red-500/25 bg-red-500/10 text-sm text-red-300">
              {error.message ?? "Failed to load the health scorecard"}
            </div>
          )}

          {data && data.repos.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
              <Building2 className="w-8 h-8 text-slate-600" />
              <p className="text-sm text-slate-500">No repos with enough activity to score yet.</p>
            </div>
          )}

          {data && data.repos.length > 0 && (
            <div className="space-y-3">
              {data.repos_analysed < data.repos_attempted && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Scored {data.repos_analysed}/{data.repos_attempted} repos — the rest failed to fetch (rate limit or access).
                </div>
              )}
              {data.repos.map((entry) => (
                <RepoScoreRow key={`${entry.owner}/${entry.repo}`} entry={entry} />
              ))}
            </div>
          )}

          <a
            href={`https://github.com/${encodeURIComponent(orgName)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-violet-400 transition-colors"
          >
            View {orgName} on GitHub <ExternalLink className="w-3 h-3" />
          </a>
        </>
      )}
    </div>
  );
}
