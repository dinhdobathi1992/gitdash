"use client";

import { useState, useRef, useEffect } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { GitBranch, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Repo } from "@/lib/github";

export function RepoPicker({
  value,
  onChange,
  placeholder = "Pick a repository…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const { data: repos, isLoading } = useSWR<Repo[]>(
    "/api/github/repos",
    fetcher<Repo[]>,
    { revalidateOnFocus: false }
  );

  const filtered = (repos ?? []).filter((r) =>
    r.full_name.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function select(fullName: string) {
    onChange(fullName);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-left focus:outline-none focus:ring-2 focus:ring-violet-500/40 hover:border-slate-600 transition-colors"
      >
        <GitBranch className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span className={cn("flex-1 truncate", value ? "text-slate-100" : "text-slate-500")}>
          {value || placeholder}
        </span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[280px] bg-slate-900 border border-slate-700 rounded-xl shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input
              autoFocus
              type="text"
              placeholder="Filter repos…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {isLoading && (
              <li className="px-4 py-3 text-xs text-slate-500 italic">Loading repos…</li>
            )}
            {!isLoading && filtered.length === 0 && (
              <li className="px-4 py-3 text-xs text-slate-500 italic">No repos found</li>
            )}
            {filtered.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => select(r.full_name)}
                  className={cn(
                    "w-full text-left px-4 py-2.5 text-sm hover:bg-slate-800 transition-colors flex items-center gap-2",
                    r.full_name === value ? "text-violet-400 bg-slate-800/60" : "text-slate-300"
                  )}
                >
                  <span className="truncate">{r.full_name}</span>
                  {r.private && (
                    <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                      private
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
