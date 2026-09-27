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
import { Sparkles, ChevronRight, RefreshCw, Loader2, Lightbulb } from "lucide-react";
import { cn, formatRelative } from "@/lib/utils";

type Props =
  | { surface: "repo"; owner: string; repo: string }
  | { surface: "org"; org: string };

export default function AiInsightsCard(props: Props) {
  const { enabled } = useAiEnabled();
  const { flags } = useFeatureFlags();
  const [open, setOpen] = useState(false);
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

  const evidenceHref = props.surface === "repo" ? "#delivery" : null;

  return (
    <section aria-label="AI summary" className="card px-5 py-5">
      <div className="flex items-start gap-4">
        <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-control bg-brand-soft text-brand-fg" aria-hidden="true">
          <Sparkles className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          {isLoading && (
            <p className="flex items-center gap-2.5 text-sm text-muted">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" /> Summarising the last 30 days…
            </p>
          )}

          {!isLoading && error && <p className="text-sm text-muted">{unavailableText}</p>}

          {!isLoading && !error && data && (
            <>
              <p className="max-w-[820px] text-sm leading-[22px] font-medium text-fg">{data.content.summary}</p>
              <p className="mt-2 text-xs text-faint">
                AI summary of the metrics on this page · {data.provider} · {data.model}
                {data.cached ? " · cached" : ""} · updated {formatRelative(data.generated_at)}
                {data.partial && <span className="text-status-warn-text"> · partial data</span>}
              </p>

              {open && (data.content.bullets.length > 0 || data.content.actions.length > 0) && (
                <div className="mt-4 grid gap-4 md:grid-cols-2 max-w-[1000px]">
                  {data.content.bullets.length > 0 && (
                    <ul className="space-y-1.5">
                      {data.content.bullets.map((b, i) => (
                        <li key={i} className="flex gap-2.5 text-[13px] text-muted">
                          <span className="mt-2 w-1 h-1 rounded-full bg-brand-fg shrink-0" aria-hidden="true" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {data.content.actions.length > 0 && (
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-medium text-brand-fg mb-2">
                        <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" /> Suggested actions
                      </p>
                      <ol className="space-y-1.5">
                        {data.content.actions.map((a, i) => (
                          <li key={i} className="flex gap-2.5 text-[13px] text-muted">
                            <span className="font-mono text-faint shrink-0">{i + 1}.</span>
                            <span>{a}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        {!isLoading && !error && data && (
          <div className="hidden sm:flex flex-col items-end gap-2 shrink-0">
            {evidenceHref && (
              <a href={evidenceHref} className="inline-flex items-center gap-1 text-[13px] font-medium text-link hover:text-violet-200">
                See the evidence <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            )}
            <div className="flex items-center gap-1">
              {(data.content.bullets.length > 0 || data.content.actions.length > 0) && (
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  aria-expanded={open}
                  className="h-8 px-2.5 rounded-control text-xs text-muted hover:text-fg hover:bg-raised"
                >
                  {open ? "Hide details" : "Show details"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setRefreshKey((k) => k + 1)}
                disabled={isValidating}
                aria-label="Regenerate summary"
                title="Regenerate summary"
                className="flex items-center justify-center w-8 h-8 rounded-control text-muted hover:text-fg hover:bg-raised disabled:text-disabled"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isValidating && "animate-spin")} />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
