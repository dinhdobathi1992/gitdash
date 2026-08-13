# Repository Overview: DORA Metrics Integration Plan

> **⚠️ ARCHIVED — IMPLEMENTED.** This plan has shipped. It is kept for historical
> reference only. The work landed under different names than proposed here:
> the API route is `src/app/api/github/repo-dora/route.ts`, the logic lives in
> `src/lib/github-dora.ts` (+ benchmarks in `src/lib/dora.ts`), and the UI shipped
> as `src/components/DoraKpiCards.tsx` / `DoraDrillDown.tsx` (not the `DoraScorecard.tsx`
> named below). Do not treat file/component names in this document as current.

## 1. Goal
Enhance the GitDash Repository Overview page (`/repos/[owner]/[repo]`) by introducing a dedicated **DORA Performance** section. This section will shift focus from purely CI/CD workflow metrics to overall engineering velocity by analyzing Pull Request lifecycle and throughput.

## 2. Current State vs. Target State

**Current State (`page.tsx`):**
- Displays a breadcrumb navigation.
- Shows a line chart tracking Workflow Durations.
- Lists all GitHub Actions workflows with health scores, trends, and recent runs.
- **Missing:** Any context about Pull Requests, Lead Time, or Merge Frequency.

**Target State:**
- Add a high-level "DORA Scorecard" above the Workflow table.
- Display PR Cycle Time (Lead Time for Changes).
- Display PR Merge Throughput (Deployment Frequency).
- Display Workflow Stability (Change Failure Rate proxy).
- Keep the existing workflow table but position it as the underlying CI/CD engine supporting the DORA metrics.

## 3. New Data Requirements (Backend/API)

To power the DORA metrics, we need to create a new API endpoint or extend the existing GitHub lib to fetch Pull Request data. 

**New Function needed in `src/lib/github.ts` or a new `pr.ts`:**
```typescript
export interface PRMetrics {
  total_merged: number;
  average_time_to_merge_ms: number; // Lead Time for Changes
  average_time_to_review_ms: number; // Pickup time
  average_pr_size_lines: number;
  merge_frequency_per_day: number; // Deployment Frequency
}
```

*Implementation detail:* This requires fetching merged PRs using the GitHub GraphQL API or REST API (`GET /repos/{owner}/{repo}/pulls?state=closed`), filtering for merged ones, and calculating the time diffs between `created_at`, `merged_at`, and the first `reviewed_at` event.

## 4. UI/UX Changes (`src/app/repos/[owner]/[repo]/page.tsx`)

### A. The "DORA Scorecard" Section
Insert a new grid of 4 KPI cards directly below the page header and above the existing "Duration Trend" chart.

**Card 1: Lead Time for Changes (PR Cycle Time)**
- **Value:** e.g., "1.2 Days"
- **Subtext:** Average time from PR Open to Merge (Last 30 days)
- **Status/Color:** Elite (< 1 day) = Green, High (1-7 days) = Blue, Medium (1-30 days) = Yellow, Low = Red.

**Card 2: Deployment Frequency (Merge Throughput)**
- **Value:** e.g., "5.4 / Day"
- **Subtext:** Average PRs merged to main per day.
- **Status/Color:** Elite (Multiple per day) = Green, etc.

**Card 3: Change Failure Rate (Main Branch Stability)**
- **Value:** e.g., "4.2%"
- **Subtext:** Percentage of default branch workflow runs that failed.
- **Status/Color:** Based on `dora.ts` definitions.

**Card 4: Time to Restore Service (Optional/Proxy)**
- *Note:* If true MTTR (Time to Revert) is too complex to calculate via PRs initially, we can show "Average Workflow Recovery Time" or omit it in V1.

### B. PR Size vs. Velocity Scatterplot (Optional Expansion)
If the API can return a list of recent PRs with `lines_changed` and `time_to_merge`, we can add a Recharts Scatterplot next to the existing Workflow Duration chart. 
- **X-Axis:** Lines of Code Changed
- **Y-Axis:** Time to Merge (Hours)
- **Insight:** Proves to users that small PRs merge significantly faster.

## 5. Implementation Steps

1. **Backend / API Update:**
   - Create a new API route `src/app/api/github/repo-dora/route.ts`.
   - Implement the logic to fetch the last ~100 merged PRs for the repo and calculate `average_time_to_merge_ms` and `total_merged`.
   - Calculate the main branch failure rate using existing Workflow run data.

2. **UI Component Creation:**
   - Create `src/components/DoraScorecard.tsx`.
   - Design the 4 KPI cards using Tailwind classes matching the GitDash aesthetic (`bg-slate-900/40 border border-slate-800`).
   - Use Lucide icons (e.g., `Clock` for Lead Time, `GitMerge` for Frequency, `AlertTriangle` for CFR).

3. **Page Integration:**
   - In `src/app/repos/[owner]/[repo]/page.tsx`, add a new `useSWR` call: `useSWR('/api/github/repo-dora', fetcher)`.
   - Render `<DoraScorecard metrics={doraData} />` above the duration chart.

## 6. Visual Layout Concept

```text
[ Breadcrumb: Org / Repo ]
# owner/repo                                     [Audit] [Team] [Security] [Refresh] [View on GitHub]

-------------------------------------------------------------------------------------------------
|  Lead Time (PRs)      |  Merge Frequency      |  Change Failure Rate  |  Mean Time to Restore  |
|  1.2 Days             |  5.4 / Day            |  4.2%                 |  2.5 Hours             |
|  🟢 Elite Performance |  🟢 Elite Performance |  🔵 High Performance  |  🟢 Elite Performance  |
-------------------------------------------------------------------------------------------------

[ Existing Workflow Duration Line Chart ]

[ Existing Workflow Search & Table ]
```
