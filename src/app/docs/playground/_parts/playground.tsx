"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FlaskConical, KeyRound, Play, X } from "lucide-react";
import { Callout } from "@/components/docs/Callout";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  LIVE_LIMITS, METRICS, PRODUCTION_LIMITS, runRecipe, type MetricId, type RecipeResult,
} from "@/lib/playground/recipes";
import {
  GitHubCallError, SAMPLE_NOW, SAMPLE_REPO, githubSource, sampleSource, validateRepoInput, validateTokenInput, type Exchange,
} from "@/lib/playground/source";
import { Column, CookPanel, CookedPanel, RawPanel } from "./panels";

type Mode = "sample" | "live";

type RunState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: RecipeResult; label: string }
  | { status: "error"; message: string; exchanges: Exchange[]; label: string };

const INPUT_CLS =
  "w-full h-9 px-3 rounded-control bg-panel border border-control-strong font-mono text-sm text-fg placeholder:text-faint focus:outline-none focus:border-brand-fg";

function errorState(e: unknown, label: string): RunState {
  if (e instanceof GitHubCallError) return { status: "error", message: e.message, exchanges: [e.exchange], label };
  return { status: "error", message: e instanceof Error ? e.message : "Something went wrong.", exchanges: [], label };
}

export default function Playground() {
  const [mode, setMode] = useState<Mode>("sample");
  const [metric, setMetric] = useState<MetricId>("dora");
  const [sampleRun, setSampleRun] = useState<RunState>({ status: "loading" });
  const [liveRun, setLiveRun] = useState<RunState>({ status: "idle" });

  // Live-mode inputs. The token lives ONLY in this component state: never
  // persisted, never put in a URL, never sent anywhere but api.github.com.
  const [token, setToken] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const liveAbort = useRef<AbortController | null>(null);

  // Sample mode: cook the bundled fixtures whenever the metric changes.
  useEffect(() => {
    if (mode !== "sample") return;
    const ac = new AbortController();
    const label = `${SAMPLE_REPO.owner}/${SAMPLE_REPO.repo} (sample)`;
    runRecipe(metric, { source: sampleSource(), ...SAMPLE_REPO, now: SAMPLE_NOW, limits: PRODUCTION_LIMITS, signal: ac.signal })
      .then((result) => { if (!ac.signal.aborted) setSampleRun({ status: "done", result, label }); })
      .catch((e) => { if (!ac.signal.aborted) setSampleRun(errorState(e, label)); });
    return () => ac.abort();
  }, [mode, metric]);

  // Abort any in-flight live run on unmount.
  useEffect(() => () => liveAbort.current?.abort(), []);

  function runLive(target: MetricId) {
    const o = owner.trim();
    const r = repo.trim();
    const invalid = validateRepoInput(o, r);
    if (invalid) return setFormError(invalid);
    const tokenError = validateTokenInput(token);
    if (tokenError) return setFormError(tokenError);
    setFormError(null);

    liveAbort.current?.abort();
    const ac = new AbortController();
    liveAbort.current = ac;
    const label = `${o}/${r}`;
    setLiveRun({ status: "loading" });
    runRecipe(target, { source: githubSource(token), owner: o, repo: r, now: Date.now(), limits: LIVE_LIMITS, signal: ac.signal })
      .then((result) => { if (!ac.signal.aborted) setLiveRun({ status: "done", result, label }); })
      .catch((e) => { if (!ac.signal.aborted) setLiveRun(errorState(e, label)); });
  }

  function clearToken() {
    liveAbort.current?.abort();
    setToken("");
    // Responses may contain private repository data — drop them with the token.
    setLiveRun({ status: "idle" });
  }

  function selectMetric(id: MetricId) {
    if (id === metric) return; // re-selecting must not reset state the effect won't refill
    setMetric(id);
    if (mode === "sample") setSampleRun({ status: "loading" });
    else {
      liveAbort.current?.abort();
      setLiveRun({ status: "idle" });
    }
  }

  const run = mode === "sample" ? sampleRun : liveRun;
  const info = METRICS.find((m) => m.id === metric)!;

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <Link href="/docs" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-white transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> GitDash Docs
        </Link>
        <div className="flex items-center gap-3 pb-4 border-b border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center shrink-0">
            <FlaskConical className="w-4 h-4 text-violet-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">GitHub API playground</h1>
            <p className="text-sm text-slate-400">
              What GitHub&apos;s REST API returns, what GitDash does with it, and the number you end up seeing.
            </p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl<Mode>
            label="Data source"
            value={mode}
            onChange={(m) => {
              if (m === mode) return;
              setMode(m);
              if (m === "sample") {
                // Leaving live mode: stop in-flight calls and drop private results.
                liveAbort.current?.abort();
                setLiveRun({ status: "idle" });
                setSampleRun({ status: "loading" });
              }
            }}
            options={[{ value: "sample", label: "Sample data" }, { value: "live", label: "Use your own token" }]}
          />
          <p className="text-xs text-slate-500">
            {mode === "sample"
              ? `Anonymized responses from a fictional repo, ${SAMPLE_REPO.owner}/${SAMPLE_REPO.repo}, captured ${new Date(SAMPLE_NOW).toISOString().slice(0, 16).replace("T", " ")} UTC. No network calls.`
              : "Your browser calls api.github.com directly."}
          </p>
        </div>

        {mode === "live" && (
          <form
            className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3"
            onSubmit={(e) => { e.preventDefault(); runLive(metric); }}
            autoComplete="off"
          >
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_2fr] gap-3">
              <label className="space-y-1">
                <span className="text-xs text-slate-400">Owner</span>
                <input className={INPUT_CLS} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="octo-org" autoComplete="off" spellCheck={false} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-slate-400">Repository</span>
                <input className={INPUT_CLS} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="my-service" autoComplete="off" spellCheck={false} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-slate-400 flex items-center gap-1"><KeyRound className="w-3 h-3" /> GitHub token</span>
                <div className="flex gap-2">
                  <input
                    className={INPUT_CLS}
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="github_pat_…"
                    aria-describedby="token-note"
                  />
                  <Button onClick={clearToken} disabled={!token && liveRun.status === "idle"} aria-label="Clear token and results">
                    <X className="w-3.5 h-3.5" /> Clear
                  </Button>
                </div>
              </label>
            </div>
            {formError && <p role="alert" className="text-xs text-status-fail-text">{formError}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" disabled={liveRun.status === "loading"}>
                <Play className="w-3.5 h-3.5" /> {liveRun.status === "loading" ? "Fetching…" : `Run ${info.label}`}
              </Button>
              <p id="token-note" className="text-xs text-slate-500 flex-1 min-w-[16rem]">
                The token stays in this browser tab&apos;s memory only — it is not saved, not put in the URL, and never sent to
                GitDash; requests go straight from your browser to api.github.com. Use a{" "}
                <a className="text-violet-300 hover:text-violet-200 underline" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
                  fine-grained token
                </a>{" "}
                with read-only access (Metadata, Contents, Pull requests, Actions). Fan-out is capped (≤ {LIVE_LIMITS.busFactorCommitDetail} detail calls per metric) to spare your rate limit.
              </p>
            </div>
          </form>
        )}

        {/* Metric tabs */}
        <div role="tablist" aria-label="Metric" className="flex flex-wrap gap-2">
          {METRICS.map((m) => (
            <button
              key={m.id}
              role="tab"
              type="button"
              aria-selected={metric === m.id}
              onClick={() => selectMetric(m.id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm border transition-colors",
                metric === m.id
                  ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
                  : "text-slate-400 border-slate-800 hover:text-white hover:bg-slate-800/60",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-400">{info.blurb}</p>
      </div>

      {/* Body */}
      {run.status === "idle" && (
        <Callout type="info" title="Ready">
          Enter an owner, repository and token, then run <strong>{info.label}</strong>. Switch back to Sample data any time — no token needed.
        </Callout>
      )}
      {run.status === "loading" && (
        <p className="text-sm text-slate-400" role="status">Cooking {info.label}…</p>
      )}
      {run.status === "error" && (
        <div className="space-y-4">
          <Callout type="danger" title={`Could not load ${run.label}`}>{run.message}</Callout>
          {run.exchanges.length > 0 && (
            <Column title="Raw GitHub response" subtitle="The request that failed">
              <RawPanel exchanges={run.exchanges} />
            </Column>
          )}
        </div>
      )}
      {run.status === "done" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">Repository: <span className="font-mono text-slate-300">{run.label}</span></p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <Column title="1 · Raw — GitHub REST" subtitle="Exactly what api.github.com returns">
              <RawPanel exchanges={run.result.exchanges} />
            </Column>
            <Column title="2 · Cooking" subtitle="The production code path, step by step">
              <CookPanel steps={run.result.steps} caveats={run.result.caveats} />
            </Column>
            <Column title="3 · Cooked — GitDash" subtitle="The numbers GitDash shows">
              <CookedPanel groups={run.result.cooked} />
            </Column>
          </div>
        </div>
      )}
    </div>
  );
}
