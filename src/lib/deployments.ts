/**
 * Real deployment metrics from GitHub's Deployments API (v4.2.1).
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * The DORA figures on the repo overview were inferred, not measured:
 *
 *   deploy frequency  ← GitHub Releases, falling back to *every merged PR*
 *   change fail rate  ← PRs whose branch matches /hotfix|revert|emergency/
 *   MTTR              ← how long those PRs took to merge
 *
 * Those proxies fail quietly. A team that does not tag releases has its merge
 * rate reported as its deploy rate. A team that does not name branches
 * "hotfix" gets a change failure rate of exactly 0% — which reads as
 * excellence rather than as no signal.
 *
 * When a repo actually uses the Deployments API, all three become measurable:
 * a deployment is a deployment, a failed deployment status is a failure, and
 * recovery is the gap until the next success on that environment.
 *
 * ── The honest part ───────────────────────────────────────────────────────
 * Many repos do not use deployments at all, so this never replaces the old
 * numbers silently. It reports `source`, and the UI states whether a figure
 * was measured or estimated. Knowing which you are looking at matters more
 * than the figure itself.
 */

import { getOctokit } from "@/lib/github";
import { pLimitSettled } from "@/lib/concurrency";

/** Where a metric came from. Surfaced in the UI — never hidden. */
export type DeployMetricSource = "deployments" | "none";

export interface DeploymentRecord {
  id: number;
  environment: string;
  /** GitHub's deployment status state, or null when it never reported one. */
  state: "success" | "failure" | "error" | "pending" | "in_progress" | "inactive" | null;
  created_at: string;
  /** When the terminal status landed — used for recovery timing. */
  status_at: string | null;
  ref: string;
  sha: string;
}

export interface EnvironmentStat {
  environment: string;
  total: number;
  success: number;
  failed: number;
  /** Null when nothing conclusive was recorded for this environment. */
  failure_rate_pct: number | null;
}

export interface DeploymentsSummary {
  repo: string;
  source: DeployMetricSource;
  /** Environment treated as production for headline figures. */
  production_environment: string | null;
  period_days: number;
  total_deployments: number;
  successful: number;
  failed: number;
  /** Successful production deployments per day. Null when unmeasurable. */
  deploys_per_day: number | null;
  /** Failed / conclusive production deployments. Null when unmeasurable. */
  change_failure_rate_pct: number | null;
  /** Mean hours from a failed production deploy to the next success. */
  mttr_hours: number | null;
  /** How many recovery pairs the MTTR is based on — 1 is not a trend. */
  mttr_samples: number;
  by_environment: EnvironmentStat[];
  recent: DeploymentRecord[];
  /** True when some status fetches failed — figures are from a partial sample. */
  partial: boolean;
}

/** Status lookups are one call each, so the newest slice is the bounded part. */
const MAX_STATUS_LOOKUPS = 40;
const MAX_RECENT_RETURNED = 15;
const DEFAULT_PERIOD_DAYS = 30;

/**
 * Production-ish environment names, in preference order.
 *
 * Word-boundary matching rather than equality: platforms label environments
 * things like "Production — my-app", so an exact-match check finds only the
 * bare name and misses the one actually being deployed to. Word boundaries
 * also stop "main" matching "domain-staging".
 */
const PRODUCTION_PATTERNS = [/\bproduction\b/i, /\bprod\b/i, /\blive\b/i, /\bmain\b/i];

function countByEnvironment(deployments: { environment: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of deployments) counts.set(d.environment, (counts.get(d.environment) ?? 0) + 1);
  return counts;
}

/**
 * Choose the environment whose figures become the headline.
 *
 * Runs against the raw deployment list — before statuses are fetched — so
 * status resolution can be aimed at whatever this returns. Picking first and
 * resolving second is what stops the headline environment ending up with no
 * data (see the note on MAX_STATUS_LOOKUPS).
 *
 * Within a matching tier the busiest environment wins: a repo that deploys to
 * several production targets should report the one it actually uses most,
 * not whichever happens to sort first.
 */
function pickProductionEnvironment(deployments: { environment: string }[]): string | null {
  if (deployments.length === 0) return null;
  const counts = countByEnvironment(deployments);
  const byVolume = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  for (const pattern of PRODUCTION_PATTERNS) {
    const matches = byVolume.filter(([env]) => pattern.test(env));
    if (matches.length > 0) return matches[0][0];
  }
  // No conventional name — the busiest environment is very nearly always the
  // one that matters.
  return byVolume[0][0];
}

const isSuccess = (r: DeploymentRecord) => r.state === "success";
const isFailure = (r: DeploymentRecord) => r.state === "failure" || r.state === "error";

/**
 * Mean hours from each failed production deployment to the next successful
 * one on the same environment — the actual definition of recovery, rather
 * than how fast someone merged a branch named "hotfix".
 */
function computeMttr(records: DeploymentRecord[]): { hours: number | null; samples: number } {
  const chronological = [...records].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const gaps: number[] = [];
  let failedAt: number | null = null;

  for (const r of chronological) {
    const ts = new Date(r.status_at ?? r.created_at).getTime();
    if (isFailure(r)) {
      // Keep the FIRST failure of a streak: recovery is measured from when
      // things broke, not from the last symptom before they were fixed.
      if (failedAt === null) failedAt = ts;
    } else if (isSuccess(r) && failedAt !== null) {
      if (ts > failedAt) gaps.push((ts - failedAt) / 3_600_000);
      failedAt = null;
    }
  }

  if (gaps.length === 0) return { hours: null, samples: 0 };
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  return { hours: Math.round(mean * 10) / 10, samples: gaps.length };
}

