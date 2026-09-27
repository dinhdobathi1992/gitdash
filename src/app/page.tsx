"use client";

/**
 * Repositories (home) — `Main` and `Mobile` artboards, design contract §9.
 * Header with range + Health scorecard · fleet KPI strip · attention list ·
 * repository table (filter chips with counts, language, sort, density) with
 * keyboard control: `/` filter, ↑ ↓ move, ↵ open, `p` pin, `?` shortcuts.
 */

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, ShieldCheck, X, Rows3, Rows4 } from "lucide-react";
import { fetcher } from "@/lib/swr";
import type { Repo } from "@/lib/github";
import { fuzzyMatch } from "@/lib/utils";
import { useWatchlist } from "@/lib/watchlist";
import { useAlerts } from "@/lib/use-alerts";
import { useRepoSummaries } from "@/lib/use-repo-summaries";
import { repoHealth } from "@/lib/repo-health";
import { fleetKpis, sortRepos, failingRepoAttention, RANGE_LABEL, SORT_LABEL, type Range, type SortKey } from "@/lib/fleet";
import { AttentionList, buildAttentionRows } from "@/components/MissionControl";
import { FleetKpiStrip } from "@/components/home/FleetKpiStrip";
import { RepoTable, RepoCards, type Density } from "@/components/home/RepoTable";
import { Page, PageHeading } from "@/components/ui/PageHeading";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { FilterChip } from "@/components/ui/FilterChip";
import { Button, LinkButton } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/Card";

const PAGE_SIZE = 10;
const DENSITY_KEY = "gitdash:density";
type Chip = "all" | "failing" | "running" | "pinned";

