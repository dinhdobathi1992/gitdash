/**
 * GitHub Actions cost calculation utilities.
 *
 * Pricing source (as of 2026-03):
 *   https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions
 *
 * GitHub-hosted runners bill per-minute with OS-specific multipliers.
 * Self-hosted runners are free (no per-minute charge from GitHub).
 *
 * NOTE: These rates apply to the *standard* runner sizes.  Larger runners
 * (4-core, 8-core, etc.) have higher rates that GitHub does not expose via
 * API — we use the standard rate as a conservative lower bound and document
 * the caveat in the UI.
 */

// ── Per-minute rates (USD) for GitHub-hosted standard runners ────────────────

export const RUNNER_RATES: Record<string, number> = {
  UBUNTU: 0.008,
  MACOS: 0.08,
  WINDOWS: 0.016,
} as const;

/** Fallback rate when runner OS is unknown (use Ubuntu rate as baseline). */
export const DEFAULT_RATE = RUNNER_RATES.UBUNTU;

// ── Types ────────────────────────────────────────────────────────────────────

export interface RunnerCostBreakdown {
  runner: string;       // "UBUNTU" | "MACOS" | "WINDOWS"
  minutes: number;
  rate: number;         // $/min
  cost: number;         // minutes × rate
}

export interface CostSummary {
  /** Total estimated cost across all runner types (USD). */
  total_cost: number;
  /** Per-runner breakdown. */
  breakdown: RunnerCostBreakdown[];
  /** Total minutes across all runners. */
  total_minutes: number;
  /** Minutes included in the plan (free tier). */
  included_minutes: number;
  /** Paid (overage) minutes — only these incur cost. */
  paid_minutes: number;
  /** Whether the cost is estimated (always true — we can't know exact larger-runner rates). */
  estimated: boolean;
}

export interface BurnRateProjection {
  /** Days elapsed in current billing period. */
  days_elapsed: number;
  /** Total days in billing period (typically 30). */
  days_total: number;
  /** Progress through billing period (0-1). */
  progress: number;
  /** Current total minutes used. */
  current_minutes: number;
  /** Projected end-of-month minutes at current burn rate. */
  projected_minutes: number;
  /** Projected overage minutes (above included). */
  projected_overage: number;
  /** Projected overage cost (USD). */
  projected_overage_cost: number;
  /** Current daily burn rate (minutes/day). */
  daily_burn_rate: number;
  /** Status indicator. */
  status: "ok" | "warning" | "critical";
}

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * Calculate estimated cost from billing minutes breakdown.
 *
 * GitHub only charges for minutes that exceed the included quota.
 * However, the `minutes_used_breakdown` from the API reports *all* minutes
 * (included + paid).  We compute cost on paid minutes only, distributed
 * proportionally across runner types.
 */
export function calculateCostFromBilling(
  minutesBreakdown: Record<string, number>,
  includedMinutes: number,
  totalMinutesUsed: number,
  totalPaidMinutes: number,
): CostSummary {
  const breakdown: RunnerCostBreakdown[] = [];
  let totalCost = 0;

  // Ratio of paid to total (used to apportion paid minutes across runners)
  const paidRatio = totalMinutesUsed > 0 ? totalPaidMinutes / totalMinutesUsed : 0;

  for (const [runner, minutes] of Object.entries(minutesBreakdown)) {
    if (minutes <= 0) continue;
    const rate = RUNNER_RATES[runner] ?? DEFAULT_RATE;
    // Only paid minutes incur cost — apportion proportionally
    const paidMinutes = minutes * paidRatio;
    const cost = paidMinutes * rate;
    breakdown.push({ runner, minutes, rate, cost: roundCurrency(cost) });
    totalCost += cost;
  }

  return {
    total_cost: roundCurrency(totalCost),
    breakdown,
    total_minutes: totalMinutesUsed,
    included_minutes: includedMinutes,
    paid_minutes: totalPaidMinutes,
    estimated: true,
  };
}

/**
 * Calculate cost per workflow based on run duration and runner OS label.
 *
 * This provides a *rough* per-workflow cost estimate by mapping the runner
 * label (e.g. "ubuntu-latest", "macos-13") to the standard rate.
 */
export function estimateRunCost(durationMs: number, runnerLabel: string): number {
  const minutes = durationMs / 60_000;
  const os = detectRunnerOS(runnerLabel);
  const rate = RUNNER_RATES[os] ?? DEFAULT_RATE;
  return roundCurrency(minutes * rate);
}

/**
 * Detect runner OS from runner label string.
 * Returns "UBUNTU", "MACOS", or "WINDOWS".
 */
export function detectRunnerOS(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("macos") || lower.includes("mac")) return "MACOS";
  if (lower.includes("windows") || lower.includes("win")) return "WINDOWS";
  return "UBUNTU"; // Default: ubuntu/linux
}

/**
 * Project end-of-month burn rate and overage.
 */
export function calculateBurnRate(
  totalMinutesUsed: number,
  includedMinutes: number,
  /** Day of the billing period (1-based, e.g. day 12 of 30). */
  dayOfPeriod: number,
  /** Total days in billing period (default 30). */
  totalDays = 30,
): BurnRateProjection {
  const daysElapsed = Math.max(1, Math.min(dayOfPeriod, totalDays));
  const progress = daysElapsed / totalDays;
  const dailyBurnRate = totalMinutesUsed / daysElapsed;
  const projectedMinutes = Math.round(dailyBurnRate * totalDays);
  const projectedOverage = Math.max(0, projectedMinutes - includedMinutes);

  // Estimate overage cost using weighted average rate
  // (conservative: use Ubuntu rate since we can't know OS mix for future runs)
  const projectedOverageCost = roundCurrency(projectedOverage * DEFAULT_RATE);

  // Determine status
  const usageRatio = includedMinutes > 0 ? projectedMinutes / includedMinutes : 0;
  let status: BurnRateProjection["status"] = "ok";
  if (usageRatio > 1.2) status = "critical";
  else if (usageRatio > 0.9) status = "warning";

  return {
    days_elapsed: daysElapsed,
    days_total: totalDays,
    progress,
    current_minutes: totalMinutesUsed,
    projected_minutes: projectedMinutes,
    projected_overage: projectedOverage,
    projected_overage_cost: projectedOverageCost,
    daily_burn_rate: Math.round(dailyBurnRate),
    status,
  };
}

/**
 * Format a dollar amount for display.
 */
export function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Round to 2 decimal places (currency). */
function roundCurrency(n: number): number {
  return Math.round(n * 100) / 100;
}
