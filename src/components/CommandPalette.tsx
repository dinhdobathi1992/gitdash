"use client";

/**
 * Command palette (v4.2.3) — ⌘K / Ctrl+K.
 *
 * GitDash has ~20 pages and, in a real org, hundreds of repositories.
 * Navigation was a sidebar plus page-local search, which means reaching a
 * specific repo took several clicks from anywhere that wasn't the repo list.
 *
 * Two deliberate choices:
 *
 *  - Repo results reuse the SAME SWR key as the repositories page, so opening
 *    the palette costs nothing when that data is already cached, and warms it
 *    for the page when it isn't.
 *  - Repo-scoped destinations (Team, Security, Issues…) only appear while you
 *    are inside a repo, because "Security" is meaningless without knowing
 *    which repo it belongs to.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { Repo } from "@/lib/github";
import { fuzzyMatch, highlightSegments, cn } from "@/lib/utils";
import {
  Search, CornerDownLeft, ArrowUp, ArrowDown, Book, Bell, Settings2,
  BarChart3, Users, DollarSign, TrendingUp, LayoutGrid, GitBranch,
  ShieldCheck, FileText, CircleDot, Trophy,
} from "lucide-react";

interface Command {
  id: string;
  label: string;
  /** Shown to the right — the path, or the repo owner. */
  hint?: string;
  href: string;
  icon: React.ElementType;
  group: "Repositories" | "This repository" | "Go to";
}

const STATIC_COMMANDS: Command[] = [
  { id: "nav-repos", label: "Repositories", href: "/", icon: LayoutGrid, group: "Go to" },
  { id: "nav-team", label: "Team Insights", href: "/team", icon: Users, group: "Go to" },
  { id: "nav-cost", label: "Cost Analytics", href: "/cost-analytics", icon: DollarSign, group: "Go to" },
  { id: "nav-reports", label: "Reports", href: "/reports", icon: TrendingUp, group: "Go to" },
  { id: "nav-alerts", label: "Alerts", href: "/alerts", icon: Bell, group: "Go to" },
  { id: "nav-docs", label: "Documentation", href: "/docs", icon: Book, group: "Go to" },
  { id: "nav-settings", label: "Settings", href: "/settings", icon: Settings2, group: "Go to" },
];

/** Extract owner/repo when the current path is inside a repository. */
function currentRepo(path: string): { owner: string; repo: string } | null {
  const m = path.match(/^\/repos\/([^/]+)\/([^/]+)/);
  return m ? { owner: decodeURIComponent(m[1]), repo: decodeURIComponent(m[2]) } : null;
}

const MAX_REPO_RESULTS = 8;

