"use client";

import { useState, useEffect } from "react";
import { Search, X, ChevronRight } from "lucide-react";
import { SEARCH_INDEX } from "./search-index";

function highlight(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-violet-500/30 text-violet-200 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function DocSearch({
  onSelect,
  open,
  onClose,
}: {
  onSelect: (id: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const results = query.length >= 2
    ? SEARCH_INDEX.filter((r) =>
        r.title.toLowerCase().includes(query.toLowerCase()) ||
        r.excerpt.toLowerCase().includes(query.toLowerCase())
      )
    : SEARCH_INDEX;

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-xl bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-700/50">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            autoFocus
            type="text"
            placeholder="Search docs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter opens the top result, as the footer hint promises.
              if (e.key === "Enter" && !e.nativeEvent.isComposing && results[0]) {
                onSelect(results[0].id);
                onClose();
              }
            }}
            aria-label="Search docs"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 outline-none"
          />
          <button onClick={onClose} aria-label="Close search" className="text-slate-500 hover:text-white transition-colors">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">No results for &ldquo;{query}&rdquo;</p>
          ) : (
            <ul className="py-2">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/60 transition-colors group"
                    onClick={() => {
                      onSelect(r.id);
                      onClose();
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white group-hover:text-violet-300 transition-colors">
                        {highlight(r.title, query)}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {highlight(r.excerpt, query)}
                      </p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-violet-400 shrink-0 transition-colors" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-slate-700/50 bg-slate-950/40">
          <span className="text-xs text-slate-600">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-xs">↑↓</kbd>
            {" "}navigate
          </span>
          <span className="text-xs text-slate-600">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-xs">↵</kbd>
            {" "}select
          </span>
          <span className="text-xs text-slate-600">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-xs">Esc</kbd>
            {" "}close
          </span>
        </div>
      </div>
    </div>
  );
}
