"use client";

import {
  useRef, useEffect, useState, useMemo, useCallback, Suspense, memo,
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
  RefreshCw, Building2, User, ChevronDown, X,
  AlertTriangle, Keyboard, ShieldCheck,
} from "lucide-react";
import { cn, fuzzyMatch, highlightSegments } from "@/lib/utils";
import { RunHistoryBars, TrendSparkline, StatusBadge, HealthBadge } from "@/components/WorkflowMetrics";
import { MissionControl, QuickActions } from "@/components/MissionControl";

// ── Keyboard shortcuts modal ───────────────────────────────────────────────────
const SHORTCUTS = [
  { keys: ["⌘", "K"], description: "Open command palette (Ctrl+K on Windows)" },
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

function RecentFailuresWidget({ repos, tick }: { repos: Repo[]; tick: number }) {
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
    // `cache` is a stable object reference that mutates in place — it never
    // changes identity when a row's summary loads, so `tick` (bumped by each
    // RepoRow's useSWR onSuccess) is what actually drives recomputation here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos, cache, tick]);

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
const RepoRow = memo(function RepoRow({
  repo, nameIndices, active, onSummaryLoaded,
}: {
  repo: Repo;
  nameIndices: number[];
  active: boolean;
  /** Stable callback — bumps RecentFailuresWidget's cache-read memo when a summary settles. */
  onSummaryLoaded?: () => void;
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
    fetcher<RepoSummary>,
    { onSuccess: onSummaryLoaded }
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
      {/* Repository — fixed h-14 so every row is the same height */}
      <td className="h-14 pl-5 pr-4">
        <div className="flex items-center gap-2.5 h-full">
          {repo.private
            ? <Lock className="w-3 h-3 text-slate-600 shrink-0" />
            : <Unlock className="w-3 h-3 text-slate-700 shrink-0" />}
          <div className="min-w-0 flex-1">
            {/* Name + language badge on one line */}
            <div className="flex items-center gap-2 min-w-0">
              <Link
                href={`/repos/${repo.owner}/${repo.name}`}
                className="text-sm font-semibold text-white hover:text-violet-300 transition-colors font-mono truncate"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-slate-500 font-normal">{repo.owner}/</span>
                <Highlighted text={repo.name} indices={nameIndices} />
              </Link>
              {repo.language && (
                <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-800 text-slate-400 border border-slate-700/60 shrink-0">
                  {repo.language}
                </span>
              )}
            </div>

            {/* Second line — always rendered to lock row height; shows description if available, else last-updated */}
            <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[300px] hidden sm:block">
              {repo.description
                ? repo.description
                : repo.updated_at
                ? `Updated ${formatDistanceToNow(new Date(repo.updated_at))} ago`
                : <span className="text-slate-700">No description</span>
              }
            </p>
          </div>
        </div>
      </td>

      {/* Status */}
      <td className="h-14 px-4 w-32">
        <StatusBadge summary={summary} />
      </td>

      {/* Health */}
      <td className="h-14 px-4 w-24">
        <HealthBadge summary={summary} />
      </td>

      {/* Last 10 runs — hidden on xs */}
      <td className="h-14 px-4 w-44 hidden sm:table-cell">
        {summary ? (
          <RunHistoryBars runs={summary.recent_runs} />
        ) : (
          <div className="flex items-end gap-0.5 h-6">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="w-2.5 h-2 rounded-sm skeleton" />
            ))}
          </div>
        )}
      </td>

      {/* 30-day trend — hidden on sm */}
      <td className="h-14 px-4 w-32 hidden md:table-cell">
        {summary ? (
          <TrendSparkline points={summary.trend_30d} />
        ) : (
          <div className="h-8 w-28 rounded skeleton" />
        )}
      </td>

      {/* Chevron */}
      <td className="h-14 pr-4 w-8 text-right">
        <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-slate-300 transition-colors inline-block" />
      </td>
    </tr>
  );
});