export default function CommandPalette() {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Only fetch once the palette has been opened — the shell mounts this on
  // every page and should not pull a repo list nobody asked for.
  const [everOpened, setEverOpened] = useState(false);
  const { data: repos } = useSWR<Repo[]>(
    everOpened ? "/api/github/repos" : null,
    fetcher<Repo[]>,
  );

  const inRepo = currentRepo(path);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];

    if (inRepo) {
      const base = `/repos/${inRepo.owner}/${inRepo.repo}`;
      list.push(
        { id: "r-overview", label: "Overview", hint: inRepo.repo, href: base, icon: BarChart3, group: "This repository" },
        { id: "r-team", label: "Team Analytics", hint: inRepo.repo, href: `${base}/team`, icon: Trophy, group: "This repository" },
        { id: "r-issues", label: "Issue & Triage Health", hint: inRepo.repo, href: `${base}/issues`, icon: CircleDot, group: "This repository" },
        { id: "r-security", label: "Security", hint: inRepo.repo, href: `${base}/security`, icon: ShieldCheck, group: "This repository" },
        { id: "r-audit", label: "Audit Trail", hint: inRepo.repo, href: `${base}/audit`, icon: FileText, group: "This repository" },
      );
    }

    for (const r of repos ?? []) {
      list.push({
        id: `repo-${r.owner}/${r.name}`,
        label: r.name,
        hint: r.owner,
        href: `/repos/${r.owner}/${r.name}`,
        icon: GitBranch,
        group: "Repositories",
      });
    }

    list.push(...STATIC_COMMANDS);
    return list;
  }, [repos, inRepo]);

  const results = useMemo<(Command & { _indices: number[] })[]>(() => {
    const q = query.trim();
    if (!q) {
      // Empty query: repo-scoped actions first, then navigation. Showing the
      // full repo list unfiltered would bury everything else.
      return commands
        .filter((c) => c.group !== "Repositories")
        .slice(0, 12)
        .map((c) => ({ ...c, _indices: [] }));
    }

    const scored: { cmd: Command; indices: number[]; group: string }[] = [];
    for (const cmd of commands) {
      const onLabel = fuzzyMatch(cmd.label, q);
      if (onLabel.match) {
        scored.push({ cmd, indices: onLabel.indices, group: cmd.group });
        continue;
      }
      // Fall back to "owner/name" so "acme/api" finds a repo.
      if (cmd.hint && fuzzyMatch(`${cmd.hint}/${cmd.label}`, q).match) {
        scored.push({ cmd, indices: [], group: cmd.group });
      }
    }

    const repoHits = scored.filter((s) => s.group === "Repositories").slice(0, MAX_REPO_RESULTS);
    const rest = scored.filter((s) => s.group !== "Repositories");
    return [...rest, ...repoHits].map((s) => ({ ...s.cmd, _indices: s.indices }));
  }, [commands, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const run = useCallback(
    (cmd: Command) => {
      close();
      // router.push, not window.location — this is ordinary in-app navigation
      // with no auth change, so the SWR cache should survive it.
      router.push(cmd.href);
    },
    [close, router],
  );

  // Global shortcut.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setEverOpened(true);
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape" && open) close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the highlighted row in view when navigating by keyboard.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const clamped = Math.min(active, Math.max(0, results.length - 1));

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[clamped];
      if (hit) run(hit);
    }
  }

  let lastGroup = "";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4 bg-black/60 backdrop-blur-sm"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 border-b border-slate-800">
          <Search className="w-4 h-4 text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            placeholder="Search repositories and pages…"
            className="flex-1 bg-transparent py-3.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none"
          />
          <kbd className="shrink-0 px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 border border-slate-700 rounded text-slate-500">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2">
          {results.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              No matches for “{query}”.
            </p>
          )}

          {results.map((cmd, i) => {
            const Icon = cmd.icon;
            const showGroup = cmd.group !== lastGroup;
            lastGroup = cmd.group;
            const segments = cmd._indices.length
              ? highlightSegments(cmd.label, cmd._indices)
              : [{ text: cmd.label, highlight: false }];

            return (
              <div key={cmd.id}>
                {showGroup && (
                  <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                    {cmd.group}
                  </div>
                )}
                <button
                  data-idx={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(cmd)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                    i === clamped ? "bg-violet-500/15" : "hover:bg-slate-800/60",
                  )}
                >
                  <Icon className={cn("w-4 h-4 shrink-0", i === clamped ? "text-violet-300" : "text-slate-500")} />
                  <span className="flex-1 min-w-0 text-sm text-slate-200 truncate">
                    {segments.map((s, si) =>
                      s.highlight
                        ? <mark key={si} className="bg-transparent text-violet-300 font-semibold">{s.text}</mark>
                        : <span key={si}>{s.text}</span>,
                    )}
                  </span>
                  {cmd.hint && (
                    <span className="shrink-0 font-mono text-[11px] text-slate-600 truncate max-w-[40%]">
                      {cmd.hint}
                    </span>
                  )}
                  {i === clamped && <CornerDownLeft className="w-3.5 h-3.5 shrink-0 text-slate-500" />}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-800 text-[11px] text-slate-600">
          <span className="flex items-center gap-1"><ArrowUp className="w-3 h-3" /><ArrowDown className="w-3 h-3" /> navigate</span>
          <span className="flex items-center gap-1"><CornerDownLeft className="w-3 h-3" /> open</span>
          <span className="ml-auto font-mono">⌘K</span>
        </div>
      </div>
    </div>
  );
}
