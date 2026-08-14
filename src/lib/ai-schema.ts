/**
 * Validation for model-generated JSON (v4.1.0).
 *
 * A model's output is untrusted input. Even in JSON mode a provider can
 * return a fenced block, a wrong shape, or a 4,000-word "summary" — none of
 * which should reach a React component. Every parser here returns `null`
 * rather than throwing, so routes can uniformly retry once and then fall
 * back to an "unavailable" state.
 *
 * Caps are enforced by truncation of the *list*, not the text: an overlong
 * string is rejected outright rather than silently cut mid-sentence, because
 * a truncated recommendation reads as a bug.
 */

export interface InsightsContent {
  summary: string;
  bullets: string[];
  actions: string[];
}

const MAX_SUMMARY_CHARS = 400;
const MAX_ITEM_CHARS = 200;
const MAX_BULLETS = 6;
const MAX_ACTIONS = 4;

/**
 * Strip markdown code fences. Models in JSON mode still occasionally wrap
 * their output in ```json ... ```, and that is not worth a retry.
 */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function asCleanString(v: unknown, maxChars: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > maxChars) return null;
  return s;
}

function asStringList(v: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v.slice(0, maxItems)) {
    const s = asCleanString(item, MAX_ITEM_CHARS);
    if (s === null) return null; // a malformed entry invalidates the payload
    out.push(s);
  }
  return out;
}

/**
 * Parse and validate the shared {summary, bullets, actions} envelope.
 * Returns null on any structural problem — callers retry once, then degrade.
 */
export function parseInsightsContent(raw: string): InsightsContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const summary = asCleanString(obj.summary, MAX_SUMMARY_CHARS);
  if (summary === null) return null;

  const bullets = asStringList(obj.bullets, MAX_BULLETS);
  if (bullets === null) return null;

  const actions = asStringList(obj.actions, MAX_ACTIONS);
  if (actions === null) return null;

  return { summary, bullets, actions };
}

// ── Anomaly explanation (v4.1.1) ──────────────────────────────────────────────

export interface AnomalyExplanationContent {
  explanation: string;
  check: string;
}

const MAX_EXPLANATION_CHARS = 400;

/** Parse and validate {explanation, check}. Returns null on any problem. */
export function parseAnomalyContent(raw: string): AnomalyExplanationContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const explanation = asCleanString(obj.explanation, MAX_EXPLANATION_CHARS);
  if (explanation === null) return null;

  const check = asCleanString(obj.check, MAX_EXPLANATION_CHARS);
  if (check === null) return null;

  return { explanation, check };
}

// ── Root-cause hypotheses (v4.1.2) ────────────────────────────────────────────

export type Confidence = "high" | "medium" | "low";

export interface RootCauseHypothesis {
  rank: number;
  hypothesis: string;
  evidence: string;
  confidence: Confidence;
  next_step: string;
}

export interface RootCauseContent {
  hypotheses: RootCauseHypothesis[];
}

const MAX_HYPOTHESES = 3;

/**
 * Per-field caps, sized from observed output rather than guessed.
 *
 * The prompt asks the model to cite dates, counts and percentages, which
 * makes `evidence` naturally the longest field — measured at 211-292 chars
 * across real generations. An earlier shared 300-char cap rejected otherwise
 * good answers that ran a few characters over, burning a retry and sometimes
 * failing the request outright. These leave headroom without allowing essays;
 * the prompt also asks for brevity so the model aims well below them.
 */
const MAX_HYPOTHESIS_CHARS = 400;
const MAX_EVIDENCE_CHARS = 500;
const MAX_NEXT_STEP_CHARS = 300;

const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

/**
 * Parse and validate the ranked-hypotheses payload.
 *
 * Confidence is checked against a literal allowlist rather than coerced: the
 * UI colours a badge from it, and a model inventing "very high" would either
 * crash the badge lookup or silently render an uncoloured chip.
 */
export function parseRootCauseContent(raw: string): RootCauseContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const list = (parsed as Record<string, unknown>).hypotheses;
  if (!Array.isArray(list) || list.length === 0) return null;

  const hypotheses: RootCauseHypothesis[] = [];
  for (const [i, item] of list.slice(0, MAX_HYPOTHESES).entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const o = item as Record<string, unknown>;

    const hypothesis = asCleanString(o.hypothesis, MAX_HYPOTHESIS_CHARS);
    const evidence = asCleanString(o.evidence, MAX_EVIDENCE_CHARS);
    const next_step = asCleanString(o.next_step, MAX_NEXT_STEP_CHARS);
    if (hypothesis === null || evidence === null || next_step === null) return null;

    const confidence = o.confidence;
    if (typeof confidence !== "string" || !CONFIDENCES.includes(confidence as Confidence)) {
      return null;
    }

    // Re-derive rank from position: models frequently emit duplicate or
    // out-of-order ranks, and the display order is what actually matters.
    hypotheses.push({
      rank: i + 1,
      hypothesis,
      evidence,
      confidence: confidence as Confidence,
      next_step,
    });
  }

  return { hypotheses };
}
