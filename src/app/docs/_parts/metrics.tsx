"use client";

import { Rocket, GitBranch, Shield, Users, Activity, TrendingUp, Bell, BarChart3 } from "lucide-react";
import { Callout } from "@/components/docs/Callout";
import { Code } from "@/components/docs/CodeBlock";
import { DocCard, DocTable } from "@/components/docs/DocCard";
import { SectionHeading, SubHeading, ProseP, VersionBadge } from "./primitives";

// ─────────────────────────────────────────────────────────────────────────────
// ── Metrics Reference ─────────────────────────────────────────────────────────

export function MetricsReference({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const PAGES = [
    { id: "metrics-dora",        icon: Rocket,     label: "DORA 4 Keys",         desc: "Deploy Frequency, Lead Time, Change Failure Rate, MTTR — the industry standard delivery benchmarks." },
    { id: "metrics-pr-cycle",    icon: GitBranch,  label: "PR Cycle Time",        desc: "The four phases of a PR's life: Time to Open, Pickup Time, Review Time, and Merge Time." },
    { id: "metrics-pr-health",   icon: Activity,   label: "PR Lifecycle Health",  desc: "Open PRs, Review P50/P90, Abandon Rate, Age Distribution, and concurrent WIP per author." },
    { id: "metrics-workflow",    icon: BarChart3,  label: "Workflow Overview",    desc: "Rolling Success Rate, Duration Trend, Outcome Breakdown, Run Frequency, and Optimization Tips." },
    { id: "metrics-performance", icon: TrendingUp, label: "Performance Tab",      desc: "Job Duration avg vs p95, Job Composition per Run, and Slowest Steps rankings." },
    { id: "metrics-reliability", icon: Shield,     label: "Reliability Tab",      desc: "MTTR, Failure Streak, Flaky Branches, Re-run Rate, Pass/Fail Timeline, and Anomaly Detection." },
    { id: "metrics-team",        icon: Users,      label: "Team & People",        desc: "Leaderboard columns, Reviewer Load Matrix, and Bus Factor (80% commit coverage) explained." },
    { id: "metrics-ci-alerts",   icon: Bell,       label: "CI & Alert Metrics",   desc: "CI Workflow metrics, CI-based DORA calculations, and Alert rule trigger conditions." },
  ];

  return (
    <section className="space-y-8">
      <SectionHeading id="metrics-reference" icon={BarChart3}>Metrics Reference</SectionHeading>
      <ProseP>
        Every number GitDash displays is defined here — what it measures, how it is calculated, and
        what a good value looks like. Hover the <Code>?</Code> icon next to any metric in the app
        for a quick reminder. Select a category below to dive in.
      </ProseP>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PAGES.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              onClick={() => onNavigate?.(p.id)}
              className="group text-left rounded-xl border border-slate-800 bg-slate-900/40 p-5 hover:border-violet-500/40 hover:bg-slate-800/60 transition-all"
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="p-2 rounded-lg bg-violet-500/10 text-violet-400">
                  <Icon className="w-4 h-4" />
                </span>
                <span className="text-sm font-semibold text-white group-hover:text-violet-300 transition-colors">{p.label}</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{p.desc}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── Metrics sub-pages ─────────────────────────────────────────────────────────

export function MetricsDora() {
  return (
    <section className="space-y-8">
      <SectionHeading id="metrics-dora" icon={Rocket}>DORA 4 Keys</SectionHeading>
      <DocCard>
        <SubHeading>Repo-level DORA</SubHeading>
        <ProseP>
          The four metrics from the DORA (DevOps Research and Assessment) research programme.
          They measure the speed and stability of software delivery.
          GitDash computes repo-level DORA from real merged PRs and GitHub Releases.
        </ProseP>
        <DocTable
          headers={["Metric", "What it measures", "How it is calculated", "DORA levels"]}
          rows={[
            ["Deploy Frequency", "How often the team ships to production", "Releases (the last 30) per day over the span they cover; repositories without releases use merged pull requests (the last 60 closed) instead, and the card says it is an estimate.", "Elite: ≥1/day · High: ≥1/week · Medium: ≥1/month · Low: <1/month"],
            ["Lead Time for Changes", "Time from writing code to it being in production", "Median time from a pull request's first commit to merge over the merged pull requests among the last 60 closed; the first commit is read for the 20 most recently updated, the rest start at the pull request's creation. p95 is shown alongside.", "Elite: <1h · High: <1d · Medium: <1wk · Low: ≥1wk"],
            ["Change Failure Rate", "How often a change needs fixing in production", "Merged pull requests whose branch matches hotfix, revert, fix-prod or emergency — or whose title starts with \"Revert\" — as a share of merged pull requests.", "Elite: ≤5% · High: ≤15% · Medium: ≤30% · Low: >30%"],
            ["Time to Restore (MTTR)", "How quickly the team recovers", "Mean time from opening to merging those hotfix/revert pull requests. No failures in the window counts as High.", "Elite: <1h · High: <1d · Medium: <1wk · Low: ≥1wk"],
          ]}
        />

        <div className="flex items-center gap-2 mt-5 mb-2">
          <SubHeading>Measured vs estimated</SubHeading>
          <VersionBadge v="4.2.1" />
        </div>
        <ProseP>
          The calculations above are <strong>estimates</strong>, and they fail quietly. A team that
          does not tag releases has its <em>merge rate</em> reported as its deploy rate. A team that
          does not name branches <Code>hotfix</Code> or <Code>revert</Code> gets a change failure
          rate of exactly 0% — which reads as excellence rather than as no signal.
        </ProseP>
        <ProseP>
          When a repository actually uses GitHub&apos;s <strong>Deployments API</strong>, the same
          three metrics become measurable and appear in a separate <strong>Deployments</strong> panel
          on the repository overview, labelled <em>Measured</em>:
        </ProseP>
        <DocTable
          headers={["Metric", "Measured definition"]}
          rows={[
            ["Deploy Frequency", "Successful production deployments per day. A failed rollout is not a delivery, so it does not count."],
            ["Change Failure Rate", "Failed ÷ conclusive production deployments. Pending and in-progress deploys are excluded entirely."],
            ["Time to Restore (MTTR)", "Hours from the first failure of a streak to the next successful deploy on that environment — when it broke, not the last symptom before the fix."],
          ]}
        />
        <Callout type="info">
          The measured figures never silently replace the estimated ones. If a repo has no
          deployments, the panel says so and explains what the numbers above actually represent.
          Knowing which of the two you are reading matters more than the number itself.
        </Callout>
        <ProseP>
          <strong>What actually creates a deployment record</strong> — the most common surprise here
          is a repository that deploys every day through GitHub Actions and still shows nothing
          measured. A workflow that deploys is not the same thing as a deployment record. GitHub
          writes one only when:
        </ProseP>
        <DocTable
          headers={["Trigger", "What it looks like"]}
          rows={[
            ["A job declares an environment", <>A job-level <Code>environment: production</Code> key. This is the usual one-line fix — note that a <Code>workflow_dispatch</Code> input <em>named</em> <Code>environment</Code> does not count, since it is an input rather than a job key.</>],
            ["Something calls the API directly", <>A <Code>POST /repos/&#123;owner&#125;/&#123;repo&#125;/deployments</Code> call, or an action that wraps it. Platform integrations such as Vercel and Heroku do this automatically.</>],
          ]}
        />
        <ProseP>
          Deploying to ECS, Kubernetes or a VM from a plain <Code>run:</Code> step creates no record,
          so those rollouts are invisible to these metrics no matter how often they happen. Adding
          the <Code>environment:</Code> key to the deploy job is normally enough to turn all three
          figures from estimated into measured.
        </ProseP>
        <Callout type="warning">
          If a repository has deployment history but nothing inside the 30-day window, the panel
          flags it <strong>Recording stopped</strong> rather than reporting an absence — it shows how
          many deployments are on record and how long ago the last one was. That gap is usually a
          replaced pipeline or a deploy step that lost its <Code>environment:</Code> key, and it is
          worth investigating rather than ignoring.
        </Callout>
      </DocCard>
      <DocCard>
        <SubHeading>Throughput &amp; Velocity</SubHeading>
        <DocTable
          headers={["Metric", "Definition", "Why it matters"]}
          rows={[
            ["PR Throughput", "Number of PRs merged to the default branch per calendar week, shown over the last 12 weeks.", "A proxy for delivery frequency. Sudden drops highlight blocked sprints, holidays, or process changes."],
            ["PR Size vs. Merge Velocity", "Scatter plot: each dot is a merged PR. X-axis = lines changed (additions + deletions). Y-axis = hours from PR open to merge. The trend line shows the relationship.", "Confirms that smaller PRs merge faster. Share this chart with teams to motivate smaller, more frequent changes."],
            ["Workflow Stability", "Daily pass rate of CI runs on the default branch over 30 days. Plotted as a line chart with Elite (95%) and High (80%) reference lines.", "A persistently failing main branch directly increases Change Failure Rate and slows down all PRs waiting for a green build."],
          ]}
        />
      </DocCard>
    </section>
  );
}

export function MetricsPrCycle() {
  return (
    <section className="space-y-8">
      <SectionHeading id="metrics-pr-cycle" icon={GitBranch}>PR Cycle Time Breakdown</SectionHeading>
      <ProseP>
        Lead Time is split into four sequential phases. Each phase reveals a different bottleneck.
        The proportional bar on the repo overview page shows how much of total lead time each phase consumes.
      </ProseP>
      <DocCard>
        <DocTable
          headers={["Phase", "Start → End", "What a long value means"]}
          rows={[
            ["Time to Open", "Oldest commit on the branch → PR created", "Developers are sitting on local branches too long before opening a PR. Encourages smaller, more frequent PRs."],
            ["Pickup Time", "PR created → first review comment or approval", "Reviewers are slow to start. May indicate too many concurrent open PRs, unclear ownership, or team capacity issues."],
            ["Review Time", "First review → PR approved", "Reviews require many back-and-forth cycles. May indicate large/complex PRs, unclear requirements, or strict standards."],
            ["Merge Time", "PR approved → merged", "CI is slow, there is a merge queue backlog, or developers do not merge promptly after approval."],
          ]}
        />
      </DocCard>
      <Callout type="info">
        The stacked bar on the Repo Overview page colours each phase proportionally.
        Hover any segment to see its raw duration and percentage of total lead time.
      </Callout>
    </section>
  );
}

export function MetricsPrHealth() {
  return (
    <section className="space-y-8">
      <SectionHeading id="metrics-pr-health" icon={Activity}>PR Lifecycle Health</SectionHeading>
      <ProseP>
        These metrics describe the health of currently open and recently closed PRs.
        They appear in the PR lifecycle analytics panel on the repository overview page.
      </ProseP>
      <DocCard>
        <SubHeading>KPI Cards</SubHeading>
        <DocTable
          headers={["Metric", "Definition", "Target range"]}
          rows={[
            ["Open PRs", "Number of pull requests currently in an open state in the repository.", "Depends on team size; watch for a growing trend over time."],
            ["Review P50 (Median)", "The median time between a PR being opened and receiving its first review. Half of PRs are reviewed faster than this value.", "< 4 hours for active repos"],
            ["Review P90", "The 90th-percentile time to first review. 90% of PRs are reviewed within this time. A high gap between P50 and P90 indicates a long tail of ignored PRs.", "< 1 day"],
            ["Abandon Rate", "Percentage of recently closed PRs that were closed without being merged. High rates may indicate PRs opened prematurely, review gatekeeping, or code that was abandoned.", "< 10%"],
            ["Concurrent Open PRs by Author", "Number of open PRs per developer right now. High WIP per person is correlated with context switching, slower reviews, and more defects.", "≤ 2 per author is healthy. ≥ 5 is flagged red."],
          ]}
        />
      </DocCard>
      <DocCard>
        <SubHeading>Charts &amp; Distributions</SubHeading>
        <DocTable
          headers={["Chart", "Definition", "Target"]}
          rows={[
            ["Approval → Merge P50/P90", "Time between a PR receiving final approval and being merged. Measures how quickly approved work is landed.", "< 2 hours"],
            ["Open PR Age Distribution", "Currently open PRs bucketed by age: <1d, 1–3d, 3–7d, 1–2wk, 2+wk. Large buckets on the right indicate blocked or abandoned work.", "Most PRs should be < 3 days old."],
            ["Review Round Distribution", "How many reviews were submitted on each merged PR (every approval, change request or comment review counts as one). 0 = merged without review. 3+ = heavy back-and-forth.", "1–2 rounds is healthy. >3 rounds may indicate unclear specs or large PRs."],
            ["Stale & Unreviewed PRs", "Open, non-draft PRs older than 120 hours (5 calendar days) that have received no review. These directly inflate Review P90 and Pickup Time.", "0 stale PRs is the target."],
          ]}
        />
      </DocCard>
    </section>
  );
}

export function MetricsWorkflow() {
  return (
    <section className="space-y-8">
      <SectionHeading id="metrics-workflow" icon={BarChart3}>Workflow Overview Tab</SectionHeading>
      <ProseP>
        The Overview tab of the Workflow Detail page shows four charts that give a quick health pulse
        for a specific GitHub Actions workflow, plus an Optimization Tips banner.
      </ProseP>
      <DocCard>
        <SubHeading>Overview Charts</SubHeading>
        <DocTable
          headers={["Chart", "What it shows", "How to read it"]}
          rows={[
            ["Rolling Success Rate", "Moving average of CI pass rate over every 7 consecutive runs.", "A dip below the red 80% reference line that persists across multiple windows indicates a systemic problem, not just a fluke failure."],
            ["Action Duration Trend", "Two independent (non-stacked) area series: purple = execution time only (run_started → completed), amber = queue wait only (triggered → run_started). Total elapsed = purple + amber.", "Rising purple = workflow getting slower (test suite growth, cache misses). Rising amber = runner capacity bottleneck. The two series share the Y-axis but are NOT added together."],
            ["Outcome Breakdown", "Donut chart of run conclusions over the last 60 runs: success, failure, cancelled, skipped, timed_out.", "A large failure or timed_out slice needs immediate attention. Cancelled runs often indicate force-pushes interrupting in-flight runs."],
            ["Run Frequency", "Bar chart of runs triggered per calendar day over the last 14 days.", "Gaps are expected on holidays. Unusual spikes may indicate retry storms, misconfigured cron schedules, or a flood of PRs."],
          ]}
        />
      </DocCard>
      <DocCard>
        <SubHeading>Optimization Tips</SubHeading>
        <ProseP>
          GitDash automatically analyses workflow patterns and surfaces actionable suggestions in a
          dismissible banner at the top of the Overview tab. Tips are generated from the last 60 runs.
        </ProseP>
        <DocTable
          headers={["Tip type", "Trigger condition", "Suggested action"]}
          rows={[
            ["Weekend runs", ">50% of runs triggered on Sat/Sun", "Move scheduled/cron workflows to weekday-only schedules to save CI minutes."],
            ["High cancel rate", ">20% of runs cancelled", "Consider using concurrency groups to cancel superseded runs instead of letting them start."],
            ["Long queue wait", "Queue wait P95 > 5 minutes", "Add more runners or switch to larger GitHub-hosted runner tiers."],
            ["High re-run rate", ">10% of runs re-triggered manually", "Investigate flaky tests or infrastructure instability."],
            ["Duration regression", "P95 duration grown >25% in last 14 days vs prior 14 days", "Profile slow jobs — look for cache misses, dependency bloat, or uncapped test parallelism."],
          ]}
        />
      </DocCard>
    </section>
  );
}

export function MetricsPerformance() {
  return (
    <section className="space-y-8">
      <SectionHeading id="metrics-performance" icon={TrendingUp}>Performance Tab</SectionHeading>
      <ProseP>
        The Performance tab of the Workflow Detail page breaks down where time is spent across
        jobs and individual steps, helping you identify the highest-impact optimization targets.
      </ProseP>
      <DocCard>
        <SubHeading>Job Duration</SubHeading>
        <ProseP>
          A horizontal bar chart showing each job&apos;s <strong>average duration</strong> (purple) vs
          its <strong>p95 duration</strong> (blue), displayed in minutes. The gap between
          average and p95 is the &ldquo;tail latency&rdquo; — a large gap means some runs of that
          job are dramatically slower than usual.
        </ProseP>
        <DocTable
          headers={["Column / Series", "Definition"]}
          rows={[
            ["Avg", "Mean duration of that job across all loaded runs."],
            ["p95", "95th-percentile duration — 95% of runs of that job finish within this time. A rising p95 is a stronger signal of regression than a rising average."],
            ["Gap (avg → p95)", "Large gaps indicate non-deterministic jobs: slow on some runs, fast on others. Common causes: cache misses, test flakiness, or shared infrastructure contention."],
          ]}
        />
      </DocCard>
      <DocCard>
        <SubHeading>Job Composition per Run</SubHeading>
        <ProseP>
          A stacked bar chart showing the last 20 runs on the X-axis and total run duration on the
          Y-axis. Each bar is segmented by job, colour-coded consistently. This reveals which job
          dominates total run time and whether that share is growing.
        </ProseP>
        <Callout type="info">
          Hover any segment to see the exact job name and its duration for that run.
          A sudden change in a job&apos;s share often corresponds to a code change in that job&apos;s steps.
        </Callout>
      </DocCard>
      <DocCard>
        <SubHeading>Slowest Steps</SubHeading>
        <ProseP>
          A ranked table of the top 10 individual <strong>step names</strong> by average runtime,
          aggregated across all jobs and loaded runs. Each row shows: step name, job context,
          run count, average, p95, max durations, and success %.
        </ProseP>
        <DocTable
          headers={["Column", "What it means"]}
          rows={[
            ["RUNS", "Number of runs in which this step executed (denominator for averages)."],
            ["AVG", "Mean step duration in seconds across all runs."],
            ["P95", "95th-percentile step duration. Use this to size timeouts and SLOs."],
            ["MAX", "Worst observed duration for this step — a ceiling for worst-case pipeline time."],
            ["SUCCESS %", "Percentage of step executions that completed successfully. Low values indicate a flaky step."],
          ]}
        />
      </DocCard>
    </section>
  );
}

export function MetricsReliability() {
  return (
    <section className="space-y-8">
      <SectionHeading id="metrics-reliability" icon={Shield}>Reliability Tab</SectionHeading>
      <ProseP>
        The Reliability tab surfaces failure patterns, recovery speed, and non-deterministic
        behaviour in your CI workflows.
      </ProseP>
      <DocCard>
        <SubHeading>KPI Cards</SubHeading>
        <DocTable
          headers={["Metric", "Definition", "Target"]}
          rows={[
            ["MTTR", "Mean Time To Recovery — the average time between a failing run and the next successful run on the same branch. Measures how quickly the team resolves CI breakages.", "< 1 hour (DORA Elite)"],
            ["Failure Streak", "Number of consecutive failed runs on the default branch with no successful run in between. Any streak ≥ 3 is flagged red.", "0 — any streak warrants immediate attention."],
            ["Flaky Branches", "Number of branches where the last 10 runs alternated between success and failure (flip-flop pattern). Indicates non-deterministic tests or environment instability.", "0 flaky branches"],
            ["Re-run Rate", "Percentage of runs that were manually re-triggered (run_attempt > 1). A high rate is a strong signal of flaky tests or infrastructure instability.", "< 5%"],
          ]}
        />
      </DocCard>
      <DocCard>
        <SubHeading>Charts</SubHeading>
        <DocTable
          headers={["Chart", "What it shows", "How to read it"]}
          rows={[
            ["Pass / Fail Timeline", "Bar chart of run outcomes ordered chronologically. Green bars = success (+1), red bars = failure (−1).", "Clusters of red reveal outage duration and frequency. Hover a bar to see the run number and conclusion."],
            ["Flaky Branches", "Badge list of branches that exhibited flip-flop outcomes in the last 10 runs.", "Any branch listed here has non-deterministic CI. Investigate and quarantine unstable tests."],
            ["Anomaly Detection", "Runs whose duration deviated more than 2 standard deviations from a rolling 10-run baseline.", "Classified as moderate (2–3 stddev) or extreme (> 3 stddev). Investigate for stuck jobs, infrastructure issues, or abnormally large changesets."],
          ]}
        />
      </DocCard>
      <DocCard>
        <SubHeading>CI / Workflow Metrics</SubHeading>
        <DocTable
          headers={["Metric", "Definition", "Good range"]}
          rows={[
            ["Success Rate", "Percentage of completed workflow runs that finished with conclusion = success over the selected window.", "> 90%"],
            ["Duration P95", "The 95th-percentile run duration. 95% of runs complete faster than this value. A rising P95 indicates flaky or slow test suites.", "Depends on workflow type; watch for upward trend."],
            ["Queue Wait P95", "The 95th-percentile time between a run being triggered and its first job actually starting. High values indicate runner capacity constraints.", "< 2 minutes for self-hosted; < 5 min for GitHub-hosted."],
            ["Avg Queue Wait", "Mean runner wait time across all runs. This is pure infrastructure overhead — not code or test execution time.", "< 1 minute ideally."],
          ]}
        />
      </DocCard>
    </section>
  );
}

export function MetricsTeam() {
  return (
    <section className="space-y-8">
      <SectionHeading id="metrics-team" icon={Users}>Team &amp; People Metrics</SectionHeading>
      <ProseP>
        These metrics appear in the Team Insights leaderboard and Contributor Profile pages.
        They focus on individual delivery patterns rather than repository-level aggregates.
      </ProseP>
      <DocCard>
        <SubHeading>Team Leaderboard Columns</SubHeading>
        <DocTable
          headers={["Column", "Calculation", "What to look for"]}
          rows={[
            ["PRs Merged", "Count of PRs authored by this person that were merged to the default branch in the last 90 days.", "Baseline throughput indicator. Low counts combined with high WIP may signal blockers."],
            ["Reviews Given", "Count of PR reviews submitted by this person in the last 90 days (all states: approved, changes requested, commented).", "Identifies reviewers who carry a disproportionate load, and those who rarely review."],
            ["Avg Lead Time", "Average time from the first commit on each PR to merge, across all PRs this person authored.", "Compare against team median. High individual lead time may mean large PRs or slow code review."],
            ["Avg PR Size", "Average lines changed (additions + deletions) per merged PR.", "Smaller is usually better. Large average sizes increase review time and defect risk."],
            ["Review Response", "Median time between a PR being opened and this person submitting their first review on that PR.", "High values indicate a slow reviewer or reviewer overload."],
            ["First-Pass Approval Rate", "Percentage of PRs this person authored that were approved on the first review round (no changes-requested cycle).", "High rates indicate clear PR descriptions and well-scoped changes."],
            ["Self-Merges", "PRs the author merged themselves without any other approver.", "Occasional self-merges are fine (hotfixes). A high rate may indicate a lack of code review culture."],
            ["After-Hours Commits %", "Percentage of commits made outside the organization's workday (default Asia/Saigon 08:00–19:00, set in Settings). Visible in the commit hour distribution chart on the contributor profile.", "A proxy for burnout risk. A sustained high rate warrants a conversation about workload."],
          ]}
        />
      </DocCard>
      <DocCard>
        <SubHeading>Reviewer Load Matrix</SubHeading>
        <ProseP>
          A heatmap where rows are PR authors and columns are reviewers.
          Each cell shows how many of that author&apos;s PRs were reviewed by that reviewer.
          Dark cells indicate a concentrated review relationship.
        </ProseP>
        <DocTable
          headers={["Signal", "Meaning"]}
          rows={[
            ["One reviewer in nearly every row", "Single-point-of-failure reviewer — a bottleneck and a bus-factor risk."],
            ["One author never reviewed by anyone", "Possible self-merge pattern or team isolation — worth investigating."],
            ["Balanced matrix (many medium-shade cells)", "Healthy cross-reviewing culture with distributed knowledge."],
          ]}
        />
      </DocCard>
      <DocCard>
        <SubHeading>Bus Factor</SubHeading>
        <ProseP>
          The bus factor of a module is the minimum number of team members whose absence would
          severely impact the project. GitDash computes it per file-path prefix as the smallest
          number of authors who together made 80% of the module&apos;s commits.
        </ProseP>
        <DocTable
          headers={["Term", "Definition"]}
          rows={[
            ["Bus factor", "Smallest number of authors whose commits add up to at least 80% of a module's commits. A module is the first two path segments (one for files one level deep, (root) for top-level files)."],
            ["Window", "The last 90 days, at most 300 commits. A commit counts once per module it touches. Bot commits are counted."],
            ["Risk threshold", "Bus factor 1 is critical, 2 is a warning, 3 or more is healthy."],
          ]}
        />
      </DocCard>
    </section>
  );
}

export function MetricsCiAlerts() {
  return (
    <section className="space-y-8">
      <SectionHeading id="metrics-ci-alerts" icon={Bell}>CI &amp; Alert Metrics</SectionHeading>

      <DocCard>
        <SubHeading>CI-based DORA (Workflow DORA Tab)</SubHeading>
        <Callout type="info">
          The Workflow Detail page has a dedicated <strong>DORA tab</strong> that computes the 4 Keys
          from CI run data rather than from PRs and GitHub Releases. This gives a workflow-level
          proxy view of delivery performance.
        </Callout>
        <DocTable
          headers={["Metric", "CI-based calculation", "Difference from repo-level DORA"]}
          rows={[
            ["Deploy Frequency", "Completed runs (any result) per day over the span of the runs loaded for this workflow (50 by default). No branch filter.", "Repo-level uses Releases or merged PRs. CI-based counts every successful workflow run — useful for workflows that deploy on every merge."],
            ["Lead Time", "Median time from a run being created to it completing (queue wait plus execution); p95 alongside.", "Repo-level measures first commit → PR merged. CI-based measures only the CI run itself — no coding or review time."],
            ["Change Failure Rate", "Percentage of completed runs whose conclusion is failure (timed-out, cancelled and skipped runs are not failures but stay in the denominator).", "Repo-level uses hotfix/revert PR heuristics. CI-based is a direct CI failure rate — more precise but only reflects build failures, not production incidents."],
            ["MTTR", "Average time from a failed run to the next successful run on the same branch.", "Repo-level uses hotfix PR cycle time. CI-based measures build recovery time — does not account for manual intervention or rollbacks."],
          ]}
        />
        <ProseP>
          The DORA tab also shows a <strong>DORA Performance Levels</strong> reference table with the
          industry benchmarks from the State of DevOps Report for all four metrics.
        </ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Alert Metrics</SubHeading>
        <ProseP>
          Alert rules in the Alerts page use these metrics. Each rule fires when the metric crosses
          the configured threshold within the evaluation window.
        </ProseP>
        <DocTable
          headers={["Metric", "Category", "Fires when…"]}
          rows={[
            ["Failure Rate", "CI", "% of failed runs in the window exceeds threshold"],
            ["Duration P95", "CI", "95th-percentile run duration (minutes) exceeds threshold"],
            ["Queue Wait P95", "CI", "95th-percentile queue wait (minutes) exceeds threshold"],
            ["Success Streak", "CI", "Consecutive failures without a success exceeds threshold"],
            ["PR Throughput Drop", "People", "Merged PRs this week dropped by more than N% vs the prior week"],
            ["Review Response P90", "People", "P90 time-to-first-review exceeds N hours"],
            ["After-Hours Commits %", "People", "% of commits outside the organization's workday exceeds threshold"],
            ["PR Abandon Rate", "People", "% of PRs closed without merge exceeds threshold"],
            ["Unreviewed PR Age", "People", "Any open PR has been waiting for a first review for more than N business days"],
          ]}
        />
      </DocCard>
    </section>
  );
}
