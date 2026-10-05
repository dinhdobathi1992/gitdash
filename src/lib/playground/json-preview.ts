/**
 * Truncated JSON for the raw-response panels: long arrays keep their first
 * items plus a "… N more items" marker, long strings are clipped, and deep
 * nesting is summarized. Display only — never fed back into any metric.
 */

export interface PreviewOptions {
  maxItems?: number;
  maxString?: number;
  maxDepth?: number;
}

export function previewValue(value: unknown, opts: PreviewOptions = {}, depth = 0): unknown {
  const maxItems = opts.maxItems ?? 3;
  const maxString = opts.maxString ?? 160;
  const maxDepth = opts.maxDepth ?? 6;

  if (typeof value === "string") {
    return value.length > maxString ? `${value.slice(0, maxString)}… (${value.length - maxString} more chars)` : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= maxDepth) return Array.isArray(value) ? `[… ${value.length} items]` : "{…}";

  if (Array.isArray(value)) {
    const head = value.slice(0, maxItems).map((v) => previewValue(v, opts, depth + 1));
    return value.length > maxItems ? [...head, `… ${value.length - maxItems} more items`] : head;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = previewValue(v, opts, depth + 1);
  return out;
}

/** Pretty JSON of the preview (or the full value when `full`). */
export function formatJson(value: unknown, full = false, opts?: PreviewOptions): string {
  return JSON.stringify(full ? value : previewValue(value, opts), null, 2) ?? "null";
}

/** Item count for list responses (bare arrays or `{ workflow_runs | workflows: [] }`), else null. */
export function itemCount(body: unknown): number | null {
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === "object") {
    for (const k of ["workflow_runs", "workflows"]) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v.length;
    }
  }
  return null;
}
