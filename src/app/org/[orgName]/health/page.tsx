"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { Breadcrumb } from "@/components/Sidebar";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import { LEVEL_COLORS, LEVEL_LABELS } from "@/lib/dora";
import type { OrgHealthScorecardResponse, RepoScorecardEntry } from "@/app/api/github/org-health-scorecard/route";
import {
  Building2, ShieldCheck, TrendingUp, TrendingDown, Minus,
  ExternalLink, AlertTriangle, ChevronRight, Info, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Band = RepoScorecardEntry["risk_band"];
type FilterKey = "all" | Band;
type SortKey = "score" | "crit" | "name";

// Design reference: claude.ai/design "Scorecard board redesign" project,
// adapted to the app's existing Geist typography and DORA color tokens.
const BAND_ORDER: Band[] = ["at_risk", "watch", "healthy"];

const RISK_META: Record<Band, {
  label: string; text: string; textSoft: string; bg: string; border: string;
  dot: string; ringHex: string; barGrad: string; groupBg: string;
  hint: string;
}> = {
  at_risk: {
    label: "At Risk", text: "text-red-400", textSoft: "text-red-300/80",
    bg: "bg-red-500/[0.06]", border: "border-red-500/20", dot: "bg-red-400",
    ringHex: "#f87171", barGrad: "bg-gradient-to-r from-red-500 to-red-400",
    groupBg: "bg-gradient-to-r from-red-500/[0.08] via-red-500/[0.02] to-transparent",
    hint: "Single-owner risk — assign a second maintainer",
  },
  watch: {
    label: "Watch", text: "text-amber-400", textSoft: "text-amber-300/80",
    bg: "bg-amber-500/[0.06]", border: "border-amber-500/20", dot: "bg-amber-400",
    ringHex: "#fbbf24", barGrad: "bg-gradient-to-r from-amber-500 to-amber-400",
    groupBg: "bg-gradient-to-r from-amber-500/[0.07] via-amber-500/[0.02] to-transparent",
    hint: "Thin coverage or slipping throughput",
  },
  healthy: {
    label: "Healthy", text: "text-emerald-400", textSoft: "text-emerald-300/80",
    bg: "bg-emerald-500/[0.06]", border: "border-emerald-500/20", dot: "bg-emerald-400",
    ringHex: "#34d399", barGrad: "bg-gradient-to-r from-emerald-500 to-emerald-400",
    groupBg: "bg-gradient-to-r from-emerald-500/[0.07] via-emerald-500/[0.02] to-transparent",
    hint: "Sustainable ownership and delivery",
  },
};

const GRID_COLS = "minmax(180px,1.4fr) 92px 130px 120px 120px 168px";

function busTone(bus: number): Band {
  if (bus <= 1) return "at_risk";
  if (bus === 2) return "watch";
  return "healthy";
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function TrendGlyph({ trend }: { trend: RepoScorecardEntry["trend"] }) {
  if (trend === "up") return <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  if (trend === "down") return <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  return <Minus className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
}

// ── Header: estate distribution card ───────────────────────────────────────────

function EstateDistribution({ counts, total }: { counts: Record<Band, number>; total: number }) {
  return (
    <div className="flex flex-col gap-3 min-w-[280px] px-4 py-3.5 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/70 to-slate-950/80 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)]">
      <div className="flex items-baseline justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">Estate distribution</span>
        <span className="font-mono text-xs text-slate-400">{total} repos</span>
      </div>
      <div className="flex gap-[3px] h-2">
        {BAND_ORDER.map((band) => counts[band] > 0 && (
          <div
            key={band}
            className={cn("rounded-sm", RISK_META[band].barGrad)}
            style={{ flex: counts[band], boxShadow: `0 0 12px -3px ${RISK_META[band].ringHex}` }}
          />
        ))}
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        {BAND_ORDER.map((band) => (
          <div key={band} className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className={cn("w-1.5 h-1.5 rounded-full", RISK_META[band].dot)} />
            <span>{RISK_META[band].label}</span>
            <span className={cn("font-mono", RISK_META[band].text)}>{counts[band]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stat tiles ────────────────────────────────────────────────────────────────

function StatTile({ label, value, note, tone }: { label: string; value: number; note: string; tone: Band | "neutral" }) {
  const meta = tone === "neutral"
    ? { text: "text-slate-100", barGrad: "bg-gradient-to-r from-slate-500 to-slate-400" }
    : RISK_META[tone];
  return (
    <div className="relative overflow-hidden flex flex-col gap-3 px-4 py-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/60 to-slate-950/70 shadow-[0_20px_44px_-32px_rgba(0,0,0,0.95)]">
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", meta.barGrad)} />
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className={cn("font-mono text-3xl font-bold tabular-nums leading-none tracking-tight", meta.text)}>{value}</span>
        <span className="text-[11px] text-slate-500">{note}</span>
      </div>
    </div>
  );
}

// ── Filter / sort toolbar ────────────────────────────────────────────────────

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors border",
        active
          ? "bg-gradient-to-b from-slate-700/80 to-slate-800/80 border-slate-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          : "bg-transparent border-transparent text-slate-500 hover:text-slate-300",
      )}
    >
      {children}
    </button>
  );
}

// ── Group header ──────────────────────────────────────────────────────────────

function GroupHeader({ band, count }: { band: Band; count: number }) {
  const meta = RISK_META[band];
  return (
    <div className={cn("flex items-center gap-2.5 px-5 py-2.5 border-y border-slate-800/80", meta.groupBg)}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", meta.dot)} style={{ boxShadow: `0 0 8px ${meta.ringHex}` }} />
      <span className={cn("text-[11px] font-semibold uppercase tracking-[0.12em]", meta.text)}>{meta.label}</span>
      <span className={cn("font-mono text-[11px] px-1.5 py-0.5 rounded border", meta.border, meta.text)}>{count}</span>
      <div className="flex-1 h-px bg-gradient-to-r from-slate-800 to-transparent" />
      <span className="text-[11.5px] text-slate-500 whitespace-nowrap hidden sm:inline">{meta.hint}</span>
    </div>
  );
}

// ── Repo row ──────────────────────────────────────────────────────────────────

function RepoRow({ entry }: { entry: RepoScorecardEntry }) {
  const risk = RISK_META[entry.risk_band];
  const doraMeta = LEVEL_COLORS[entry.dora_level];
  const bus = RISK_META[busTone(entry.overall_bus_factor)];
  const critTone: "none" | "warn" | "danger" =
    entry.critical_modules === 0 ? "none" : entry.critical_modules > 5 ? "danger" : "warn";
  const critLabel = entry.critical_modules === 0
    ? "none"
    : `${entry.critical_modules} module${entry.critical_modules === 1 ? "" : "s"}`;
  const trendLabel = entry.trend === "up" ? "rising" : entry.trend === "down" ? "falling" : "flat";
  const trendColor = entry.trend === "up" ? "text-emerald-400" : entry.trend === "down" ? "text-red-400" : "text-slate-500";
  const pct = Math.max(2, Math.min(100, entry.composite_score));

  return (
    <Link
      href={`/repos/${entry.owner}/${entry.repo}`}
      className="group relative grid items-center gap-3 px-5 py-3 border-b border-slate-800/60 last:border-b-0 transition-colors hover:bg-slate-800/40"
      style={{ gridTemplateColumns: GRID_COLS }}
    >
      <span className={cn("absolute inset-y-0 left-0 w-[2px]", risk.barGrad)} />

      <div className="min-w-0 flex items-center gap-1.5">
        <span className="font-mono text-[13.5px] font-medium text-slate-100 group-hover:text-white transition-colors truncate">
          {entry.repo}
        </span>
        {entry.partial && (
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" aria-label="Computed from partial data" />
        )}
      </div>

      <span className={cn("justify-self-start text-[11px] font-medium uppercase tracking-wide px-2 py-1 rounded-md border", doraMeta.bg, doraMeta.text, doraMeta.border)}>
        {LEVEL_LABELS[entry.dora_level]}
      </span>

      <div className="flex items-center gap-2">
        <span className={cn("font-mono text-[13.5px]", entry.overall_bus_factor <= 1 ? "text-red-400" : "text-slate-200")}>
          {entry.overall_bus_factor}
        </span>
        <div className="flex gap-[3px]">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn("w-[3px] h-3.5 rounded-sm", i < entry.overall_bus_factor ? bus.dot : "bg-slate-800")}
            />
          ))}
        </div>
      </div>

      <span
        className={cn(
          "font-mono text-xs whitespace-nowrap",
          critTone === "none" ? "text-slate-500" : critTone === "danger" ? "text-red-400" : "text-amber-300",
        )}
      >
        {critLabel}
      </span>

      <div className={cn("flex items-center gap-1.5 text-xs whitespace-nowrap", trendColor)}>
        <TrendGlyph trend={entry.trend} /> {trendLabel}
      </div>

      <div className="flex items-center justify-end gap-2.5">
        <div className="relative w-14 h-1 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full", risk.barGrad)}
            style={{ width: `${pct}%`, boxShadow: `0 0 8px -1px ${risk.ringHex}` }}
          />
        </div>
        <span className="font-mono text-xl font-bold tracking-tight text-white w-8 text-right tabular-nums">
          {entry.composite_score}
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-slate-700 group-hover:text-slate-400 transition-colors shrink-0" />
      </div>
    </Link>
  );
}