export async function getDeploymentsSummary(
  token: string,
  owner: string,
  repo: string,
  periodDays: number = DEFAULT_PERIOD_DAYS,
): Promise<DeploymentsSummary> {
  const octokit = getOctokit(token);

  const empty: DeploymentsSummary = {
    repo: `${owner}/${repo}`,
    source: "none",
    production_environment: null,
    period_days: periodDays,
    total_deployments: 0,
    successful: 0,
    failed: 0,
    deploys_per_day: null,
    change_failure_rate_pct: null,
    mttr_hours: null,
    mttr_samples: 0,
    by_environment: [],
    recent: [],
    partial: false,
  };

  let deployments: { id: number; environment: string; created_at: string; ref: string; sha: string }[];
  try {
    const { data } = await octokit.rest.repos.listDeployments({ owner, repo, per_page: 100 });
    deployments = data.map((d) => ({
      id: d.id,
      environment: d.environment ?? "unknown",
      created_at: d.created_at,
      ref: d.ref ?? "",
      sha: d.sha ?? "",
    }));
  } catch {
    // 404 on a repo with deployments disabled, or no access. Either way there
    // is nothing to measure and the caller keeps its existing estimates.
    return empty;
  }

  const cutoff = Date.now() - periodDays * 86_400_000;
  const inWindow = deployments.filter((d) => new Date(d.created_at).getTime() >= cutoff);
  if (inWindow.length === 0) return empty;

  // Decide the headline environment BEFORE resolving statuses, so the budget
  // can be aimed at it.
  //
  // The original version resolved "the 40 most recent deployments overall",
  // which broke on any repo busy enough to exceed that in the window: if none
  // of production's deployments landed in that slice, every headline figure
  // came back empty — 0.00 deploys/day on a repo that deploys constantly.
  // Production is filled first, then the remaining budget covers other
  // environments so their per-environment rates still populate.
  const productionEnvironment = pickProductionEnvironment(inWindow);
  const isProd = (d: { environment: string }) => d.environment === productionEnvironment;
  const toResolve = [
    ...inWindow.filter(isProd),
    ...inWindow.filter((d) => !isProd(d)),
  ].slice(0, MAX_STATUS_LOOKUPS);
  const settled = await pLimitSettled(
    toResolve.map((d) => async () => {
      const { data } = await octokit.rest.repos.listDeploymentStatuses({
        owner, repo, deployment_id: d.id, per_page: 10,
      });
      return { id: d.id, statuses: data };
    }),
    { concurrency: 8 },
  );

  let partial = false;
  const statusById = new Map<number, { state: string; created_at: string }>();
  for (const res of settled) {
    if (res.status === "rejected") {
      partial = true;
      continue;
    }
    const { id, statuses } = res.value;
    // listDeploymentStatuses returns newest first — index 0 is current state.
    const latest = statuses[0];
    if (latest) statusById.set(id, { state: latest.state, created_at: latest.created_at });
  }

  const records: DeploymentRecord[] = inWindow.map((d) => {
    const s = statusById.get(d.id);
    return {
      id: d.id,
      environment: d.environment,
      state: (s?.state as DeploymentRecord["state"]) ?? null,
      created_at: d.created_at,
      status_at: s?.created_at ?? null,
      ref: d.ref,
      sha: d.sha,
    };
  });

  const production = records.filter((r) => r.environment === productionEnvironment);

  const prodSuccess = production.filter(isSuccess).length;
  const prodFailed = production.filter(isFailure).length;
  const prodConclusive = prodSuccess + prodFailed;

  const byEnvironment = new Map<string, EnvironmentStat>();
  for (const r of records) {
    const stat = byEnvironment.get(r.environment) ?? {
      environment: r.environment, total: 0, success: 0, failed: 0, failure_rate_pct: null,
    };
    stat.total++;
    if (isSuccess(r)) stat.success++;
    if (isFailure(r)) stat.failed++;
    byEnvironment.set(r.environment, stat);
  }
  for (const stat of byEnvironment.values()) {
    const conclusive = stat.success + stat.failed;
    stat.failure_rate_pct = conclusive > 0 ? Math.round((stat.failed / conclusive) * 100) : null;
  }

  const { hours: mttrHours, samples: mttrSamples } = computeMttr(production);

  return {
    repo: `${owner}/${repo}`,
    source: "deployments",
    production_environment: productionEnvironment,
    period_days: periodDays,
    total_deployments: records.length,
    successful: records.filter(isSuccess).length,
    failed: records.filter(isFailure).length,
    // Frequency counts SUCCESSFUL production deploys: a failed rollout is not
    // a delivery, and counting it would flatter the number.
    //
    // Null — not 0.00 — when nothing conclusive was resolved for production.
    // "0.00 deploys/day" is an assertion that the team ships nothing; the
    // truthful statement when statuses are unknown is that we cannot say.
    // This is the same reasoning already applied to CFR and MTTR below.
    deploys_per_day:
      prodConclusive > 0 ? Math.round((prodSuccess / periodDays) * 100) / 100 : null,
    change_failure_rate_pct:
      prodConclusive > 0 ? Math.round((prodFailed / prodConclusive) * 100) : null,
    mttr_hours: mttrHours,
    mttr_samples: mttrSamples,
    by_environment: [...byEnvironment.values()].sort((a, b) => b.total - a.total),
    recent: records
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, MAX_RECENT_RETURNED),
    partial: partial || inWindow.length > toResolve.length,
  };
}
