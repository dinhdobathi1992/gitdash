"use client";

import {
  useRef, useEffect, useState, useMemo, useCallback, Suspense,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { fetcher } from "@/lib/swr";
import { Repo, Workflow, GitHubOrg } from "@/lib/github";
import { useAuth } from "@/components/AuthProvider";
import { formatDistanceToNow } from "date-fns";
import {
  Search, Lock, Unlock, Star, AlertCircle, ChevronRight, ChevronLeft,
  RefreshCw, Zap, Building2, User, ChevronDown, X,
} from "lucide-react";
import { cn, fuzzyMatch, highlightSegments } from "@/lib/utils";

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

// ── Workflow chips — lazy via IntersectionObserver ────────────────────────────
function WorkflowChips({ owner, repo }: { owner: string; repo: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { data: workflows, isLoading, error: workflowsError } = useSWR<Workflow[]>(
    visible ? `/api/github/workflows?owner=${owner}&repo=${repo}` : null,
    fetcher<Workflow[]>
  );

  return (
    <div ref={ref} className="shrink-0 flex items-center gap-2">
      {!visible || isLoading ? (
        <span className="text-xs text-slate-600 animate-pulse">Loading...</span>
      ) : workflowsError ? (
        <span className="text-xs text-red-500/70" title={workflowsError.message}>Error</span>
      ) : !workflows || workflows.length === 0 ? (
        <span className="text-xs text-slate-600">No workflows</span>
      ) : (
        <div className="flex flex-wrap gap-1.5 justify-end max-w-xs">
          {workflows.slice(0, 5).map((wf) => (
            <Link
              key={wf.id}
              href={`/repos/${owner}/${repo}/workflows/${wf.id}`}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-700/50 hover:bg-violet-500/20 hover:border-violet-500/30 border border-slate-600/30 text-xs text-slate-300 hover:text-violet-200 transition-all"
            >
              <Zap className="w-3 h-3" />
              <span className="truncate max-w-[120px]">{wf.name}</span>
            </Link>
          ))}
          {workflows.length > 5 && (
            <Link
              href={`/repos/${owner}/${repo}`}
              className="px-2 py-1 rounded-lg bg-slate-700/30 border border-slate-600/30 text-xs text-slate-400 hover:text-white transition-colors"
            >
              +{workflows.length - 5} more
            </Link>
          )}
        </div>
      )}
      <Link
        href={`/repos/${owner}/${repo}`}
        className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
      >
        <ChevronRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

// ── Repo card ─────────────────────────────────────────────────────────────────
function RepoCard({
  repo, nameIndices, active,
}: {
  repo: Repo;
  nameIndices: number[];
  active: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={ref}
      className={cn(
        "group bg-slate-800/40 hover:bg-slate-800/70 border rounded-xl p-4 transition-all",
        active
          ? "border-violet-500/50 bg-slate-800/70 ring-1 ring-violet-500/30"
          : "border-slate-700/40 hover:border-slate-600/60"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {repo.private
              ? <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              : <Unlock className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
            <Link
              href={`/repos/${repo.owner}/${repo.name}`}
              className="text-sm font-semibold text-white hover:text-violet-300 transition-colors font-mono truncate"
            >
              <span className="text-slate-400">{repo.owner}/</span>
              <Highlighted text={repo.name} indices={nameIndices} />
            </Link>
            {repo.language && (
              <span className="text-xs text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded-full shrink-0">
                {repo.language}
              </span>
            )}
          </div>
          {repo.description && (
            <p className="text-xs text-slate-400 truncate mb-2">{repo.description}</p>
          )}
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Star className="w-3 h-3" />{repo.stargazers_count}
            </span>
            {repo.updated_at && (
              <span>Updated {formatDistanceToNow(new Date(repo.updated_at))} ago</span>
            )}
          </div>
        </div>
        <WorkflowChips owner={repo.owner} repo={repo.name} />
      </div>
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────
function RepoSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-20 rounded-xl bg-slate-800/40 border border-slate-700/30 animate-pulse" />
      ))}
    </div>
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
  // Page state paired with the filter snapshot it was set under.
  // When filters change, effectivePage resets to 1 without needing useEffect.
  const PAGE_SIZE = 20;
  const [pageState, setPageState] = useState<{ page: number; key: string }>({ page: 1, key: "" });
  const searchRef = useRef<HTMLInputElement>(null);

  const orgParam = searchParams.get("org");

  const { data: orgs } = useSWR<GitHubOrg[]>("/api/github/orgs", fetcher<GitHubOrg[]>);

  // The repos API authenticates via session cookie — it doesn't need user
  // identity on the client. Fetch immediately; no gate needed.
  const reposUrl = orgParam
    ? `/api/github/org-repos?org=${orgParam}`
    : "/api/github/repos";

  const {
    data: repos, error, isLoading, isValidating, mutate: mutateRepos,
  } = useSWR<Repo[]>(reposUrl, fetcher<Repo[]>);

  // When no org is selected show all repos from listForAuthenticatedUser —
  // that includes personal repos AND org repos the user has access to.
  // Filtering by owner===user.login would hide org repos and show nothing
  // for users who keep all repos under an org.
  const displayed = useMemo(() => repos ?? [], [repos]);

  // ── Available languages for filter pills
  const languages = useMemo(() => {
    const langs = new Set<string>();
    for (const r of displayed) if (r.language) langs.add(r.language);
    return [...langs].sort();
  }, [displayed]);

  // ── Fuzzy + filter pipeline
  type Match = { repo: Repo; nameIndices: number[] };

  // Clamp lang filter: if the current language no longer exists in the repo
  // list (e.g. after switching orgs) treat it as unset rather than running
  // a setState-in-effect which the linter forbids.
  const effectiveLangFilter = langFilter && languages.includes(langFilter) ? langFilter : null;

  const filtered = useMemo<Match[]>(() => {
    return displayed.flatMap((repo) => {
      // visibility
      if (visFilter === "public" && repo.private) return [];
      if (visFilter === "private" && !repo.private) return [];
      // language
      if (effectiveLangFilter && repo.language !== effectiveLangFilter) return [];
      // fuzzy on name + full_name + description
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

  // ── Pagination — derive current page from filter snapshot to avoid setState-in-effect
  const filterKey = `${search}|${effectiveLangFilter}|${visFilter}|${orgParam}`;
  // When the filter key changes, the stored key no longer matches → reset to page 1.
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

  // Clamp activeIndex to visible (paginated) range without a setState-in-effect
  const clampedActiveIndex = Math.min(activeIndex, paginated.length - 1);

  function handleRefresh() {
    mutate(() => true, undefined, { revalidate: true });
    mutateRepos();
  }

  function handleOrgSelect(org: string | null) {
    const params = new URLSearchParams();
    if (org) params.set("org", org);
    router.push(org ? `/?${params.toString()}` : "/");
  }

  // ── Global "/" shortcut to focus search
  const handleGlobalKey = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [handleGlobalKey]);

  // ── Search box key handling (Esc / ↑ / ↓ / Enter)
  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (search) {
        setSearch("");
        setActiveIndex(-1);
      } else {
        searchRef.current?.blur();
      }
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
        </div>
      </div>

      {/* Search + filters */}
      <div className="mb-4 space-y-3">
        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            ref={searchRef}
            type="text"
            placeholder={`Search repositories… (press / to focus)`}
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

        {/* Filter row — always shown so visibility pills are always accessible */}
        <div className="flex items-center gap-2 flex-wrap">
            {/* Visibility pills */}
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

            {/* Divider */}
            {languages.length > 0 && (
              <span className="text-slate-700 select-none">|</span>
            )}

            {/* Language pills */}
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

            {/* Clear all filters */}
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

      {isLoading ? (
        <RepoSkeleton />
      ) : (
        <div className="grid gap-3">
          {paginated.map(({ repo, nameIndices }, i) => (
            <RepoCard
              key={repo.id}
              repo={repo}
              nameIndices={nameIndices}
              active={i === clampedActiveIndex}
            />
          ))}
          {filtered.length === 0 && !isLoading && (
            <p className="text-center text-slate-500 py-16">No repositories found.</p>
          )}
        </div>
      )}

      {/* Pagination controls */}
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
