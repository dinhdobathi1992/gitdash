"use client";

/**
 * Deployment metrics panel (v4.2.1).
 *
 * The point of this panel is provenance as much as data. The DORA cards above
 * it are inferred from releases and branch names; when a repo genuinely uses
 * the Deployments API, the same three metrics can be measured — and the
 * difference between "measured" and "estimated" is stated plainly rather than
 * quietly improving the numbers.
 *
 * When a repo has no deployments, this renders a short explanation of what the
 * existing figures actually mean, which is more useful than hiding.
 */

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { DeploymentsSummary } from "@/app/api/github/deployments/route";
import {
  Rocket, CheckCircle2, XCircle, Clock, Info, AlertTriangle, GitBranch, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

function StateDot({ state }: { state: string | null }) {
  const cls =
    state === "success" ? "bg-emerald-400"
      : state === "failure" || state === "error" ? "bg-red-400"
      : state === "in_progress" || state === "pending" ? "bg-amber-400"
      : "bg-slate-600";
  return <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cls)} />;
}

export default function DeploymentsPanel({ owner, repo }: { owner: string; repo: string }) {
  const { data, error, isLoading } = useSWR<DeploymentsSummary>(
    `/api/github/deployments?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
    fetcher<DeploymentsSummary>,
  );

  // Which environment drives the headline figures.
  //
  // Auto-detection can only guess when a repo deploys to several production
  // targets — picking one for the user and being wrong is worse than letting
  // them choose. The choice is remembered per repository, because otherwise
  // it would have to be re-made on every visit.
  const storageKey = `gitdash:deploy-env:${owner}/${repo}`;

  // Lazy initialiser rather than an effect: React 19 forbids setState during
  // an effect, and there is no hydration risk here because the environment
  // list only renders once client-side SWR data has arrived.
  const [selected, setSelected] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(storageKey);
    } catch {
      // Private mode or storage disabled — fall back to auto-detection.
      return null;
    }
  });

  function chooseEnvironment(env: string) {
    setSelected(env);
    try {
      localStorage.setItem(storageKey, env);
    } catch {
      // Selection still applies for this session.
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="h-4 w-40 rounded skeleton mb-3" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-xl skeleton" />)}
        </div>
      </div>
    );
  }

  if (error || !data) return null;

  // No deployments recorded — explain what the DORA cards above are actually
  // measuring, rather than leaving the reader to assume they are exact.
  if (data.source === "none") {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex items-start gap-3">
          <span className="shrink-0 w-9 h-9 rounded-lg border border-slate-700 bg-slate-800/60 flex items-center justify-center">
            <Rocket className="w-4 h-4 text-slate-400" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-white">Deployments</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              This repository has no deployments recorded through GitHub&apos;s Deployments API in
              the last {data.period_days} days, so the DORA figures above are{" "}
              <strong className="text-slate-400">estimated</strong>: deployment frequency from
              releases (or merged PRs when there are no releases), and change failure rate from PRs
              whose branch looks like a hotfix or revert.
            </p>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              If your pipeline creates GitHub deployments, those numbers become measured instead —
              actual deploys, actual failed rollouts, actual recovery time.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Honour the saved choice only if that environment still exists in the
  // window; otherwise fall back to auto-detection rather than showing blanks.
  const activeEnv =
    (selected && data.by_environment.some((e) => e.environment === selected) ? selected : null) ??
    data.production_environment;

  const activeStat = data.by_environment.find((e) => e.environment === activeEnv) ?? null;
  const isOverridden = activeEnv !== data.production_environment;

  // With a selection the figures come from that environment's own stats; with
  // none they come from the server's headline, which is the same computation.
  const deploysPerDay = activeStat ? activeStat.deploys_per_day : data.deploys_per_day;
  const cfr = activeStat ? activeStat.failure_rate_pct : data.change_failure_rate_pct;
  const mttrHours = activeStat ? activeStat.mttr_hours : data.mttr_hours;
  const mttrSamples = activeStat ? activeStat.mttr_samples : data.mttr_samples;

  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] overflow-hidden">
      <div className="flex items-start gap-4 p-5 border-b border-emerald-500/15">
        <span className="shrink-0 w-9 h-9 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.12] flex items-center justify-center">
          <Rocket className="w-4 h-4 text-emerald-300" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[15px] font-semibold text-white">Deployments</h3>
            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
              Measured
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            From GitHub&apos;s Deployments API — actual rollouts, not inferred from releases or
            branch names.
            {activeEnv && (
              <>
                {" "}Showing <span className="font-mono text-slate-400">{activeEnv}</span>
                {isOverridden ? " (your choice)" : " (auto-detected)"} — pick another below.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric
            label="Deploys / day"
            value={deploysPerDay !== null ? deploysPerDay.toFixed(2) : "—"}
            note="successful deploys"
            tone="emerald"
          />
          <Metric
            label="Change fail rate"
            value={cfr !== null ? `${cfr}%` : "—"}
            note={cfr === null ? "no conclusive deploys" : "failed / conclusive"}
            tone={cfr === null ? "slate" : cfr >= 15 ? "red" : cfr >= 5 ? "amber" : "emerald"}
          />
          <Metric
            label="MTTR"
            value={mttrHours !== null ? `${mttrHours}h` : "—"}
            note={
              mttrSamples === 0
                ? "no failures to recover from"
                : `${mttrSamples} recovery${mttrSamples === 1 ? "" : "s"}`
            }
            tone="slate"
          />
          <Metric
            label="Total"
            value={String(data.total_deployments)}
            note={`${data.successful} ok · ${data.failed} failed`}
            tone="slate"
          />
        </div>

        {/* A single recovery is an anecdote, not a metric. Say so. */}
        {mttrSamples === 1 && (
          <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            MTTR is based on a single recovery — treat it as an anecdote rather than a trend.
          </p>
        )}

        {data.by_environment.length > 1 && (
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500 mb-2">
              By environment — click to use for the figures above
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {data.by_environment.map((env) => {
                const active = env.environment === activeEnv;
                return (
                  <button
                    key={env.environment}
                    onClick={() => chooseEnvironment(env.environment)}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-3 px-3.5 py-2.5 rounded-xl border text-left transition-colors",
                      active
                        ? "border-emerald-500/40 bg-emerald-500/[0.08]"
                        : "border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/50",
                    )}
                  >
                    <GitBranch className={cn("w-3.5 h-3.5 shrink-0", active ? "text-emerald-400" : "text-slate-500")} />
                    <span className={cn("font-mono text-xs truncate flex-1", active ? "text-emerald-100" : "text-slate-200")}>
                      {env.environment}
                    </span>
                    <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                      {env.total} deploy{env.total === 1 ? "" : "s"}
                      {env.failure_rate_pct !== null && ` · ${env.failure_rate_pct}% fail`}
                    </span>
                    {active && <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {data.recent.length > 0 && (
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500 mb-2">
              Recent
            </p>
            <div className="rounded-xl border border-slate-800 overflow-hidden">
              {data.recent.slice(0, 8).map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 px-3.5 py-2 border-b border-slate-800/60 last:border-b-0 text-xs"
                >
                  <StateDot state={d.state} />
                  <span className="font-mono text-slate-300 truncate w-24 shrink-0">
                    {d.environment}
                  </span>
                  <span className="font-mono text-slate-500 truncate flex-1">{d.ref || d.sha.slice(0, 7)}</span>
                  <span className="text-slate-600 shrink-0 tabular-nums">
                    {new Date(d.created_at).toLocaleDateString()}
                  </span>
                  {d.state === "success" && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                  {(d.state === "failure" || d.state === "error") && <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                  {(d.state === "pending" || d.state === "in_progress") && <Clock className="w-3 h-3 text-amber-400 shrink-0" />}
                </div>
              ))}
            </div>
          </div>
        )}

        {data.partial && (
          <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-slate-600" />
            More deployments exist than statuses were fetched for. The production environment is
            resolved first, so the headline figures are complete; other environments may show rates
            from a partial sample.
          </p>
        )}
      </div>
    </div>
  );
}

function Metric({
  label, value, note, tone,
}: {
  label: string; value: string; note: string; tone: "emerald" | "amber" | "red" | "slate";
}) {
  const color = {
    emerald: "text-emerald-400", amber: "text-amber-400",
    red: "text-red-400", slate: "text-slate-100",
  }[tone];
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500 mb-1.5">
        {label}
      </div>
      <div className={cn("font-mono text-2xl font-bold tabular-nums leading-none", color)}>{value}</div>
      <div className="text-[11px] text-slate-600 mt-1.5">{note}</div>
    </div>
  );
}
