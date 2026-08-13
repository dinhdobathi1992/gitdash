"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { Breadcrumb } from "@/components/Sidebar";
import { generateTalkingPoints } from "@/lib/one-on-one";
import type { ContributorProfileResponse } from "@/app/api/github/contributor-profile/route";
import {
  ArrowLeft, TrendingUp, TrendingDown, Minus, MessageCircle,
  AlertTriangle, CheckCircle2, ExternalLink, Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";

function DeltaStat({
  label, recent, prior, unit = "",
}: {
  label: string;
  recent: number;
  prior: number;
  unit?: string;
}) {
  const delta = recent - prior;
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const tone = delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-slate-500";

  return (
    <div className="bg-slate-900/50 rounded-lg p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold text-white">{recent}{unit}</span>
        <span className="text-xs text-slate-600">was {prior}{unit}</span>
      </div>
      <div className={cn("flex items-center gap-1 text-[11px] mt-0.5", tone)}>
        <Icon className="w-3 h-3" />
        {delta === 0 ? "No change" : `${delta > 0 ? "+" : ""}${delta}${unit} vs. prior period`}
      </div>
    </div>
  );
}

const TONE_META = {
  positive: { icon: CheckCircle2, text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  watch: { icon: AlertTriangle, text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  neutral: { icon: MessageCircle, text: "text-slate-400", bg: "bg-slate-800/50", border: "border-slate-700/50" },
};

function BriefSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg skeleton" />
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-16 rounded-lg skeleton" />
      ))}
    </div>
  );
}

export default function OneOnOneBriefPage() {
  const { login } = useParams<{ login: string }>();
  const searchParams = useSearchParams();
  const owner = searchParams.get("owner") ?? "";

  // Same SWR key as /contributor/[login] — if the manager already opened
  // the full profile, this loads instantly from cache, no extra fetch.
  const { data, error, isLoading } = useSWR<ContributorProfileResponse>(
    owner && login
      ? `/api/github/contributor-profile?owner=${owner}&login=${login}`
      : null,
    fetcher<ContributorProfileResponse>,
  );

  const talkingPoints = data ? generateTalkingPoints(data) : [];

  return (
    <div className="p-8 max-w-3xl space-y-6 print:p-0">
      <div className="print:hidden">
        <Breadcrumb
          items={[
            { label: "Repositories", href: "/" },
            { label: login, href: `/contributor/${login}?owner=${owner}` },
            { label: "1:1 Prep Sheet" },
          ]}
        />
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">1:1 Prep Sheet</h1>
          {data && (
            <p className="text-sm text-slate-400">
              {data.name ?? data.login} · this period vs. the prior {data.period_comparison.window_days} days
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
          >
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
          <Link
            href={`/contributor/${login}?owner=${owner}`}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Full profile
          </Link>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error.message ?? "Failed to load contributor data"}
        </div>
      )}

      {isLoading && <BriefSkeleton />}

      {data && (
        <>
          {/* Period comparison */}
          <div>
            <h2 className="text-sm font-semibold text-white mb-2">This period vs. last</h2>
            <div className="grid grid-cols-3 gap-3">
              <DeltaStat
                label="PRs merged"
                recent={data.period_comparison.prs_merged_recent}
                prior={data.period_comparison.prs_merged_prior}
              />
              <DeltaStat
                label="Reviews given"
                recent={data.period_comparison.reviews_given_recent}
                prior={data.period_comparison.reviews_given_prior}
              />
              <DeltaStat
                label="Avg hours to merge"
                recent={data.period_comparison.avg_hours_to_merge_recent}
                prior={data.period_comparison.avg_hours_to_merge_prior}
                unit="h"
              />
            </div>
          </div>

          {/* Talking points */}
          <div>
            <h2 className="text-sm font-semibold text-white mb-2">Talking points</h2>
            <p className="text-xs text-slate-500 mb-3">
              Generated from period-over-period shifts — prompts for a conversation, not conclusions.
            </p>
            <div className="flex flex-col gap-2">
              {talkingPoints.map((point, i) => {
                const meta = TONE_META[point.tone];
                const Icon = meta.icon;
                return (
                  <div
                    key={i}
                    className={cn("flex items-start gap-2.5 p-3 rounded-lg border", meta.bg, meta.border)}
                  >
                    <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", meta.text)} />
                    <p className="text-sm text-slate-300">{point.text}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent PRs for context */}
          {data.recent_prs.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-2">Recent PRs</h2>
              <div className="flex flex-col gap-1.5">
                {data.recent_prs.slice(0, 5).map((pr) => (
                  <a
                    key={`${pr.repo_full_name}-${pr.number}`}
                    href={`https://github.com/${pr.repo_full_name}/pull/${pr.number}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800 hover:border-slate-700 transition-colors text-xs"
                  >
                    <span className="text-slate-300 truncate">
                      <span className="text-slate-500 font-mono mr-1.5">{pr.repo_full_name.split("/")[1]}#{pr.number}</span>
                      {pr.title}
                    </span>
                    <span className={cn(
                      "shrink-0 px-1.5 py-0.5 rounded-full font-medium",
                      pr.state === "merged" ? "text-violet-300 bg-violet-500/15" : "text-slate-400 bg-slate-500/15"
                    )}>
                      {pr.state}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <a
            href={data.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-violet-400 transition-colors print:hidden"
          >
            View {data.login} on GitHub <ExternalLink className="w-3 h-3" />
          </a>
        </>
      )}
    </div>
  );
}
