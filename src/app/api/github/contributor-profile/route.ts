import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { validateOwner, safeError } from "@/lib/validation";
import { getOctokit } from "@/lib/github";
import { pLimitSettled } from "@/lib/concurrency";

const CACHE_TTL = 300; // 5 minutes

// ── Response types ────────────────────────────────────────────────────────────

export interface ContributorPrSummary {
  number: number;
  title: string;
  state: string;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  additions: number;
  deletions: number;
  /** Hours from created to merged */
  hours_to_merge: number | null;
  repo_full_name: string;
}

export interface ContributorReviewSummary {
  pr_number: number;
  pr_title: string;
  state: string;
  submitted_at: string;
  /** Hours from PR created to review submitted */
  turnaround_hours: number | null;
  repo_full_name: string;
}

export interface ContributorProfileResponse {
  login: string;
  avatar_url: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  html_url: string;

  // PR metrics (last 90 days)
  prs_opened: number;
  prs_merged: number;
  prs_closed_without_merge: number;
  pr_merge_rate: number; // 0-100
  avg_hours_to_merge: number;
  avg_pr_size: number; // additions + deletions
  recent_prs: ContributorPrSummary[];

  // Review metrics
  reviews_given: number;
  avg_review_turnaround_hours: number;
  recent_reviews: ContributorReviewSummary[];

  // Commit metrics
  total_commits_90d: number;
  /** 52-week contribution calendar: array of { date, count } */
  activity_calendar: { date: string; count: number }[];
  /** Weekly commit counts for last 12 weeks */
  weekly_commits: { week_start: string; count: number }[];
  /** Hour-of-day distribution (0-23, UTC) */
  commit_hour_distribution: number[];
  /** Active days per week (last 4 weeks) */
  active_days_per_week: number[];
  /** Percentage of commits made outside 9-18 UTC */
  after_hours_pct: number;

  // PR lifecycle funnel
  funnel: {
    opened: number;
    reviewed: number;
    approved: number;
    merged: number;
  };

  // Languages touched (from repos contributed to)
  languages: { name: string; count: number }[];

  // Repos contributed to
  repos_contributed: string[];

  /** True if some per-repo PR/commit/review fetches were rate-limited or failed */
  partial: boolean;
  fetched_requests: number;
  total_requests_attempted: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;
  const owner = ownerResult.data;

  const loginParam = searchParams.get("login");
  if (!loginParam || !/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$|^[a-zA-Z0-9]$/.test(loginParam)) {
    return NextResponse.json({ error: "Invalid login parameter" }, { status: 400 });
  }
  const login = loginParam;

