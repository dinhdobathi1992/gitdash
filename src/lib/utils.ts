import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function conclusionBadgeCn(conclusion: string | null): string {
  switch (conclusion) {
    case "success": return "bg-green-500/20 text-green-300 border border-green-500/30";
    case "failure": return "bg-red-500/20 text-red-300 border border-red-500/30";
    case "cancelled": return "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30";
    case "skipped": return "bg-slate-500/20 text-slate-300 border border-slate-500/30";
    case "timed_out": return "bg-orange-500/20 text-orange-300 border border-orange-500/30";
    default: return "bg-blue-500/20 text-blue-300 border border-blue-500/30";
  }
}

/**
 * Fuzzy match: returns true if every character in `query` appears in `text`
 * in order (case-insensitive). Also returns the matched character indices
 * for highlight rendering.
 */
export function fuzzyMatch(
  text: string,
  query: string
): { match: boolean; indices: number[] } {
  if (!query) return { match: true, indices: [] };
  const lText = text.toLowerCase();
  const lQuery = query.toLowerCase();
  const indices: number[] = [];
  let qi = 0;
  for (let ti = 0; ti < lText.length && qi < lQuery.length; ti++) {
    if (lText[ti] === lQuery[qi]) {
      indices.push(ti);
      qi++;
    }
  }
  return { match: qi === lQuery.length, indices };
}

/**
 * Split `text` into segments based on highlight indices, for rendering
 * matched characters in a different colour.
 * Returns [{text, highlight}] chunks.
 */
export function highlightSegments(
  text: string,
  indices: number[]
): { text: string; highlight: boolean }[] {
  if (!indices.length) return [{ text, highlight: false }];
  const set = new Set(indices);
  const chunks: { text: string; highlight: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const hl = set.has(i);
    let j = i + 1;
    while (j < text.length && set.has(j) === hl) j++;
    chunks.push({ text: text.slice(i, j), highlight: hl });
    i = j;
  }
  return chunks;
}

/**
 * Relative time per the design contract §7: "just now", "18 min ago",
 * "2 h ago", "1 d ago" under 7 days, then a short date ("Sep 24").
 * `now` is injectable so render paths can pass a stable clock.
 */
export function formatRelative(input: string | number | Date | null | undefined, now: number = Date.now()): string {
  if (input === null || input === undefined) return "—";
  const t = new Date(input).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d ago`;
  const date = new Date(t);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** Mono-friendly duration: "11m 42s", "2h 10m", "38s". */
export function formatDurationShort(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Nearest-rank percentile of a numeric list; null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
