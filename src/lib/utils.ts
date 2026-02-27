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