  try {
    const octokit = getOctokit(token);
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const since = ninetyDaysAgo.toISOString();

    // ── Parallel: user profile + org repos + search PRs authored + search PRs reviewed
    const [userRes, orgReposRes] = await Promise.all([
      octokit.rest.users.getByUsername({ username: login }),
      octokit.rest.repos.listForOrg({
        org: owner,
        per_page: 100,
        sort: "updated",
        direction: "desc",
        type: "all",
      }),
    ]);

    const user = userRes.data;
    const orgRepos = orgReposRes.data.slice(0, 30); // Cap to 30 repos

    // ── Fetch PRs authored by login across org repos (batched) ──────────────
    const allPrs: ContributorPrSummary[] = [];
    const allReviews: ContributorReviewSummary[] = [];
    const commitCounts: Record<string, number> = {};
    const commitHours: number[] = Array(24).fill(0);
    const commitDays: Set<string>[] = [new Set(), new Set(), new Set(), new Set()]; // last 4 weeks
    const repoLangs: Record<string, number> = {};
    const reposContributed = new Set<string>();
    let totalCommits = 0;

    let reposPrFailed = 0;
    let reposCommitsFailed = 0;
    let reviewFetchRejected = 0;
    let reviewFetchAttempted = 0;

    await pLimitSettled(
      orgRepos.map((repo) => async () => {
          const repoFullName = `${owner}/${repo.name}`;

          // Fetch PRs by this author
          const [prsRes, commitsRes] = await Promise.allSettled([
            octokit.rest.pulls.list({
              owner,
              repo: repo.name,
              state: "closed",
              per_page: 30,
              sort: "updated",
              direction: "desc",
            }),
            octokit.rest.repos.listCommits({
              owner,
              repo: repo.name,
              author: login,
              since,
              per_page: 100,
            }),
          ]);
          if (prsRes.status !== "fulfilled") reposPrFailed++;
          if (commitsRes.status !== "fulfilled") reposCommitsFailed++;

          // Process PRs authored by login
          if (prsRes.status === "fulfilled") {
            const prs = prsRes.value.data.filter(
              (pr) =>
                pr.user?.login === login &&
                new Date(pr.created_at).getTime() >= ninetyDaysAgo.getTime()
            );

            for (const pr of prs) {
              const hoursToMerge = pr.merged_at
                ? (new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime()) / 3_600_000
                : null;

              // additions/deletions are returned by the API but not typed in Octokit's list response
              const prAny = pr as unknown as { additions?: number; deletions?: number };

              allPrs.push({
                number: pr.number,
                title: pr.title,
                state: pr.merged_at ? "merged" : "closed",
                created_at: pr.created_at,
                merged_at: pr.merged_at ?? null,
                closed_at: pr.closed_at ?? null,
                additions: prAny.additions ?? 0,
                deletions: prAny.deletions ?? 0,
                hours_to_merge: hoursToMerge ? Math.round(hoursToMerge * 10) / 10 : null,
                repo_full_name: repoFullName,
              });

            }

            // Fetch reviews given by login on other people's PRs
            const otherPrs = prsRes.value.data.filter(
              (pr) => pr.user?.login !== login && pr.merged_at
            ).slice(0, 10);

            reviewFetchAttempted += otherPrs.length;
            const reviewResults = await pLimitSettled(
              otherPrs.map((pr) => async () => {
                const { data: reviews } = await octokit.rest.pulls.listReviews({
                  owner,
                  repo: repo.name,
                  pull_number: pr.number,
                  per_page: 100,
                });
                return { pr, reviews };
              }),
              { concurrency: 5 },
            );

            for (const result of reviewResults) {
              if (result.status !== "fulfilled") { reviewFetchRejected++; continue; }
              const { pr, reviews } = result.value;
              const userReviews = reviews.filter(
                (r) => r.user?.login === login && r.submitted_at
              );
              for (const review of userReviews) {
                const turnaround = review.submitted_at
                  ? (new Date(review.submitted_at).getTime() - new Date(pr.created_at).getTime()) / 3_600_000
                  : null;

                allReviews.push({
                  pr_number: pr.number,
                  pr_title: pr.title,
                  state: review.state,
                  submitted_at: review.submitted_at!,
                  turnaround_hours: turnaround ? Math.round(turnaround * 10) / 10 : null,
                  repo_full_name: repoFullName,
                });

              }
            }
          }

          // Process commits
          if (commitsRes.status === "fulfilled") {
            const commits = commitsRes.value.data;
            if (commits.length > 0) {
              reposContributed.add(repoFullName);
            }
            totalCommits += commits.length;

            // Track language from repo
            if (repo.language && commits.length > 0) {
              repoLangs[repo.language] = (repoLangs[repo.language] ?? 0) + commits.length;
            }

            for (const commit of commits) {
              const date = commit.commit.author?.date ?? commit.commit.committer?.date;
              if (!date) continue;
              const d = new Date(date);
              const dayStr = date.slice(0, 10);
              commitCounts[dayStr] = (commitCounts[dayStr] ?? 0) + 1;
              commitHours[d.getUTCHours()]++;

              // Active days per week (last 4 weeks)
              const weeksAgo = Math.floor(
                (now.getTime() - d.getTime()) / (7 * 24 * 60 * 60 * 1000)
              );
              if (weeksAgo >= 0 && weeksAgo < 4) {
                commitDays[weeksAgo].add(dayStr);
              }
            }
          }
      }),
      { concurrency: 5 },
    );

    // ── Compute aggregated metrics ────────────────────────────────────────────

    const mergedPrs = allPrs.filter((pr) => pr.state === "merged");
    const closedWithoutMerge = allPrs.filter((pr) => pr.state === "closed");

    const prsOpened = allPrs.length;
    const prsMerged = mergedPrs.length;
    const prsClosedWithoutMerge = closedWithoutMerge.length;
    const prMergeRate =
      prsOpened > 0 ? Math.round((prsMerged / prsOpened) * 100) : 0;

    const mergeTimes = mergedPrs
      .map((pr) => pr.hours_to_merge)
      .filter((h): h is number => h !== null);
    const avgHoursToMerge =
      mergeTimes.length > 0
        ? Math.round((mergeTimes.reduce((s, h) => s + h, 0) / mergeTimes.length) * 10) / 10
        : 0;

    const prSizes = mergedPrs.map((pr) => pr.additions + pr.deletions);
    const avgPrSize =
      prSizes.length > 0
        ? Math.round(prSizes.reduce((s, sz) => s + sz, 0) / prSizes.length)
        : 0;

    const reviewTurnarounds = allReviews
      .map((r) => r.turnaround_hours)
      .filter((h): h is number => h !== null);
    const avgReviewTurnaround =
      reviewTurnarounds.length > 0
        ? Math.round(
            (reviewTurnarounds.reduce((s, h) => s + h, 0) / reviewTurnarounds.length) * 10
          ) / 10
        : 0;

    // Activity calendar (last 52 weeks)
    const calendarStart = new Date(now);
    calendarStart.setUTCDate(calendarStart.getUTCDate() - 364);
    const activityCalendar: { date: string; count: number }[] = [];
    for (let d = new Date(calendarStart); d <= now; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      activityCalendar.push({ date: key, count: commitCounts[key] ?? 0 });
    }

    // Weekly commits (last 12 weeks)
    const weekMap: Record<string, number> = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i * 7);
      weekMap[getWeekStart(d)] = 0;
    }
    for (const [dateStr, count] of Object.entries(commitCounts)) {
      const w = getWeekStart(new Date(dateStr));
      if (w in weekMap) weekMap[w] = (weekMap[w] ?? 0) + count;
    }
    const weeklyCommits = Object.entries(weekMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week_start, count]) => ({ week_start, count }));

    // After-hours percentage (outside 9-18 UTC)
    const totalCommitsByHour = commitHours.reduce((s, c) => s + c, 0);
    const afterHoursCount = commitHours
      .filter((_, h) => h < 9 || h >= 18)
      .reduce((s, c) => s + c, 0);
    const afterHoursPct =
      totalCommitsByHour > 0 ? Math.round((afterHoursCount / totalCommitsByHour) * 100) : 0;

    // Active days per week
    const activeDaysPerWeek = commitDays.map((days) => days.size);

    // Languages
    const languages = Object.entries(repoLangs)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Update funnel: opened comes from this user's PRs, reviewed/approved from reviews they gave
    // For the user's own PRs, track reviewed & approved
    const ownPrNumbers = new Set(allPrs.map((pr) => pr.number));
    const ownReviewedPrs = new Set(
      allReviews.filter((r) => ownPrNumbers.has(r.pr_number)).map((r) => r.pr_number)
    );
    const ownApprovedPrs = new Set(
      allReviews
        .filter((r) => ownPrNumbers.has(r.pr_number) && r.state === "APPROVED")
        .map((r) => r.pr_number)
    );

    const response: ContributorProfileResponse = {
      login: user.login,
      avatar_url: user.avatar_url,
      name: user.name ?? null,
      bio: user.bio ?? null,
      company: user.company ?? null,
      location: user.location ?? null,
      html_url: user.html_url,

      prs_opened: prsOpened,
      prs_merged: prsMerged,
      prs_closed_without_merge: prsClosedWithoutMerge,
      pr_merge_rate: prMergeRate,
      avg_hours_to_merge: avgHoursToMerge,
      avg_pr_size: avgPrSize,
      recent_prs: allPrs.slice(0, 20),

      reviews_given: allReviews.length,
      avg_review_turnaround_hours: avgReviewTurnaround,
      recent_reviews: allReviews.slice(0, 20),

      total_commits_90d: totalCommits,
      activity_calendar: activityCalendar,
      weekly_commits: weeklyCommits,
      commit_hour_distribution: commitHours,
      active_days_per_week: activeDaysPerWeek,
      after_hours_pct: afterHoursPct,

      funnel: {
        opened: prsOpened,
        reviewed: ownReviewedPrs.size,
        approved: ownApprovedPrs.size,
        merged: prsMerged,
      },

      languages,
      repos_contributed: Array.from(reposContributed),

      partial: reposPrFailed + reposCommitsFailed + reviewFetchRejected > 0,
      fetched_requests:
        orgRepos.length * 2 - reposPrFailed - reposCommitsFailed + reviewFetchAttempted - reviewFetchRejected,
      total_requests_attempted: orgRepos.length * 2 + reviewFetchAttempted,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": `private, max-age=${CACHE_TTL}, stale-while-revalidate=600`,
      },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch contributor profile");
  }
}