const SHORTCUTS = [
  { keys: ["⌘", "K"], description: "Search everything" },
  { keys: ["/"], description: "Filter repositories" },
  { keys: ["↑", "↓"], description: "Move through the list" },
  { keys: ["↵"], description: "Open the selected repository" },
  { keys: ["p"], description: "Pin or unpin the selected repository" },
  { keys: ["?"], description: "Show these shortcuts" },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-chip border border-control bg-panel font-mono text-xs text-muted">
      {children}
    </kbd>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="w-full max-w-sm float-card !rounded-panel p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 id="shortcuts-title" className="text-[15px] font-semibold text-fg">Keyboard shortcuts</h2>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="text-muted hover:text-fg">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <ul className="space-y-3">
          {SHORTCUTS.map(({ keys, description }) => (
            <li key={description} className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted">{description}</span>
              <span className="flex items-center gap-1 shrink-0">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgParam = searchParams.get("org");

  const reposUrl = orgParam ? `/api/github/org-repos?org=${orgParam}` : "/api/github/repos";
  const { data: repos, error, isLoading, mutate: mutateRepos } = useSWR<Repo[]>(reposUrl, fetcher<Repo[]>);
  const { summaries, isLoading: summariesLoading, capped } = useRepoSummaries(repos);
  const { firing, now, isLoading: alertsLoading } = useAlerts();
  const { pinned, isPinned, toggle } = useWatchlist();

  const [range, setRange] = useState<Range>("30d");
  const [search, setSearch] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const [lang, setLang] = useState<string>("");
  const [sort, setSort] = useState<SortKey>("attention");
  const [density, setDensity] = useState<Density>("comfortable");
  const [pageState, setPageState] = useState<{ page: number; key: string }>({ page: 1, key: "" });
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  // Remembered density — read once after mount so SSR and hydration agree.
  useEffect(() => {
    try {
      const d = localStorage.getItem(DENSITY_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (d === "compact") setDensity("compact");
    } catch { /* storage blocked */ }
  }, []);
  function changeDensity(d: Density) {
    setDensity(d);
    try { localStorage.setItem(DENSITY_KEY, d); } catch { /* storage blocked */ }
  }

  const all = useMemo(() => repos ?? [], [repos]);
  const languages = useMemo(() => [...new Set(all.map((r) => r.language).filter((l): l is string => !!l))].sort(), [all]);

  const healthOf = useCallback((r: Repo) => {
    const s = summaries.get(r.full_name);
    return s ? repoHealth(s, now).key : null;
  }, [summaries, now]);

  const counts = useMemo(() => ({
    all: all.length,
    failing: all.filter((r) => healthOf(r) === "failing").length,
    running: all.filter((r) => { const h = healthOf(r); return h === "running" || h === "queued"; }).length,
    pinned: all.filter((r) => pinned.includes(r.full_name)).length,
  }), [all, healthOf, pinned]);

  const filtered = useMemo(() => {
    const q = search.trim();
    const byChip = all.filter((r) => {
      if (lang && r.language !== lang) return false;
      if (chip === "failing") return healthOf(r) === "failing";
      if (chip === "running") { const h = healthOf(r); return h === "running" || h === "queued"; }
      if (chip === "pinned") return pinned.includes(r.full_name);
      return true;
    });
    const sorted = sortRepos(byChip, summaries, sort, now);
    if (!q) return sorted.map((repo) => ({ repo, nameIndices: [] as number[] }));
    return sorted.flatMap((repo) => {
      const onName = fuzzyMatch(repo.name, q);
      if (onName.match) return [{ repo, nameIndices: onName.indices }];
      if (fuzzyMatch(repo.full_name, q).match || fuzzyMatch(repo.description ?? "", q).match) return [{ repo, nameIndices: [] }];
      return [];
    });
  }, [all, search, lang, chip, healthOf, pinned, summaries, sort, now]);

  const filterKey = `${search}|${lang}|${chip}|${sort}|${orgParam}`;
  const page = pageState.key === filterKey ? pageState.page : 1;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = useMemo(() => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [filtered, safePage]);
  const setPage = (p: number) => { setPageState({ page: p, key: filterKey }); setActiveIndex(-1); };
  const active = Math.min(activeIndex, paginated.length - 1);

  const summaryList = useMemo(() => [...summaries.values()], [summaries]);
  const kpis = useMemo(() => (summaryList.length ? fleetKpis(summaryList, range, now) : null), [summaryList, range, now]);
  const attention = useMemo(
    () => buildAttentionRows(firing, failingRepoAttention(all, summaries, now), now),
    [firing, all, summaries, now],
  );
  const activeRepos = summaryList.filter((s) => (s.runs_30d ?? s.recent_runs.length) > 0).length;

  // Keyboard: contract §8 — `/` filter, ↑ ↓ move, ↵ open, p pin, ? help.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement).isContentEditable) return;
      if (e.key === "/") { e.preventDefault(); filterRef.current?.focus(); }
      else if (e.key === "?") { e.preventDefault(); setShowShortcuts((v) => !v); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, paginated.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter" && active >= 0 && paginated[active]) {
        const { repo } = paginated[active];
        router.push(`/repos/${repo.owner}/${repo.name}`);
      } else if (e.key.toLowerCase() === "p" && active >= 0 && paginated[active]) {
        toggle(paginated[active].repo.full_name);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paginated, active, router, toggle]);

  function onFilterKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { if (search) setSearch(""); else filterRef.current?.blur(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, paginated.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && active >= 0 && paginated[active]) {
      const { repo } = paginated[active];
      router.push(`/repos/${repo.owner}/${repo.name}`);
    }
  }

  const meta = isLoading
    ? "Loading repositories…"
    : [
        `${all.length} repositories`,
        summariesLoading ? null : `${activeRepos} running GitHub Actions`,
        RANGE_LABEL[range],
      ].filter(Boolean).join(" · ");

  const phoneMeta = kpis?.current.successRate != null
    ? `${kpis.current.successRate.toFixed(1)}% success · ${kpis.current.runs.toLocaleString()} runs · ${RANGE_LABEL[range]}`
    : meta;

  const footer = !isLoading && filtered.length > 0 && (
    <div className="flex items-center justify-between gap-4 px-5 h-14 border-t border-line bg-panel/40 text-[13px] text-muted">
      <div className="flex items-center gap-5 min-w-0">
        <span className="whitespace-nowrap">
          Showing <span className="font-mono text-fg">{(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)}</span> of{" "}
          <span className="font-mono text-fg">{filtered.length}</span>
        </span>
        <span className="hidden lg:flex items-center gap-1.5 text-xs text-faint">
          <Kbd>/</Kbd> filter · <Kbd>↑↓</Kbd> move · <Kbd>↵</Kbd> open · <Kbd>p</Kbd> pin
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}>Previous</Button>
        <Button size="sm" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}>Next</Button>
      </div>
    </div>
  );

  return (
    <Page>
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}

      <PageHeading
        title="Repositories"
        meta={<><span className="hidden sm:inline">{meta}</span><span className="sm:hidden">{phoneMeta}</span></>}
        actions={
          <>
            <SegmentedControl
              label="Time range"
              value={range}
              onChange={setRange}
              options={(["24h", "7d", "30d", "90d"] as Range[]).map((r) => ({ value: r, label: r }))}
              className="hidden sm:inline-flex"
            />
            {orgParam && (
              <LinkButton href={`/org/${encodeURIComponent(orgParam)}/health`} className="hidden sm:inline-flex">
                <ShieldCheck className="w-4 h-4 text-brand-fg" aria-hidden="true" /> Health scorecard
              </LinkButton>
            )}
          </>
        }
      />

      {error && (
        <ErrorBanner
          message={(error as Error).message ? `Couldn't load repositories: ${(error as Error).message}` : "Couldn't load repositories."}
          onRetry={() => mutateRepos()}
        />
      )}

      {/* Fleet KPIs (desktop and tablet) */}
      <div className="hidden sm:block">
        <FleetKpiStrip kpis={kpis} range={range} loading={isLoading || summariesLoading} />
        {capped && !summariesLoading && (
          <p className="mt-2 text-xs text-faint">
            Figures cover the 50 most recently updated repositories, from each one&apos;s 30 latest runs.
          </p>
        )}
        {!capped && range === "90d" && !summariesLoading && (
          <p className="mt-2 text-xs text-faint">Each repository contributes its 30 latest runs, so busy repositories are under-counted over 90 days.</p>
        )}
      </div>

      <AttentionList rows={attention} now={now} loading={alertsLoading && summariesLoading} className="hidden sm:block" />
      <AttentionList rows={attention} now={now} loading={alertsLoading && summariesLoading} max={2} compact className="sm:hidden" />

      {/* ── All repositories ── */}
      <section aria-labelledby="all-repos" className="flex flex-col gap-3">
        <div className="hidden sm:flex items-center gap-3 flex-wrap">
          <h2 id="all-repos" className="text-[15px] font-semibold text-fg mr-1">All repositories</h2>
          <div className="relative w-full sm:w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none" aria-hidden="true" />
            <label htmlFor="repo-filter" className="sr-only">Filter repositories by name</label>
            <input
              id="repo-filter"
              ref={filterRef}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setActiveIndex(-1); }}
              onKeyDown={onFilterKey}
              placeholder="Filter by name"
              className="w-full h-[34px] pl-9 pr-8 rounded-control bg-panel border border-control-strong text-[13px] text-fg placeholder:text-faint focus:outline-none focus:border-brand-fg"
            />
            {search ? (
              <button type="button" onClick={() => { setSearch(""); filterRef.current?.focus(); }} aria-label="Clear filter" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-faint hover:text-fg">
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-faint" aria-hidden="true">/</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by status">
            <FilterChip pressed={chip === "all"} onClick={() => setChip("all")} count={counts.all}>All</FilterChip>
            <FilterChip pressed={chip === "failing"} onClick={() => setChip("failing")} count={counts.failing}>Failing</FilterChip>
            <FilterChip pressed={chip === "running"} onClick={() => setChip("running")} count={counts.running}>Running</FilterChip>
            <FilterChip pressed={chip === "pinned"} onClick={() => setChip("pinned")} count={counts.pinned}>Pinned</FilterChip>
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Language
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="w-28 h-[34px] pl-2.5 pr-8 rounded-control bg-panel border border-control-strong text-[13px] text-fg focus:outline-none focus:border-brand-fg"
              >
                <option value="">Any</option>
                {languages.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="w-[184px] h-[34px] pl-2.5 pr-8 rounded-control bg-panel border border-control-strong text-[13px] text-fg focus:outline-none focus:border-brand-fg"
              >
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
              </select>
            </label>
            <Button
              size="icon"
              aria-label={density === "comfortable" ? "Switch to compact rows" : "Switch to comfortable rows"}
              title={density === "comfortable" ? "Compact rows" : "Comfortable rows"}
              aria-pressed={density === "compact"}
              onClick={() => changeDensity(density === "comfortable" ? "compact" : "comfortable")}
              className="h-[34px] w-[34px]"
            >
              {density === "comfortable" ? <Rows4 className="w-4 h-4" /> : <Rows3 className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Phone: segmented filter + cards */}
        <div className="sm:hidden flex flex-col gap-3">
          <h2 className="sr-only">All repositories</h2>
          <SegmentedControl
            label="Filter repositories"
            size="lg"
            value={chip === "running" ? "all" : chip}
            onChange={(v) => setChip(v as Chip)}
            options={[
              { value: "all", label: `All ${counts.all}` },
              { value: "failing", label: `Failing ${counts.failing}` },
              { value: "pinned", label: `Pinned ${counts.pinned}` },
            ]}
            className="w-full"
          />
          {isLoading ? <div className="card h-64 skeleton" /> : <RepoCards rows={paginated} summaries={summaries} now={now} />}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted">
              <Button size="sm" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} className="h-11 px-4">Previous</Button>
              <span className="font-mono">{safePage} / {totalPages}</span>
              <Button size="sm" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="h-11 px-4">Next</Button>
            </div>
          )}
        </div>

        <div className="hidden sm:block">
          <RepoTable
            rows={paginated}
            summaries={summaries}
            activeIndex={active}
            isPinned={isPinned}
            onTogglePin={toggle}
            density={density}
            now={now}
            loading={isLoading}
            footer={footer}
          />
        </div>
      </section>
    </Page>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="px-10 pt-8 text-sm text-muted">Loading…</div>}>
      <HomeContent />
    </Suspense>
  );
}
