"use client";

/**
 * "Why?" explanation for a metric's anomalies (v4.1.1).
 *
 * Lazy by design: the SWR key stays null until the user actually asks, so
 * simply opening the Reliability tab never costs a provider call. Gated on
 * the same two conditions as every AI surface — server keys present and the
 * aiInsights flag on — and renders nothing when either is false.
 */

import { useState } from "react";
import useSWR from "swr";
import { fetcher, FetchError } from "@/lib/swr";
import { useAiEnabled } from "@/lib/use-ai-enabled";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import type { AiAnomalyResponse } from "@/app/api/ai/anomaly-explanation/route";
import type { AnomalyMetric } from "@/lib/anomaly";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";

const METRIC_LABELS: Record<AnomalyMetric, string> = {
  duration: "duration",
  queue_wait: "queue wait",
};

export default function AnomalyExplanation({
  owner,
  repo,
  workflowId,
  metric,
}: {
  owner: string;
  repo: string;
  workflowId: number;
  metric: AnomalyMetric;
}) {
  const { enabled } = useAiEnabled();
  const { flags } = useFeatureFlags();
  const [asked, setAsked] = useState(false);

  const key = asked
    ? `/api/ai/anomaly-explanation?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&workflow_id=${workflowId}&metric=${metric}`
    : null;

  const { data, error, isLoading } = useSWR<AiAnomalyResponse>(key, fetcher<AiAnomalyResponse>, {
    errorRetryCount: 0,
  });

  if (!enabled || !flags.aiInsights) return null;

  if (!asked) {
    return (
      <button
        onClick={() => setAsked(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-violet-300 bg-violet-500/10 border border-violet-500/25 rounded-lg hover:bg-violet-500/20 transition-colors"
      >
        <Sparkles className="w-3 h-3" />
        Why did {METRIC_LABELS[metric]} spike?
      </button>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-violet-200">
        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
        Looking at the surrounding signals…
      </div>
    );
  }

  if (error) {
    const status = error instanceof FetchError ? error.status : null;
    return (
      <p className="text-[11px] text-slate-500 italic">
        {status === 404
          ? "No outliers to explain for this metric."
          : status === 429
            ? "Rate limit reached — try again in a minute."
            : "Explanation unavailable right now."}
      </p>
    );
  }

  if (!data) return null;

  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.05] p-3 space-y-2">
      <p className="text-xs text-slate-200 leading-relaxed">{data.content.explanation}</p>
      <div className="flex items-start gap-1.5 text-[11px] text-slate-400">
        <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0 text-violet-400" />
        <span>{data.content.check}</span>
      </div>
      <p className="text-[10px] text-slate-600">
        {data.provider} · {data.model}
        {data.cached && " · cached"} · generated from run metadata, not logs
      </p>
    </div>
  );
}
