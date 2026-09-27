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

// Contract `Workflow` artboard: Likely / Possible / Unlikely chips.
const CONFIDENCE: Record<Confidence, { label: string; cls: string }> = {
  high: { label: "Likely", cls: "bg-status-fail-tint text-status-fail-text" },
  medium: { label: "Possible", cls: "bg-status-warn-tint text-status-warn-text" },
  low: { label: "Unlikely", cls: "bg-status-neutral-tint text-status-neutral-text" },
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
      <div className="flex flex-col items-start gap-3 py-2">
        <p className="text-[13px] text-muted">
          Reads the failed jobs and step names of recent runs and suggests likely causes. Takes a few seconds.
        </p>
        <button
          type="button"
          onClick={() => setAsked(true)}
          className="inline-flex items-center gap-2 h-9 px-3.5 rounded-control bg-brand-soft border border-brand-fg/40 text-[13px] font-semibold text-violet-200 hover:bg-brand-soft/70"
        >
          <Sparkles className="w-4 h-4" aria-hidden="true" /> Suggest why this is failing
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <p className="flex items-center gap-2.5 py-2 text-[13px] text-muted">
        <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
        Reading failed jobs and step names…
      </p>
    );
  }

  if (error) {
    const status = error instanceof FetchError ? error.status : null;
    return (
      <p className="py-2 text-[13px] text-muted">
        {status === 429 ? "Rate limit reached — try again in a minute." : "Hypotheses are unavailable right now."}
      </p>
    );
  }

  if (!data) return null;

  // Server-side floor: too few failures to say anything useful.
  if (!data.content) {
    return (
      <p className="py-2 text-[13px] text-muted">
        Only {data.failure_count} recent failure{data.failure_count === 1 ? "" : "s"} — not enough of a pattern to analyse yet.
      </p>
    );
  }

  return (
    <div>
      {data.partial && (
        <p className="mb-2 text-xs text-status-warn-text">
          Some job details could not be fetched, so this is based on an incomplete sample.
        </p>
      )}
      <ul>
        {data.content.hypotheses.map((h) => {
          const c = CONFIDENCE[h.confidence];
          return (
            <li key={h.rank} className="py-4 border-b border-line last:border-0 first:pt-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-fg">{h.hypothesis}</p>
                <span className={cn("shrink-0 inline-flex items-center h-[22px] px-2 rounded-chip text-xs font-semibold", c.cls)}>{c.label}</span>
              </div>
              <p className="mt-2 flex gap-2 text-[13px] leading-5 text-muted">
                <Search className="w-3.5 h-3.5 mt-0.5 shrink-0 text-faint" aria-hidden="true" />
                <span>{h.evidence}</span>
              </p>
              <p className="mt-1.5 flex gap-2 text-[13px] leading-5 text-link">
                <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{h.next_step}</span>
              </p>
            </li>
          );
        })}
      </ul>
      <p className="pt-2 text-xs text-faint">
        {data.provider} · {data.model}
        {data.cached && " · cached"} · inferred from job and step metadata, not run logs
      </p>
    </div>
  );
}
