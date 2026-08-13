/**
 * Weekly Leadership Digest narrative generation (v4.0.3).
 *
 * Reuses the exact org-health-scorecard computation (v4.0.0) — same DORA
 * tier + bus-factor risk fan-out — and turns the ranked result into plain-
 * English sentences instead of a UI list. Rule-based, same style as the
 * app's alert thresholds and the 1:1 Prep Sheet's talking points: no ML,
 * fully explainable.
 */

import { LEVEL_LABELS, type DoraLevel } from "@/lib/dora";
import type { OrgHealthScorecardResponse, RepoScorecardEntry } from "@/lib/org-health-scorecard";

export interface LeadershipDigestNarrative {
  org: string;
  subject: string;
  summary_line: string;
  highlights: string[]; // things going well
  concerns: string[]; // things needing attention
  repos_analysed: number;
  repos_attempted: number;
}

function doraTierLabel(level: DoraLevel): string {
  return LEVEL_LABELS[level];
}

export function generateLeadershipNarrative(
  scorecard: OrgHealthScorecardResponse,
): LeadershipDigestNarrative {
  const { org, repos } = scorecard;

  if (repos.length === 0) {
    return {
      org,
      subject: `[GitDash] Weekly digest for ${org} — no data this week`,
      summary_line: `No repos had enough activity to score this week.`,
      highlights: [],
      concerns: [],
      repos_analysed: 0,
      repos_attempted: scorecard.repos_attempted,
    };
  }

  const atRisk = repos.filter((r) => r.risk_band === "at_risk");
  const watch = repos.filter((r) => r.risk_band === "watch");
  const healthy = repos.filter((r) => r.risk_band === "healthy");
  const trendingUp = repos.filter((r) => r.trend === "up");
  const trendingDown = repos.filter((r) => r.trend === "down");
  const critical = repos.filter((r) => r.critical_modules > 0);

  const avgScore = Math.round(repos.reduce((s, r) => s + r.composite_score, 0) / repos.length);

  const summaryLine =
    atRisk.length > 0
      ? `${atRisk.length} of ${repos.length} repos need attention this week. Average health score: ${avgScore}/100.`
      : watch.length > 0
      ? `${repos.length} repos analysed, ${watch.length} on watch, none critical. Average health score: ${avgScore}/100.`
      : `All ${repos.length} repos are healthy this week. Average health score: ${avgScore}/100.`;

  const highlights: string[] = [];
  if (trendingUp.length > 0) {
    highlights.push(
      `${repoList(trendingUp)} — throughput trending up.`,
    );
  }
  if (healthy.length === repos.length) {
    highlights.push(`Every repo is in the Healthy band this week.`);
  } else if (healthy.length > 0) {
    highlights.push(`${repoList(healthy)} — Healthy, no action needed.`);
  }

  const concerns: string[] = [];
  for (const r of atRisk) {
    concerns.push(
      `${r.repo} is At Risk (score ${r.composite_score}/100) — DORA tier ${doraTierLabel(r.dora_level)}, bus factor ${r.overall_bus_factor}${r.critical_modules > 0 ? `, ${r.critical_modules} critical module${r.critical_modules === 1 ? "" : "s"}` : ""}.`,
    );
  }
  for (const r of watch) {
    if (concerns.length >= 8) break; // keep the email scannable
    concerns.push(
      `${r.repo} is on Watch (score ${r.composite_score}/100) — DORA tier ${doraTierLabel(r.dora_level)}.`,
    );
  }
  if (trendingDown.length > 0) {
    concerns.push(`${repoList(trendingDown)} — throughput trending down vs. the prior period.`);
  }
  if (critical.length > 0) {
    concerns.push(
      `${repoList(critical)} — knowledge-silo risk: at least one module with bus factor 1 (only one person can safely change it).`,
    );
  }

  return {
    org,
    subject: `[GitDash] Weekly digest for ${org}${atRisk.length > 0 ? ` — ${atRisk.length} repo${atRisk.length === 1 ? "" : "s"} need attention` : ""}`,
    summary_line: summaryLine,
    highlights,
    concerns,
    repos_analysed: scorecard.repos_analysed,
    repos_attempted: scorecard.repos_attempted,
  };
}

function repoList(entries: RepoScorecardEntry[]): string {
  const names = entries.slice(0, 5).map((r) => r.repo);
  const extra = entries.length - names.length;
  return names.join(", ") + (extra > 0 ? ` (+${extra} more)` : "");
}