function ScorecardSkeleton({ limit }: { limit: number }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] text-sm text-violet-200">
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        <span>
          Collecting data across up to {limit} repositories — a DORA + bus-factor check runs per repo, usually a few seconds…
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[92px] rounded-2xl skeleton" />
        ))}
      </div>
      <div className="h-[400px] rounded-2xl skeleton" />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OrgHealthScorecardPage({
  params,
}: {
  params: Promise<{ orgName: string }>;
}) {
  const { orgName } = use(params);
  const { flags } = useFeatureFlags();
  const [limit, setLimit] = useState(10);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("score");

  const { data, error, isLoading } = useSWR<OrgHealthScorecardResponse>(
    flags.healthScorecard
      ? `/api/github/org-health-scorecard?org=${encodeURIComponent(orgName)}&limit=${limit}`
      : null,
    fetcher<OrgHealthScorecardResponse>,
  );

  const repos = useMemo(() => data?.repos ?? [], [data]);

  const counts = useMemo<Record<Band, number>>(() => ({
    at_risk: repos.filter((r) => r.risk_band === "at_risk").length,
    watch: repos.filter((r) => r.risk_band === "watch").length,
    healthy: repos.filter((r) => r.risk_band === "healthy").length,
  }), [repos]);

  const medianScore = useMemo(() => median(repos.map((r) => r.composite_score)), [repos]);

  const groups = useMemo(() => {
    const sorters: Record<SortKey, (a: RepoScorecardEntry, b: RepoScorecardEntry) => number> = {
      score: (a, b) => a.composite_score - b.composite_score,
      crit: (a, b) => b.critical_modules - a.critical_modules,
      name: (a, b) => a.repo.localeCompare(b.repo),
    };
    const filtered = repos.filter((r) => filter === "all" || r.risk_band === filter);
    const sorted = [...filtered].sort(sorters[sort]);
    return BAND_ORDER
      .map((band) => ({ band, rows: sorted.filter((r) => r.risk_band === band) }))
      .filter((g) => g.rows.length > 0);
  }, [repos, filter, sort]);

  const total = repos.length;

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <Breadcrumb
        items={[
          { label: "Repositories", href: "/" },
          { label: orgName, href: `/org/${orgName}` },
          { label: "Team Health" },
        ]}
      />

      <div className="flex items-start justify-between gap-8 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.9)]" />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-slate-500">{orgName}</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Team Health Scorecard</h1>
            <p className="text-sm text-slate-400 max-w-md mt-1">
              Composite of 60% DORA tier and 40% bus-factor risk. Trend compares recent against prior throughput.
            </p>
          </div>
        </div>

        {data && total > 0 && <EstateDistribution counts={counts} total={total} />}
      </div>

      {!flags.healthScorecard ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-800 bg-slate-900/30 text-sm text-slate-500">
          <span>Team Health Scorecard is disabled —</span>
          <a href="/settings" className="text-violet-400 hover:underline">Enable in Settings → Feature Flags</a>
        </div>
      ) : (
        <>
          {isLoading && <ScorecardSkeleton limit={limit} />}

          {error && (
            <div className="px-4 py-3 rounded-xl border border-red-500/25 bg-red-500/10 text-sm text-red-300">
              {error.message ?? "Failed to load the health scorecard"}
            </div>
          )}

          {data && total === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
              <Building2 className="w-8 h-8 text-slate-600" />
              <p className="text-sm text-slate-500">No repos with enough activity to score yet.</p>
            </div>
          )}

          {data && total > 0 && (
            <>
              {/* Stat tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile label="At Risk" value={counts.at_risk} note={`${Math.round((counts.at_risk / total) * 100)}% of estate`} tone="at_risk" />
                <StatTile label="Watch" value={counts.watch} note={`${Math.round((counts.watch / total) * 100)}% of estate`} tone="watch" />
                <StatTile label="Healthy" value={counts.healthy} note={`${Math.round((counts.healthy / total) * 100)}% of estate`} tone="healthy" />
                <StatTile label="Median Score" value={medianScore} note="of 100" tone="neutral" />
              </div>

              {/* Toolbar */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-800 bg-slate-900/60 flex-wrap">
                  <Pill active={filter === "all"} onClick={() => setFilter("all")}>
                    All <span className="ml-1.5 font-mono text-[11px] opacity-60">{total}</span>
                  </Pill>
                  {BAND_ORDER.map((band) => (
                    <Pill key={band} active={filter === band} onClick={() => setFilter(band)}>
                      {RISK_META[band].label} <span className="ml-1.5 font-mono text-[11px] opacity-60">{counts[band]}</span>
                    </Pill>
                  ))}
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-slate-500">Sort</span>
                    <div className="flex items-center gap-1">
                      <Pill active={sort === "score"} onClick={() => setSort("score")}>Lowest score</Pill>
                      <Pill active={sort === "crit"} onClick={() => setSort("crit")}>Most critical</Pill>
                      <Pill active={sort === "name"} onClick={() => setSort("name")}>A–Z</Pill>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] uppercase tracking-wide text-slate-500">Analysed</label>
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
              </div>

              {data.repos_analysed < data.repos_attempted && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Scored {data.repos_analysed}/{data.repos_attempted} repos — the rest failed to fetch (rate limit or access).
                </div>
              )}

              {/* Grouped table */}
              <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/50 to-slate-950/70 shadow-[0_40px_80px_-50px_rgba(0,0,0,1)] overflow-hidden">
                <div className="overflow-x-auto">
                  <div className="min-w-[820px]">
                    <div
                      className="grid items-center gap-3 px-5 py-2.5 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"
                      style={{ gridTemplateColumns: GRID_COLS }}
                    >
                      <div>Repository</div>
                      <div>DORA</div>
                      <div>Bus factor</div>
                      <div>Critical</div>
                      <div>Trend</div>
                      <div className="text-right">Composite</div>
                    </div>

                    {groups.length === 0 && (
                      <div className="px-5 py-10 text-center text-sm text-slate-500">No repos match this filter.</div>
                    )}

                    {groups.map(({ band, rows }) => (
                      <div key={band}>
                        <GroupHeader band={band} count={rows.length} />
                        {rows.map((entry) => (
                          <RepoRow key={`${entry.owner}/${entry.repo}`} entry={entry} />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 flex-wrap text-xs text-slate-500">
                <div className="flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  Bus factor counts contributors carrying more than half of recent changes; critical modules have a single owner.
                </div>
                <a
                  href={`https://github.com/${encodeURIComponent(orgName)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-violet-400 transition-colors"
                >
                  View {orgName} on GitHub <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
