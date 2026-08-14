"use client";

/**
 * AI root-cause hypotheses (v4.1.2).
 *
 * Lazy like the anomaly explainer: this is the most expensive AI surface
 * (per-run job fetches plus a larger generation), so nothing happens until
 * the user asks. Renders nothing without server keys or with the flag off.
 *
 * Confidence is displayed prominently and honestly. A low-confidence
 * hypothesis presented as certainty is worse than no hypothesis at all —
 * these are leads to check, not diagnoses.
 */

import { useState } from "react";
import useSWR from "swr";
import { fetcher, FetchError } from "@/lib/swr";
import { useAiEnabled } from "@/lib/use-ai-enabled";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import type { AiRootCauseResponse } from "@/app/api/ai/root-cause/route";
import type { Confidence } from "@/lib/ai-schema";
import { Sparkles, Loader2, Search, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "bg-red-500/10 text-red-300 border-red-500/25",
  medium: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  low: "bg-slate-700/40 text-slate-400 border-slate-600/40",
};

export default function RootCauseHypotheses({
  owner,
  repo,
  workflowId,
}: {
  owner: string;
  repo: string;
  workflowId: number;
}) {
  const { enabled } = useAiEnabled();
  const { flags } = useFeatureFlags();
  const [asked, setAsked] = useState(false);

  const key = asked
    ? `/api/ai/root-cause?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&workflow_id=${workflowId}`
    : null;

  const { data, error, isLoading } = useSWR<AiRootCauseResponse>(key, fetcher<AiRootCauseResponse>, {
    errorRetryCount: 0,
  });

  if (!enabled || !flags.aiInsights) return null;

  if (!asked) {
    return (
      <button
        onClick={() => setAsked(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-violet-300 bg-violet-500/10 border border-violet-500/25 rounded-lg hover:bg-violet-500/20 transition-colors"
      >
        <Sparkles className="w-3.5 h-3.5" />
        Suggest why this is failing
      </button>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2.5 text-xs text-violet-200">
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        Reading failed jobs and step names — this one takes a few seconds…
      </div>
    );
  }

  if (error) {
    const status = error instanceof FetchError ? error.status : null;
    return (
      <p className="text-xs text-slate-500 italic">
        {status === 429
          ? "Rate limit reached — try again in a minute."
          : "Hypotheses unavailable right now."}
      </p>
    );
  }

  if (!data) return null;

  // Server-side floor: too few failures to say anything useful.
  if (!data.content) {
    return (
      <p className="text-xs text-slate-500 italic">
        Only {data.failure_count} recent failure{data.failure_count === 1 ? "" : "s"} — not enough of
        a pattern to analyse yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {data.partial && (
        <p className="text-[11px] text-amber-300/80">
          Some job details could not be fetched, so this is based on an incomplete sample.
        </p>
      )}

      {data.content.hypotheses.map((h) => (
        <div
          key={h.rank}
          className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2.5"
        >
          <div className="flex items-start gap-3">
            <span className="shrink-0 w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-400">
              {h.rank}
            </span>
            <p className="text-sm text-slate-100 leading-relaxed flex-1">{h.hypothesis}</p>
            <span
              className={cn(
                "shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border",
                CONFIDENCE_STYLE[h.confidence],
              )}
            >
              {h.confidence}
            </span>
          </div>

          <div className="flex gap-2 pl-8 text-xs text-slate-400">
            <Search className="w-3 h-3 mt-0.5 shrink-0 text-slate-600" />
            <span>{h.evidence}</span>
          </div>

          <div className="flex gap-2 pl-8 text-xs text-violet-300">
            <ArrowRight className="w-3 h-3 mt-0.5 shrink-0" />
            <span>{h.next_step}</span>
          </div>
        </div>
      ))}

      <p className="text-[10px] text-slate-600">
        {data.provider} · {data.model}
        {data.cached && " · cached"} · inferred from job and step metadata, not run logs
      </p>
    </div>
  );
}
