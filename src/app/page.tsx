"use client";

import {
  useRef, useEffect, useState, useMemo, useCallback, Suspense,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { fetcher } from "@/lib/swr";
import { Repo, GitHubOrg, RepoSummary } from "@/lib/github";
import { useAuth } from "@/components/AuthProvider";
import { formatDistanceToNow } from "date-fns";
import {
  Search, Lock, Unlock, AlertCircle, ChevronRight, ChevronLeft,
  RefreshCw, Building2, User, ChevronDown, X, GitCommit,
  AlertTriangle, Keyboard,
} from "lucide-react";
import { cn, fuzzyMatch, highlightSegments } from "@/lib/utils";
import { RunHistoryBars, TrendSparkline, StatusBadge, HealthBadge } from "@/components/WorkflowMetrics";

// ── Keyboard shortcuts modal ───────────────────────────────────────────────────
const SHORTCUTS = [
  { keys: ["/"], description: "Focus search" },
  { keys: ["Escape"], description: "Clear search / close modal" },
  { keys: ["↑", "↓"], description: "Navigate repository list" },
  { keys: ["Enter"], description: "Open selected repository" },
  { keys: ["?"], description: "Show keyboard shortcuts" },
];

function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Keyboard className="w-4 h-4 text-violet-400" />
            Keyboard Shortcuts
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors"
            aria-label="Close shortcuts modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          {SHORTCUTS.map(({ keys, description }) => (
            <div key={description} className="flex items-center justify-between gap-4">
              <span className="text-sm text-slate-400">{description}</span>
              <div className="flex items-center gap-1 shrink-0">
                {keys.map((k) => (
                  <kbd
                    key={k}
                    className="px-2 py-0.5 text-xs font-mono bg-slate-800 border border-slate-600 rounded text-slate-300"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-5 text-[11px] text-slate-600 text-center">
          Press <kbd className="px-1 py-0.5 text-[10px] font-mono bg-slate-800 border border-slate-700 rounded">?</kbd> or{" "}
          <kbd className="px-1 py-0.5 text-[10px] font-mono bg-slate-800 border border-slate-700 rounded">Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}

// ── Recent Failures widget ────────────────────────────────────────────────────
// Cutoff computed at module load to satisfy react-hooks/purity (no Date.now inside hooks)
const FAILURES_CUTOFF_MS = 24 * 60 * 60 * 1000;
const MODULE_LOAD_TIME = Date.now();

function RecentFailuresWidget({ repos }: { repos: Repo[] }) {
  const { cache } = useSWRConfig();
  const [dismissed, setDismissed] = useState(false);

  const failures = useMemo(() => {
    const result: Array<{ owner: string; name: string; run_at: string | null }> = [];
    const cutoff = MODULE_LOAD_TIME - FAILURES_CUTOFF_MS; // last 24h

    for (const repo of repos) {
      const key = `/api/github/repo-summary?owner=${repo.owner}&repo=${repo.name}`;
      const cached = cache.get(key);
      if (!cached?.data) continue;
      const summary = cached.data as RepoSummary;
      if (
        summary.latest_conclusion === "failure" ||
        summary.latest_conclusion === "cancelled"
      ) {
        const runAt = summary.latest_run_at ? new Date(summary.latest_run_at).getTime() : 0;
        if (runAt >= cutoff) {
          result.push({ owner: repo.owner, name: repo.name, run_at: summary.latest_run_at });
        }
      }
    }

    return result.slice(0, 5); // cap at 5
  }, [repos, cache]);

  if (dismissed || failures.length === 0) return null;

  return (
    <div className="mb-5 flex items-start gap-3 px-4 py-3 bg-red-500/8 border border-red-500/20 rounded-xl">
      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-red-300 mb-1.5">
          {failures.length} repo{failures.length > 1 ? "s" : ""} with recent failures (last 24h)
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {failures.map(({ owner, name, run_at }) => (
            <Link
              key={`${owner}/${name}`}
              href={`/repos/${owner}/${name}`}
              className="text-xs font-mono text-red-300/80 hover:text-red-200 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {owner}/{name}
              {run_at && (
                <span className="text-red-500/60 ml-1">
                  · {formatDistanceToNow(new Date(run_at))} ago
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-red-500/60 hover:text-red-300 transition-colors shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Highlighted text ──────────────────────────────────────────────────────────
function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  const segments = highlightSegments(text, indices);
  return (
    <>
      {segments.map((seg, i) =>
        seg.highlight
          ? <mark key={i} className="bg-transparent text-violet-300 font-semibold">{seg.text}</mark>
          : <span key={i}>{seg.text}</span>
      )}
    </>
  );
}

// ── Repo row — lazily fetches summary when row enters viewport ────────────────
function RepoRow({
  repo, nameIndices, active,
}: {
  repo: Repo;
  nameIndices: number[];
  active: boolean;
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  const [visible, setVisible] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { data: summary } = useSWR<RepoSummary>(
    visible ? `/api/github/repo-summary?owner=${repo.owner}&repo=${repo.name}` : null,
    fetcher<RepoSummary>
  );

  return (
    <tr
      ref={ref}
      className={cn(
        "group border-b border-slate-800 hover:bg-slate-800/50 transition-colors cursor-pointer",
        active && "bg-slate-800/60 ring-1 ring-inset ring-violet-500/30"
      )}
      onClick={() => router.push(`/repos/${repo.owner}/${repo.name}`)}
    >
      {/* Repository */}
      <td className="py-3.5 pl-5 pr-4">
        <div className="flex items-start gap-2.5">
          {repo.private
            ? <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
            : <Unlock className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <Link
              href={`/repos/${repo.owner}/${repo.name}`}
              className="text-sm font-semibold text-white hover:text-violet-300 transition-colors font-mono truncate block"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-slate-400">{repo.owner}/</span>
              <Highlighted text={repo.name} indices={nameIndices} />
            </Link>

            {/* Last commit line */}
            {summary?.latest_sha ? (
              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500">
                <GitCommit className="w-3 h-3 shrink-0" />
                <span className="font-mono">{summary.latest_sha}</span>
                {summary.latest_message && (
                  <span className="truncate max-w-[180px]">{summary.latest_message}</span>
                )}
                {summary.latest_actor && (
                  <span>by {summary.latest_actor}</span>
                )}
                {summary.latest_run_at && (
                  <span>{formatDistanceToNow(new Date(summary.latest_run_at))} ago</span>
                )}
              </div>
            ) : repo.updated_at ? (
              <p className="text-[11px] text-slate-600 mt-0.5">
                Updated {formatDistanceToNow(new Date(repo.updated_at))} ago
              </p>
            ) : null}
          </div>
        </div>
      </td>

      {/* Status */}
      <td className="py-3.5 px-4 w-36">
        <StatusBadge summary={summary} />
      </td>

      {/* Health */}
      <td className="py-3.5 px-4 w-36">
        <HealthBadge summary={summary} />
      </td>

      {/* Run History (10) */}
      <td className="py-3.5 px-4 w-48">
        {summary ? (
          <RunHistoryBars runs={summary.recent_runs} />
        ) : (
          <div className="flex items-end gap-0.5 h-6">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="w-2.5 h-2 rounded-sm bg-slate-800 animate-pulse" />
            ))}
          </div>
        )}
      </td>

      {/* Trend (30d) */}
      <td className="py-3.5 px-4 w-36">
        {summary ? (
          <TrendSparkline points={summary.trend_30d} />
        ) : (
          <div className="h-8 w-28 rounded bg-slate-800 animate-pulse" />
        )}
      </td>

      {/* Arrow */}
      <td className="py-3.5 pr-5 w-10 text-right">
        <Link
          href={`/repos/${repo.owner}/${repo.name}`}
          className="inline-flex text-slate-600 group-hover:text-slate-300 transition-colors"
          aria-label={`Open ${repo.name}`}
        >
          <ChevronRight className="w-4 h-4" />
        </Link>
      </td>
    </tr>
  );
}

// ── Table skeleton ────────────────────────────────────────────────────────────
function TableSkeleton() {
  return (
    <tbody>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="border-b border-slate-800">
          <td className="py-4 pl-5 pr-4">
            <div className="h-4 w-48 bg-slate-800 rounded animate-pulse mb-1.5" />
            <div className="h-3 w-64 bg-slate-800/60 rounded animate-pulse" />
          </td>
          <td className="py-4 px-4"><div className="h-5 w-16 bg-slate-800 rounded-full animate-pulse" /></td>
          <td className="py-4 px-4"><div className="h-5 w-12 bg-slate-800 rounded animate-pulse" /></td>
          <td className="py-4 px-4">
            <div className="flex items-end gap-0.5 h-6">
              {Array.from({ length: 10 }).map((_, j) => (
                <div key={j} className="w-2.5 h-full bg-slate-800 rounded-sm animate-pulse" />
              ))}
            </div>
          </td>
          <td className="py-4 px-4"><div className="h-8 w-28 bg-slate-800 rounded animate-pulse" /></td>
          <td className="py-4 pr-5" />
        </tr>
      ))}
    </tbody>
  );
}

// ── Org selector dropdown ─────────────────────────────────────────────────────
function OrgSelector({
  orgs, current, onSelect,
}: {
  orgs: GitHubOrg[];
  current: string | null;
  onSelect: (org: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = orgs.find((o) => o.login === current);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-slate-300 hover:text-white transition-colors"
      >
        {selected ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selected.avatar_url} alt={selected.login} width={16} height={16} className="w-4 h-4 rounded-sm" />
            <span className="font-mono">{selected.login}</span>
          </>
        ) : (
          <>
            <User className="w-4 h-4" />
            <span>Personal</span>
          </>
        )}
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 py-1">
          <button
            onClick={() => { onSelect(null); setOpen(false); }}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left",
              current === null ? "text-white bg-slate-700/50" : "text-slate-300 hover:text-white hover:bg-slate-700/30"
            )}
          >
            <User className="w-4 h-4 shrink-0" />
            <span>Personal repos</span>
          </button>

          {orgs.length > 0 && (
            <div className="my-1 border-t border-slate-700/50" />
          )}

          {orgs.map((org) => (
            <button
              key={org.login}
              onClick={() => { onSelect(org.login); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left",
                current === org.login ? "text-white bg-slate-700/50" : "text-slate-300 hover:text-white hover:bg-slate-700/30"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={org.avatar_url} alt={org.login} width={16} height={16} className="w-4 h-4 rounded-sm shrink-0" />
              <span className="font-mono truncate">{org.login}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Visibility filter ─────────────────────────────────────────────────────────
type VisibilityFilter = "all" | "public" | "private";

// ── Main home content ─────────────────────────────────────────────────────────
function HomeContent() {
  const { user } = useAuth();
  const { mutate } = useSWRConfig();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [langFilter, setLangFilter] = useState<string | null>(null);
  const [visFilter, setVisFilter] = useState<VisibilityFilter>("all");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const PAGE_SIZE = 20;
  const [pageState, setPageState] = useState<{ page: number; key: string }>({ page: 1, key: "" });
  const searchRef = useRef<HTMLInputElement>(null);

  const orgParam = searchParams.get("org");

  const { data: orgs } = useSWR<GitHubOrg[]>("/api/github/orgs", fetcher<GitHubOrg[]>);

  const reposUrl = orgParam
    ? `/api/github/org-repos?org=${orgParam}`
    : "/api/github/repos";

  const {
    data: repos, error, isLoading, isValidating, mutate: mutateRepos,
  } = useSWR<Repo[]>(reposUrl, fetcher<Repo[]>);

  const displayed = useMemo(() => repos ?? [], [repos]);

  // Available languages for filter pills
  const languages = useMemo(() => {
    const langs = new Set<string>();
    for (const r of displayed) if (r.language) langs.add(r.language);
    return [...langs].sort();
  }, [displayed]);

  // Fuzzy + filter pipeline
  type Match = { repo: Repo; nameIndices: number[] };

  const effectiveLangFilter = langFilter && languages.includes(langFilter) ? langFilter : null;

  const filtered = useMemo<Match[]>(() => {
    return displayed.flatMap((repo) => {
      if (visFilter === "public" && repo.private) return [];
      if (visFilter === "private" && !repo.private) return [];
      if (effectiveLangFilter && repo.language !== effectiveLangFilter) return [];
      const q = search.trim();
      if (!q) return [{ repo, nameIndices: [] }];
      const nameResult = fuzzyMatch(repo.name, q);
      const fullResult = fuzzyMatch(repo.full_name, q);
      const descResult = fuzzyMatch(repo.description ?? "", q);
      if (nameResult.match) return [{ repo, nameIndices: nameResult.indices }];
      if (fullResult.match) return [{ repo, nameIndices: [] }];
      if (descResult.match) return [{ repo, nameIndices: [] }];
      return [];
    });
  }, [displayed, search, effectiveLangFilter, visFilter]);

  // Pagination
  const filterKey = `${search}|${effectiveLangFilter}|${visFilter}|${orgParam}`;
  const effectivePage = pageState.key === filterKey ? pageState.page : 1;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(effectivePage, totalPages);
  const paginated = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  );

  function setPage(p: number) {
    setPageState({ page: p, key: filterKey });
  }

  const clampedActiveIndex = Math.min(activeIndex, paginated.length - 1);

  function handleRefresh() {
    mutate(
      (key) => typeof key === "string" && key.startsWith("/api/github/repo-summary"),
      undefined,
      { revalidate: true }
    );
    mutateRepos();
  }

  function handleOrgSelect(org: string | null) {
    setLangFilter(null);
    setVisFilter("all");
    const params = new URLSearchParams();
    if (org) params.set("org", org);
    router.push(org ? `/?${params.toString()}` : "/");
  }

  const handleGlobalKey = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (e.key === "?") {
      e.preventDefault();
      setShowShortcuts((v) => !v);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [handleGlobalKey]);

  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (search) { setSearch(""); setActiveIndex(-1); }
      else searchRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, paginated.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && clampedActiveIndex >= 0) {
      const hit = paginated[clampedActiveIndex];
      if (hit) router.push(`/repos/${hit.repo.owner}/${hit.repo.name}`);
    }
  }

  const selectedOrg = orgs?.find((o) => o.login === orgParam);

  return (
    <div className="p-8">
      {showShortcuts && (
        <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            {orgParam && selectedOrg ? (
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selectedOrg.avatar_url} alt={selectedOrg.login} width={28} height={28} className="w-7 h-7 rounded-lg" />
                <h1 className="text-2xl font-bold text-white font-mono">{selectedOrg.login}</h1>
                <span className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> Organization
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {user && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatar_url} alt={user.login} width={28} height={28} className="w-7 h-7 rounded-full" />
                )}
                <div>
                  <h1 className="text-2xl font-bold text-white">Personal Repos</h1>
                  {user && <p className="text-xs text-slate-500 font-mono mt-0.5">@{user.login}</p>}
                </div>
              </div>
            )}
          </div>
          <p className="text-sm text-slate-400">
            {isLoading
              ? "Loading repositories..."
              : `${filtered.length} of ${displayed.length} repositories${orgParam ? ` in ${orgParam}` : ""}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {orgs && (
            <OrgSelector orgs={orgs} current={orgParam} onSelect={handleOrgSelect} />
          )}
          <button
            onClick={handleRefresh}
            disabled={isLoading || isValidating}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", (isLoading || isValidating) && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={() => setShowShortcuts(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="mb-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search repositories… (press / to focus)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKey}
            className="w-full pl-9 pr-9 py-2.5 bg-slate-800/60 border border-slate-700/50 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/50"
          />
          {search && (
            <button
              onClick={() => { setSearch(""); searchRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {(["all", "public", "private"] as VisibilityFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => setVisFilter(v)}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors capitalize",
                visFilter === v
                  ? "bg-violet-500/20 border-violet-500/40 text-violet-200"
                  : "bg-slate-800/60 border-slate-700/40 text-slate-400 hover:text-white hover:border-slate-600"
              )}
            >
              {v === "private" && <Lock className="w-3 h-3" />}
              {v === "public" && <Unlock className="w-3 h-3" />}
              {v}
            </button>
          ))}

          {languages.length > 0 && (
            <span className="text-slate-700 select-none">|</span>
          )}

          {languages.map((lang) => (
            <button
              key={lang}
              onClick={() => setLangFilter((l) => l === lang ? null : lang)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                effectiveLangFilter === lang
                  ? "bg-violet-500/20 border-violet-500/40 text-violet-200"
                  : "bg-slate-800/60 border-slate-700/40 text-slate-400 hover:text-white hover:border-slate-600"
              )}
            >
              {lang}
            </button>
          ))}

          {(effectiveLangFilter || visFilter !== "all" || search) && (
            <button
              onClick={() => { setLangFilter(null); setVisFilter("all"); setSearch(""); }}
              className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-white transition-colors"
            >
              <X className="w-3 h-3" /> Clear filters
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error.message ?? "Failed to load repositories"}
        </div>
      )}

      <RecentFailuresWidget repos={displayed} />

      {/* Table */}
      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/60">
              <th className="py-2.5 pl-5 pr-4 text-left text-xs font-medium text-slate-400 tracking-wide">
                Repository
              </th>
              <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400 tracking-wide w-36">
                Status
              </th>
              <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400 tracking-wide w-36">
                Health
              </th>
              <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400 tracking-wide w-48">
                Run History (10)
              </th>
              <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-400 tracking-wide w-36">
                Trend (30d)
              </th>
              <th className="py-2.5 pr-5 w-10" />
            </tr>
          </thead>

          {isLoading ? (
            <TableSkeleton />
          ) : (
            <tbody>
              {paginated.map(({ repo, nameIndices }, i) => (
                <RepoRow
                  key={repo.id}
                  repo={repo}
                  nameIndices={nameIndices}
                  active={i === clampedActiveIndex}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-slate-500 text-sm">
                    No repositories found.
                  </td>
                </tr>
              )}
            </tbody>
          )}
        </table>
      </div>

      {/* Pagination */}
      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-5 border-t border-slate-800">
          <button
            onClick={() => setPage(Math.max(1, safePage - 1))}
            disabled={safePage <= 1}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Previous
          </button>

          <div className="flex items-center gap-1">
            <span className="text-sm text-slate-400">
              Page <span className="text-white font-medium">{safePage}</span> of{" "}
              <span className="text-white font-medium">{totalPages}</span>
            </span>
            <span className="text-slate-600 mx-2">·</span>
            <span className="text-xs text-slate-500">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
          </div>

          <button
            onClick={() => setPage(Math.min(totalPages, safePage + 1))}
            disabled={safePage >= totalPages}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="p-8 animate-pulse text-slate-500 text-sm">Loading…</div>}>
      <HomeContent />
    </Suspense>
  );
}
