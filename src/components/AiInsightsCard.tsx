"use client";

/**
 * AI Insights card (v4.1.0).
 *
 * Renders the LLM synthesis of whatever metrics are already on the page.
 * Two gates, both required: the server must have provider keys configured
 * (useAiEnabled) and the user must not have switched the surface off
 * (aiInsights flag). When either is false this renders nothing at all — no
 * placeholder, no "enable this" nag, so a deployment without AI keys looks
 * exactly as it did before v4.1.0.
 *
 * Failure is a non-event by design. This is an enhancement layered over
 * metrics the user can already read, so an unavailable provider gets a muted
 * one-liner rather than an error-red box.
 */

import { useState } from "react";
import useSWR from "swr";
import { fetcher, FetchError } from "@/lib/swr";
import { useAiEnabled } from "@/lib/use-ai-enabled";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import type { AiInsightsResponse } from "@/app/api/ai/insights/route";
import {
  Sparkles, ChevronRight, RefreshCw, Loader2, AlertTriangle, Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props =
  | { surface: "repo"; owner: string; repo: string }
  | { surface: "org"; org: string };

export default function AiInsightsCard(props: Props) {
  const { enabled } = useAiEnabled();
  const { flags } = useFeatureFlags();
  const [open, setOpen] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const query =
    props.surface === "repo"
      ? `owner=${encodeURIComponent(props.owner)}&repo=${encodeURIComponent(props.repo)}`
      : `org=${encodeURIComponent(props.org)}`;

  // refreshKey is a cache-buster for SWR only; refresh=1 tells the route to
  // bypass its own server-side cache and regenerate.
  const key =
    enabled && flags.aiInsights
      ? `/api/ai/insights?${query}${refreshKey > 0 ? `&refresh=1&_=${refreshKey}` : ""}`
      : null;

  const { data, error, isLoading, isValidating } = useSWR<AiInsightsResponse>(
    key,
    fetcher<AiInsightsResponse>,
    { errorRetryCount: 0 }, // a 503 here means "unavailable", not "try harder"
  );

  if (!enabled || !flags.aiInsights) return null;

  const status = error instanceof FetchError ? error.status : null;
  const unavailableText =
    status === 429
      ? "Rate limit reached — try again in a minute."
      : "AI insights are unavailable right now.";

  return (
    <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-b from-violet-500/[0.04] to-slate-950/40 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full relative flex items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-violet-500/[0.06]",
          open && "border-b border-violet-500/15",
        )}
      >
        <span className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-violet-400 to-violet-600" />
        <span className="shrink-0 w-9 h-9 rounded-lg border border-violet-500/30 bg-violet-500/[0.14] flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-violet-300" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[15px] font-semibold text-white">AI Insights</span>
            {data?.partial && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-amber-500/25 bg-amber-500/10 text-amber-300">
                <AlertTriangle className="w-3 h-3" /> partial data
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Generated analysis of the metrics on this page — always verify against the numbers.
          </p>
        </div>
        <span className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-gradient-to-b from-slate-800 to-slate-900 text-xs text-slate-300">
          {open ? "Hide" : "Show"}
          <ChevronRight className={cn("w-3 h-3 transition-transform", open && "rotate-90")} />
        </span>
      </button>

      {open && (
        <div className="p-5">
          {isLoading && (
            <div className="flex items-center gap-2.5 text-sm text-violet-200">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>Analysing your metrics…</span>
            </div>
          )}

          {!isLoading && error && (
            <p className="text-xs text-slate-500 italic">{unavailableText}</p>
          )}

          {!isLoading && !error && data && (
            <div className="space-y-4">
              <p className="text-sm text-slate-200 leading-relaxed">{data.content.summary}</p>

              {data.content.bullets.length > 0 && (
                <ul className="space-y-1.5">
                  {data.content.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2.5 text-xs text-slate-400">
                      <span className="mt-1.5 w-1 h-1 rounded-full bg-violet-400 shrink-0" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}

              {data.content.actions.length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-300 mb-2">
                    <Lightbulb className="w-3.5 h-3.5" /> Suggested actions
                  </div>
                  <ul className="space-y-1.5">
                    {data.content.actions.map((a, i) => (
                      <li key={i} className="flex gap-2.5 text-xs text-slate-300">
                        <span className="font-mono text-slate-600 shrink-0">{i + 1}.</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
                <span className="text-[11px] text-slate-600">
                  {data.provider} · {data.model}
                  {data.cached && " · cached"}
                </span>
                <button
                  onClick={() => setRefreshKey((k) => k + 1)}
                  disabled={isValidating}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-slate-400 hover:text-violet-300 border border-slate-700 rounded-lg transition-colors disabled:opacity-40"
                >
                  <RefreshCw className={cn("w-3 h-3", isValidating && "animate-spin")} />
                  Regenerate
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
