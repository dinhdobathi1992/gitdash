"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import useSWR from "swr";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { fetcher } from "@/lib/swr";
import { Workflow } from "@/lib/github";
import { RepoWorkflowBreadcrumb } from "@/components/Sidebar";
import { Zap, AlertCircle, ExternalLink, GitBranch, FileCode, RefreshCw, Search, X } from "lucide-react";
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

// ── Workflow card ─────────────────────────────────────────────────────────────
function WorkflowCard({
  owner, repo, workflow, nameIndices, active,
}: {
  owner: string; repo: string; workflow: Workflow;
  nameIndices: number[]; active: boolean;
}) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const stateColor =
    workflow.state === "active"
      ? "text-green-400 bg-green-500/10 border-green-500/20"
      : "text-slate-400 bg-slate-700/20 border-slate-600/20";

  return (
    <Link
      ref={ref}
      href={`/repos/${owner}/${repo}/workflows/${workflow.id}`}
      className={cn(
        "group block bg-slate-800/40 border rounded-xl p-5 transition-all hover:shadow-lg hover:shadow-violet-500/5",
        active
          ? "border-violet-500/50 bg-slate-800/80 ring-1 ring-violet-500/30"
          : "border-slate-700/40 hover:bg-slate-800/80 hover:border-violet-500/30"
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0 group-hover:bg-violet-500/20 transition-colors">
          <Zap className="w-4 h-4 text-violet-400" />
        </div>
        <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border capitalize shrink-0", stateColor)}>
          {workflow.state}
        </span>
      </div>
      <h3 className="text-sm font-semibold text-white mb-1 line-clamp-2 group-hover:text-violet-200 transition-colors">
        <Highlighted text={workflow.name} indices={nameIndices} />
      </h3>
      <p className="text-xs text-slate-500 flex items-center gap-1 truncate">
        <FileCode className="w-3 h-3 shrink-0" />{workflow.path}
      </p>
      <div className="mt-4 pt-3 border-t border-slate-700/40">
        <span className="text-xs text-violet-400 group-hover:text-violet-300 transition-colors font-medium">
          View metrics →
        </span>
      </div>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function RepoDetailPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const router = useRouter();

  const {
    data: workflows, error, isLoading, isValidating, mutate,
  } = useSWR<Workflow[]>(
    `/api/github/workflows?owner=${owner}&repo=${repo}`,
    fetcher<Workflow[]>
  );

  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Fuzzy filter
  type Match = { workflow: Workflow; nameIndices: number[] };

  const filtered = useMemo<Match[]>(() => {
    if (!workflows) return [];
    const q = search.trim();
    return workflows.flatMap((wf) => {
      if (!q) return [{ workflow: wf, nameIndices: [] }];
      const nameResult = fuzzyMatch(wf.name, q);
      const pathResult = fuzzyMatch(wf.path, q);
      if (nameResult.match) return [{ workflow: wf, nameIndices: nameResult.indices }];
      if (pathResult.match) return [{ workflow: wf, nameIndices: [] }];
      return [];
    });
  }, [workflows, search]);

  // Clamp activeIndex without a setState-in-effect
  const clampedActiveIndex = Math.min(activeIndex, filtered.length - 1);

  // ── "/" global shortcut
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

  // ── Search box keys
  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (search) { setSearch(""); setActiveIndex(-1); }
      else searchRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && clampedActiveIndex >= 0) {
      const hit = filtered[clampedActiveIndex];
      if (hit) router.push(`/repos/${owner}/${repo}/workflows/${hit.workflow.id}`);
    }
  }

  return (
    <div className="p-8">
      <RepoWorkflowBreadcrumb owner={owner} repo={repo} />

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white font-mono">{owner}/{repo}</h1>
          <p className="text-sm text-slate-400 mt-1">
            {isLoading
              ? "Loading workflows..."
              : search
                ? `${filtered.length} of ${workflows?.length ?? 0} workflows`
                : `${workflows?.length ?? 0} workflow${(workflows?.length ?? 0) !== 1 ? "s" : ""} found`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isValidating && "animate-spin")} />
            Refresh
          </button>
          <a
            href={`https://github.com/${owner}/${repo}/actions`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" /> View on GitHub
          </a>
        </div>
      </div>

      {/* Search bar — only shown when there are workflows to search */}
      {(workflows && workflows.length > 1) && (
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search workflows… (press / to focus)"
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
      )}

      {error && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error.message ?? "Failed to load workflows"}
        </div>
      )}

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-slate-800/40 border border-slate-700/30 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          {search ? (
            <>
              <Search className="w-10 h-10 text-slate-600" />
              <p className="text-slate-400 text-sm">No workflows match &ldquo;{search}&rdquo;</p>
              <button onClick={() => setSearch("")} className="text-xs text-violet-400 hover:text-violet-300 transition-colors">
                Clear search
              </button>
            </>
          ) : (
            <>
              <GitBranch className="w-10 h-10 text-slate-600" />
              <p className="text-slate-400 text-sm">No GitHub Actions workflows found in this repository.</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(({ workflow, nameIndices }, i) => (
            <WorkflowCard
              key={workflow.id}
              owner={owner}
              repo={repo}
              workflow={workflow}
              nameIndices={nameIndices}
              active={i === clampedActiveIndex}
            />
          ))}
        </div>
      )}
    </div>
  );
}
