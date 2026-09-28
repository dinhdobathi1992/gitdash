/**
 * Working-habits thresholds: what makes a commit or a PR "oversized".
 *
 * Admins edit them in Settings (organization mode). Standalone deployments,
 * and any deployment without a database or a saved row, use the defaults —
 * the team standard: a commit touches at most 10 files and 200 lines, and a
 * PR carries at most 20 commits.
 */

import { isStandaloneMode } from "./mode";
import { getWorkingHabitsSettings } from "./db";

export interface WorkingHabitsThresholds {
  maxCommitFiles: number;
  maxCommitLines: number;
  maxPrCommits: number;
}

export const DEFAULT_THRESHOLDS: WorkingHabitsThresholds = {
  maxCommitFiles: 10,
  maxCommitLines: 200,
  maxPrCommits: 20,
};

export const THRESHOLD_MIN = 1;
export const THRESHOLD_MAX = 10_000;

/** Saved thresholds, or the defaults when there is nothing to read. */
export async function getThresholds(): Promise<WorkingHabitsThresholds> {
  if (isStandaloneMode() || !process.env.DATABASE_URL) return { ...DEFAULT_THRESHOLDS };
  try {
    const row = await getWorkingHabitsSettings();
    if (!row) return { ...DEFAULT_THRESHOLDS };
    return {
      maxCommitFiles: row.max_commit_files,
      maxCommitLines: row.max_commit_lines,
      maxPrCommits: row.max_pr_commits,
    };
  } catch {
    // Table unreachable — the defaults keep every figure computable.
    return { ...DEFAULT_THRESHOLDS };
  }
}

/**
 * Validate an untrusted payload. Every field must be an integer between
 * THRESHOLD_MIN and THRESHOLD_MAX.
 */
export function validateThresholds(
  input: unknown,
): { ok: true; value: WorkingHabitsThresholds } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Body must be an object" };
  const body = input as Record<string, unknown>;
  const out = {} as WorkingHabitsThresholds;
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as (keyof WorkingHabitsThresholds)[]) {
    const v = body[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < THRESHOLD_MIN || v > THRESHOLD_MAX) {
      return { ok: false, error: `${key} must be an integer from ${THRESHOLD_MIN} to ${THRESHOLD_MAX}` };
    }
    out[key] = v;
  }
  return { ok: true, value: out };
}
