"use client";

/**
 * Repository picker — a select-style button with a filterable list.
 * Lists the current org's repositories (sidebar switcher), or yours.
 */

import { useState, useRef, useEffect } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { ChevronDown, Search, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Repo } from "@/lib/github";
import { useCurrentOrg } from "@/lib/current-org";

export function useOrgRepoList() {
  const org = useCurrentOrg();
  return useSWR<Repo[]>(org ? `/api/github/org-repos?org=${org}` : "/api/github/repos", fetcher<Repo[]>);
}

export function RepoPicker({
  value,
  onChange,
  placeholder = "Pick a repository",
  className,
  label = "Repository",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  /** Accessible name for the control. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const { data: repos, isLoading } = useOrgRepoList();

  const filtered = (repos ?? []).filter((r) => r.full_name.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function select(fullName: string) {
    onChange(fullName);
    setQuery("");
    setOpen(false);
  }

  const shown = value ? value.split("/").pop() : null;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${label}: ${value || "none selected"}`}
        aria-expanded={open}
        className="w-full flex items-center gap-2 h-9 px-3 rounded-control bg-panel border border-control-strong text-[13px] text-left hover:border-faint/60 transition-colors duration-100"
      >
        <span className={cn("flex-1 truncate", shown ? "font-mono text-fg" : "text-faint")}>{shown ?? placeholder}</span>
        <ChevronDown className={cn("w-4 h-4 text-muted shrink-0 transition-transform duration-100", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full min-w-[300px] right-0 float-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 h-10 border-b border-line">
            <Search className="w-4 h-4 text-faint shrink-0" aria-hidden="true" />
            <input
              autoFocus
              type="text"
              aria-label="Filter repositories"
              placeholder="Filter repositories"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-[13px] text-fg placeholder:text-faint focus:outline-none"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {isLoading && <li className="px-4 py-3 text-[13px] text-muted">Loading repositories…</li>}
            {!isLoading && filtered.length === 0 && <li className="px-4 py-3 text-[13px] text-muted">No repositories match.</li>}
            {filtered.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => select(r.full_name)}
                  aria-current={r.full_name === value || undefined}
                  className={cn(
                    "w-full text-left px-4 h-9 text-[13px] hover:bg-raised flex items-center gap-2",
                    r.full_name === value ? "text-brand-fg" : "text-fg",
                  )}
                >
                  <span className="font-mono truncate">{r.name}</span>
                  {r.private && <Lock className="ml-auto w-3.5 h-3.5 text-faint shrink-0" aria-label="Private" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