// ── Table skeleton ────────────────────────────────────────────────────────────
function TableSkeleton() {
  return (
    <tbody>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="border-b border-slate-800">
          <td className="h-14 pl-5 pr-4">
            <div className="h-4 w-48 rounded skeleton mb-1.5" />
            <div className="h-3 w-64 rounded skeleton" />
          </td>
          <td className="h-14 px-4"><div className="h-5 w-16 rounded-full skeleton" /></td>
          <td className="h-14 px-4"><div className="h-5 w-12 rounded skeleton" /></td>
          <td className="h-14 px-4 hidden sm:table-cell">
            <div className="flex items-end gap-0.5 h-6">
              {Array.from({ length: 10 }).map((_, j) => (
                <div key={j} className="w-2.5 h-full rounded-sm skeleton" />
              ))}
            </div>
          </td>
          <td className="h-14 px-4 hidden md:table-cell"><div className="h-8 w-28 rounded skeleton" /></td>
          <td className="h-14 pr-4" />
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
  const [manualOrg, setManualOrg] = useState("");
  // GitHub's "orgs the user belongs to" endpoint only lists what the current
  // token's scope allows it to see — a token authorized before read:org was
  // added to the OAuth scope (or a fine-grained PAT without org access
  // granted) silently returns an empty list even for a user who genuinely
  // belongs to orgs. This input lets someone reach an org directly by name;
  // the actual repo fetch (/api/github/org-repos) checks real GitHub access
  // itself, so this works whenever discovery alone falls short.
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
        ) : current ? (
          // Reached by typed-in org name, not in the auto-discovered list —
          // still show it as selected rather than falling back to "Personal".
          <>
            <Building2 className="w-4 h-4" />
            <span className="font-mono">{current}</span>
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

          <div className="my-1 border-t border-slate-700/50" />

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

          {orgs.length === 0 && (
            <p className="px-3 py-1.5 text-[11px] text-slate-500 leading-snug">
              No organizations found. If you belong to one, your token may
              predate the <code className="text-slate-400">read:org</code> scope
              — try signing out and back in, or type the org below.
            </p>
          )}

          <div className="my-1 border-t border-slate-700/50" />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const org = manualOrg.trim();
              if (!org) return;
              onSelect(org);
              setManualOrg("");
              setOpen(false);
            }}
            className="px-3 py-2"
          >
            <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
              Go to org by name
            </label>
            <input
              value={manualOrg}
              onChange={(e) => setManualOrg(e.target.value)}
              placeholder="org-name"
              className="w-full px-2 py-1.5 bg-slate-900/60 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            />
          </form>
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
  const PAGE_SIZE = 10;
  const [pageState, setPageState] = useState<{ page: number; key: string }>({ page: 1, key: "" });
  const searchRef = useRef<HTMLInputElement>(null);

  // Bumped by each RepoRow's summary fetch so RecentFailuresWidget knows to
  // re-read the (otherwise identity-stable) SWR cache. useCallback keeps this
  // prop reference stable across renders so it doesn't defeat RepoRow's memo.
  const [summaryTick, setSummaryTick] = useState(0);
  const bumpSummaryTick = useCallback(() => setSummaryTick((t) => t + 1), []);

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
    <div className="p-4 md:p-8">
      {showShortcuts && (
        <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {orgParam ? (
            <>
              {selectedOrg ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedOrg.avatar_url} alt={selectedOrg.login} width={36} height={36} className="w-9 h-9 rounded-xl ring-1 ring-slate-700 shrink-0" />
              ) : (
                // Reached by typed-in org name (not in the auto-discovered
                // list) — still a valid, working org view, just no avatar.
                <div className="w-9 h-9 rounded-xl bg-slate-800 ring-1 ring-slate-700 shrink-0 flex items-center justify-center">
                  <Building2 className="w-4 h-4 text-slate-500" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-white font-mono truncate">{orgParam}</h1>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 shrink-0">
                    <Building2 className="w-3 h-3" /> Org
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isLoading ? "Loading…" : `${filtered.length} of ${displayed.length} repositories`}
                </p>
              </div>
            </>
          ) : (
            <>
              {user && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatar_url} alt={user.login} width={36} height={36} className="w-9 h-9 rounded-full ring-1 ring-slate-700 shrink-0" />
              )}
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-white truncate">Personal Repos</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isLoading ? "Loading…" : `${filtered.length} of ${displayed.length} repositories${user ? ` · @${user.login}` : ""}`}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {orgs && (
            <OrgSelector orgs={orgs} current={orgParam} onSelect={handleOrgSelect} />
          )}
          {orgParam && (
            <Link
              href={`/org/${encodeURIComponent(orgParam)}/health`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-violet-300 bg-violet-500/10 border border-violet-500/25 rounded-lg hover:bg-violet-500/20 transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Team Health Scorecard</span>
            </Link>
          )}
          <button
            onClick={handleRefresh}
            disabled={isLoading || isValidating}
            title="Refresh"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 rounded-lg transition-colors disabled:opacity-40"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", (isLoading || isValidating) && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={() => setShowShortcuts(true)}
            className="flex items-center justify-center w-8 h-8 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 rounded-lg transition-colors"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Mission Control ── */}
      <MissionControl org={orgParam} className="mb-4" />

      {/* ── Search + filter bar ── */}
      <div className="mb-4 space-y-2.5">
        {/* Search row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search repositories… (press / to focus)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKey}
              className="w-full pl-9 pr-9 py-2 bg-slate-800/60 border border-slate-700/50 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/50 transition-colors"
            />
            {search && (
              <button
                onClick={() => { setSearch(""); searchRef.current?.focus(); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-500 hover:text-white transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {/* Quick actions as icon buttons next to search */}
          <QuickActions org={orgParam} />
        </div>

        {/* Filter chips row */}
        <div className="flex items-center gap-1.5 flex-wrap">
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
              className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-red-400 transition-colors"
            >
              <X className="w-3 h-3" /> Clear
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

      <RecentFailuresWidget repos={displayed} tick={summaryTick} />

      {/* ── Repository table ── */}
      <div className="rounded-xl border border-slate-800/80 overflow-hidden shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/80">
              <th className="py-2.5 pl-5 pr-4 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
                Repository
              </th>
              <th className="py-2.5 px-4 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-widest w-32">
                Status
              </th>
              <th className="py-2.5 px-4 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-widest w-24">
                Health
              </th>
              <th className="py-2.5 px-4 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-widest w-44 hidden sm:table-cell">
                Last 10 runs
              </th>
              <th className="py-2.5 px-4 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-widest w-32 hidden md:table-cell">
                30-day trend
              </th>
              <th className="py-2.5 pr-5 w-8" />
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
                  onSummaryLoaded={bumpSummaryTick}
                />
              ))}
              {filtered.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-500">
                      <Search className="w-8 h-8 opacity-30" />
                      <p className="text-sm font-medium">No repositories found</p>
                      <p className="text-xs opacity-70">Try adjusting your search or filters</p>
                    </div>
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
