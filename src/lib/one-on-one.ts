/**
 * Talking-point generation for the 1:1 Prep Sheet (v4.0.2).
 *
 * Pure, threshold-based rules over data the contributor-profile route
 * already computes — no ML, no new fetches. Same style as the alert-rule
 * thresholds elsewhere in the app (e.g. bus-factor's 80% cumulative,
 * review-bottleneck's 40%/80%): simple, explainable, easy to tune.
 *
 * These are prompts for a conversation, not conclusions — every talking
 * point is phrased as an observation + a question, never a verdict.
 */

import type { ContributorProfileResponse } from "@/app/api/github/contributor-profile/route";

export interface TalkingPoint {
  tone: "positive" | "neutral" | "watch";
  text: string;
}

function pctChange(recent: number, prior: number): number | null {
  if (prior === 0) return recent > 0 ? null : 0; // avoid infinite/undefined % from a zero baseline
  return Math.round(((recent - prior) / prior) * 100);
}

export function generateTalkingPoints(data: ContributorProfileResponse): TalkingPoint[] {
  const points: TalkingPoint[] = [];
  const pc = data.period_comparison;

  const mergedChange = pctChange(pc.prs_merged_recent, pc.prs_merged_prior);
  if (mergedChange !== null && pc.prs_merged_prior >= 2) {
    if (mergedChange <= -40) {
      points.push({
        tone: "watch",
        text: `PRs merged dropped ${Math.abs(mergedChange)}% vs. the prior period (${pc.prs_merged_prior} → ${pc.prs_merged_recent}). Worth asking about blockers, a big in-progress task, or capacity.`,
      });
    } else if (mergedChange >= 60) {
      points.push({
        tone: "positive",
        text: `PRs merged up ${mergedChange}% vs. the prior period (${pc.prs_merged_prior} → ${pc.prs_merged_recent}). Good momentum — worth acknowledging, and worth checking it's sustainable.`,
      });
    }
  }

  const reviewChange = pctChange(pc.reviews_given_recent, pc.reviews_given_prior);
  if (reviewChange !== null && pc.reviews_given_prior >= 2 && reviewChange >= 60) {
    points.push({
      tone: "watch",
      text: `Review load up ${reviewChange}% vs. the prior period (${pc.reviews_given_prior} → ${pc.reviews_given_recent}). If this is on top of their own PR work, check whether it's sustainable.`,
    });
  }

  if (pc.avg_hours_to_merge_prior > 0 && pc.avg_hours_to_merge_recent > pc.avg_hours_to_merge_prior * 1.5) {
    points.push({
      tone: "watch",
      text: `PRs are taking longer to land — avg ${pc.avg_hours_to_merge_recent}h this period vs. ${pc.avg_hours_to_merge_prior}h prior. Could be larger changes, could be review turnaround on their end.`,
    });
  }

  if (data.after_hours_pct >= 30 && data.total_commits_90d >= 10) {
    points.push({
      tone: "watch",
      text: `${data.after_hours_pct}% of commits over the last 90 days were outside 9–18 UTC. Worth a check-in — could be timezone, could be a sign of overload.`,
    });
  }

  if (data.pr_merge_rate < 50 && pc.prs_opened_recent >= 3) {
    points.push({
      tone: "neutral",
      text: `${data.pr_merge_rate}% PR merge rate over 90 days — worth understanding if PRs are getting closed unreviewed, superseded, or abandoned.`,
    });
  }

  if (points.length === 0) {
    points.push({
      tone: "neutral",
      text: "No notable shifts vs. the prior period — a good period to talk about what's next rather than what's wrong.",
    });
  }

  return points;
}
