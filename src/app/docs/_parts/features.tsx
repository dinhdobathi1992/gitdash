"use client";

import {
  Activity, Bell, BarChart3, Building2, ChevronRight, CircleDot, DollarSign, FileText, GitPullRequest, Layers,
  List, ListChecks, ShieldAlert, Sliders, Sparkles, TrendingUp, Trophy, User, Users,
} from "lucide-react";
import { Callout } from "@/components/docs/Callout";
import { Code } from "@/components/docs/CodeBlock";
import { DocCard, DocTable } from "@/components/docs/DocCard";
import { SectionHeading, SubHeading, ProseP, VersionBadge, FeaturePageHeader, ScreenshotSlot } from "./primitives";

/** A feature switch, as named in Settings → My features and Admin → Permissions. */
function Flag({ k }: { k: string }) {
  return <Code>{k}</Code>;
}

type FeaturePage = { id: string; name: string; path: string; desc: string; flag?: string; since?: string };

// Index order follows the app's own navigation.
const PAGES: FeaturePage[] = [
  { id: "feat-repositories", name: "Repositories", path: "/", desc: "Every repository with status, success rate, recent runs and p95 duration; what needs attention first." },
  { id: "feat-repo-overview", name: "Repository · Overview", path: "/repos/[owner]/[repo]", desc: "DORA four keys, deployments, run duration and outcomes for one repository.", flag: "dora" },
  { id: "feat-repo-workflows", name: "Repository · Workflows", path: "/repos/[owner]/[repo]/workflows", desc: "Every workflow in the repository with its health, ready to open.", since: "4.5.0" },
  { id: "feat-repo-pulls", name: "Repository · Pull requests", path: "/repos/[owner]/[repo]/pulls", desc: "Review speed, open-PR age, review rounds and stale pull requests.", flag: "prLifecycle", since: "4.5.0" },
  { id: "feat-repo-team", name: "Repository · Team", path: "/repos/[owner]/[repo]/team", desc: "Who ships and reviews, reviewer load, bus factor, workload risk and runners." },
  { id: "feat-issues", name: "Repository · Issues", path: "/repos/[owner]/[repo]/issues", desc: "Backlog direction, time to close and triage debt." },
  { id: "feat-security", name: "Repository · Security", path: "/repos/[owner]/[repo]/security", desc: "GitHub security alerts plus static analysis of workflow files.", flag: "securityScan" },
  { id: "feat-audit", name: "Repository · Audit trail", path: "/repos/[owner]/[repo]/audit", desc: "Every change to the repository's workflow files." },
  { id: "feat-workflow", name: "Workflow detail", path: "/repos/[owner]/[repo]/workflows/[id]", desc: "One workflow in depth: runs, performance, reliability, triggers and DORA." },
  { id: "feat-alerts", name: "Alerts", path: "/alerts", desc: "Rules on CI and people metrics, delivery history and the weekly leadership digest." },
  { id: "feat-team", name: "Team insights", path: "/team", desc: "A repository's contributors side by side, with the reviewer heatmap." },
  { id: "feat-contributor", name: "Contributor profile & 1:1 prep", path: "/contributor/[login]?owner=[org]", desc: "One person's activity within an organization, pull-request funnel and a printable 1:1 brief." },
  { id: "feat-cost", name: "Cost", path: "/cost-analytics", desc: "GitHub Actions spend by day, runner type and repository, with savings ideas.", flag: "costAnalytics" },
  { id: "feat-reports", name: "Reports", path: "/reports", desc: "Long-term trends and quarterly comparisons from the database." },
  { id: "feat-org", name: "Org overview & health scorecard", path: "/org/[org] · /org/[org]/health", desc: "Every repository in an organization, ranked by delivery health.", flag: "healthScorecard" },
  { id: "feat-settings", name: "Settings", path: "/settings", desc: "Your features and notifications; for admins, access, members, AI, email and audit." },
  { id: "feat-ai-insights", name: "AI insights", path: "repository overview, workflow, health scorecard", desc: "Plain-English analysis of the numbers on screen. Optional.", flag: "aiInsights" },
];

// ── Index ─────────────────────────────────────────────────────────────────────

export function Features({ onNavigate }: { onNavigate: (id: string) => void }) {
  return (
    <section id="features" className="scroll-mt-20 space-y-6">
      <SectionHeading id="features" icon={Layers}>Feature overview</SectionHeading>

      <ProseP>
        Screens are listed in the order of the app&apos;s sidebar. A <Flag k="feature" /> tag is the switch in
        Settings → My features (standalone) or the grant in Admin → Permissions (organization mode) that shows or hides
        it.
      </ProseP>

      <div className="grid gap-3">
        {PAGES.map((p) => (
          <button
            key={p.id}
            onClick={() => onNavigate(p.id)}
            className="group w-full text-left rounded-card border border-line bg-panel p-4 hover:border-brand-fg/40 hover:bg-raised transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-fg group-hover:text-link">{p.name}</span>
                  <Code>{p.path}</Code>
                  {p.flag && <Flag k={p.flag} />}
                  {p.since && <VersionBadge v={p.since} />}
                </div>
                <p className="text-[13px] text-muted">{p.desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-faint group-hover:text-link shrink-0 mt-0.5" />
            </div>
          </button>
        ))}
      </div>

      <DocCard>
        <SubHeading>DORA in two places</SubHeading>
        <DocTable
          headers={["Where", "Measured from"]}
          rows={[
            ["Repository overview", "Merged pull requests and GitHub releases — the delivery pipeline. Repositories without releases are estimated from merged pull requests, and the card says so."],
            ["Workflow detail → DORA", "That workflow's runs — a proxy for the build pipeline."],
          ]}
        />
      </DocCard>
    </section>
  );
}

// ── Repositories ──────────────────────────────────────────────────────────────

export function FeatureRepositories() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={List} name="Repositories" path="/" chips={["Needs attention", "Filters and sort", "Pinned repositories", "Keyboard"]} />
      <ProseP>
        The home screen answers &ldquo;what is wrong right now?&rdquo; before listing everything. Pick the organization
        (or your personal account) in the sidebar switcher and a time range of 24 hours, 7, 30 or 90 days.
      </ProseP>
      <ScreenshotSlot file="repos.jpg" alt="Repositories home" />
      <DocTable
        headers={["Part", "What it shows"]}
        rows={[
          ["Summary strip", "Workflow runs, success rate, p95 run duration and p95 queue wait, each compared with the previous period."],
          ["Needs attention", "Firing alerts and failing repositories, most urgent first."],
          ["All repositories", "Status, success rate, the last 10 runs, p95 duration and last run. Filter by name, status (failing, running, pinned) and language; sort, and switch row density."],
          ["Health scorecard", "Opens the organization's health ranking (see Org overview & health scorecard)."],
        ]}
      />
      <Callout type="info">
        Keyboard: <Code>/</Code> focuses the filter, <Code>↑</Code>/<Code>↓</Code> move, <Code>↵</Code> opens and{" "}
        <Code>p</Code> pins; <Code>?</Code> lists the shortcuts. Pinned repositories also appear in the sidebar.
      </Callout>
    </section>
  );
}

// ── Repository tabs ───────────────────────────────────────────────────────────

export function FeatureRepoOverview() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={BarChart3} name="Repository · Overview" path="/repos/[owner]/[repo]" chips={["DORA four keys", "Deployments", "Run duration", "Outcomes"]} />
      <ProseP>
        Each repository has one header — status, default branch, workflow count, last run, pin and a link to GitHub —
        and tabs for Overview, Workflows, Pull requests, Team, Issues, Security and Audit trail.
      </ProseP>
      <ScreenshotSlot file="repo-overview.jpg" alt="Repository overview" />
      <DocTable
        headers={["Section", "What it shows", "Feature"]}
        rows={[
          ["AI summary", "A short reading of the page's metrics, with the evidence behind it.", <Flag key="a" k="aiInsights" />],
          ["Delivery performance", "Deploy frequency, lead time, change failure rate and time to restore over 30 days, each with its DORA level (Elite to Low) and how it is measured. The drill-down adds cycle-time breakdown, size vs. velocity, throughput and stability.", <Flag key="d" k="dora" />],
          ["Deployments", "Deployments recorded through GitHub's Deployments API, by environment.", "—"],
          ["Run duration", "How long workflow runs take over time.", <Flag key="p" k="performanceTab" />],
          ["Outcomes", "Success, failure and cancelled runs, and the jobs that fail most.", "—"],
          ["Workflows", "The repository's workflows with their health; open one for Workflow detail.", "—"],
        ]}
      />
    </section>
  );
}

export function FeatureRepoWorkflows() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={Activity} name="Repository · Workflows" path="/repos/[owner]/[repo]/workflows" chips={["Status", "Success rate", "Last 10 runs", "p95"]} since="4.5.0" />
      <ProseP>
        Every workflow in the repository in one table — status, success rate, the last 10 runs, run count, p95
        duration and last run — so the failing or slow one is easy to spot. Open a row for Workflow detail.
      </ProseP>
      <ScreenshotSlot file="repo-workflows.jpg" alt="Repository workflows" />
    </section>
  );
}

export function FeatureRepoPulls() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={GitPullRequest} name="Repository · Pull requests" path="/repos/[owner]/[repo]/pulls" chips={["Review speed", "PR age", "Review rounds", "Stale PRs"]} since="4.5.0" />
      <ProseP>
        How pull requests move through review. Needs the <Flag k="prLifecycle" /> feature. The definitions are in
        Metrics reference → PR lifecycle health.
      </ProseP>
      <ScreenshotSlot file="repo-pulls.jpg" alt="Repository pull requests" />
      <DocTable
        headers={["Section", "Answers"]}
        rows={[
          ["Time to first review (P50/P90)", "How long authors wait for a first review."],
          ["Open PR age distribution", "Whether open pull requests are fresh or piling up."],
          ["Review round distribution", "How many review rounds a pull request takes before merging."],
          ["Stale & unreviewed PRs", "Pull requests nobody has reviewed or touched recently."],
          ["Concurrent open PRs by author", "Who is juggling too many pull requests at once."],
        ]}
      />
    </section>
  );
}

export function FeatureRepoTeam() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={Trophy} name="Repository · Team" path="/repos/[owner]/[repo]/team" chips={["CI contributors", "PR leaderboard", "Reviewer load", "Bus factor", "Workload risk"]} />
      <ProseP>
        Who ships and who reviews in this repository. Sections that need extra GitHub calls are switched on per
        feature; a disabled one says which feature it needs.
      </ProseP>
      <ScreenshotSlot file="repo-team.jpg" alt="Repository team" />
      <DocTable
        headers={["Section", "What it shows", "Feature"]}
        rows={[
          ["CI contributors", "Runs, success rate and average duration per person who triggered CI.", "—"],
          ["PR leaderboard", "Merge volume, review load and lead time per contributor.", "—"],
          ["Reviewer load matrix", "Who reviews whose pull requests (rows are authors, columns reviewers).", "—"],
          ["Review bottleneck", "Overloaded reviewers and single points of failure in review.", <Flag key="r" k="reviewBottleneck" />],
          ["Workload risk radar", "Sustained after-hours or weekend work, activity cliffs and too many concurrent pull requests — conversation starters, not verdicts.", <Flag key="w" k="workloadRisk" />],
          ["Knowledge & bus factor map", "Per-module contributor count and concentration; modules only one person knows.", <Flag key="b" k="busFactor" />],
          ["Runner utilization", "Jobs, duration and failure rate per runner.", <Flag key="u" k="runnerUtilization" />],
        ]}
      />
    </section>
  );
}

export function FeatureIssues() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={CircleDot} name="Repository · Issues" path="/repos/[owner]/[repo]/issues" chips={["Backlog direction", "Time to close", "Triage debt", "Backlog by age"]} />
      <ProseP>
        The demand side of engineering: is the backlog growing or draining, how long work takes to close, and what has
        sat untouched. Two triage-debt signals — unlabelled issues and issues nobody has replied to — show work that
        was never routed.
      </ProseP>
      <ScreenshotSlot file="repo-issues.jpg" alt="Repository issues" />
    </section>
  );
}

export function FeatureSecurity() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={ShieldAlert} name="Repository · Security" path="/repos/[owner]/[repo]/security" chips={["Dependabot", "Code scanning", "Secret scanning", "Workflow analysis"]} />
      <ScreenshotSlot file="repo-security.jpg" alt="Repository security" />
      <DocTable
        headers={["Section", "What it shows"]}
        rows={[
          ["GitHub security alerts", "Dependabot, code-scanning and secret-scanning alerts with counts, oldest open and time to fix. Each source reports its own status: a feature switched off on the repository shows as “Not enabled”, a token without access as a permission warning — never as zero alerts."],
          ["Workflow static analysis", <>Checks workflow files for risky patterns — <Code key="p">pull_request_target</Code> triggers, secrets echoed to logs, passed as arguments or written to outputs, unquoted dispatch inputs, actions pinned to a branch, missing timeouts or permissions — grouped by severity. Needs the <Flag key="f" k="securityScan" /> feature.</>],
        ]}
      />
      <Callout type="info">
        A classic token with <Code>repo</Code> reads all three alert sources; fine-grained tokens need the matching
        read permissions for Dependabot, code scanning and secret scanning.
      </Callout>
    </section>
  );
}

export function FeatureAudit() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={FileText} name="Repository · Audit trail" path="/repos/[owner]/[repo]/audit" chips={["Workflow file history", "Author and time", "Recent changes"]} />
      <ProseP>
        Every commit that touched <Code>.github/workflows/</Code>, with author, time, message and a link to GitHub.
        When a workflow starts failing, this is usually where the answer is.
      </ProseP>
      <ScreenshotSlot file="repo-audit.jpg" alt="Repository audit trail" />
    </section>
  );
}

// ── Workflow detail ───────────────────────────────────────────────────────────

export function FeatureWorkflowDetail() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={Activity} name="Workflow detail" path="/repos/[owner]/[repo]/workflows/[id]" chips={["Overview", "Runs", "Performance", "Reliability", "Triggers", "DORA"]} />
      <ProseP>
        One workflow in depth. The header summarizes success rate, average duration, p95 queue wait, time to recover,
        re-run rate and developer time lost, above the last 40 runs.
      </ProseP>
      <ScreenshotSlot file="workflow-detail.jpg" alt="Workflow detail overview" />
      <DocTable
        headers={["Tab", "What it shows", "Feature"]}
        rows={[
          ["Overview", "Why it is failing, where the time goes, recent runs and concrete ways to speed it up.", "—"],
          ["Runs", "Every run with commit, branch, attempt, queue wait and duration; sortable, filterable, exportable.", "—"],
          ["Performance", "Job duration (average vs. p95), job composition per run and the slowest steps.", <Flag key="p" k="performanceTab" />],
          ["Reliability", "Pass/fail timeline, flaky branches, anomaly detection and AI failure hypotheses.", <><Flag key="r" k="reliabilityTab" />, <Flag key="a" k="anomalyDetection" /></>],
          ["Triggers", "Trigger events, top branches, hour of day, day of week and who triggers runs.", "—"],
          ["DORA", "The workflow's own DORA levels, as a build-pipeline proxy.", "—"],
        ]}
      />
      <Callout type="info">
        With <Flag k="githubIssueFromAnomaly" /> on, an anomaly can be filed as a GitHub issue from a confirmation
        dialog, using your own token. It is off by default and excluded from “Enable all”, because it writes to GitHub.
      </Callout>
    </section>
  );
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export function FeatureAlerts() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={Bell} name="Alerts" path="/alerts" chips={["CI rules", "People rules", "Leadership digest", "Delivery history"]} />
      <ProseP>
        Rules that tell you when a number crosses a line you set. Alerts need organization mode with a database; they
        are evaluated after every sync and delivered in the browser, by email or to Slack — optionally bundled into one
        email a day.
      </ProseP>
      <ScreenshotSlot file="alerts.jpg" alt="Alerts" />
      <DocTable
        headers={["Kind", "Metrics"]}
        rows={[
          ["Runs", "Failure rate, failure streak, p95 duration, queue wait p95, anomalous runs"],
          ["People", "Pull-request throughput drop, review response p90, unreviewed pull-request age, pull-request abandon rate, after-hours commits"],
          ["Leadership", "Weekly leadership digest — an org-wide narrative every Monday; pick an org and a recipient, no threshold"],
        ]}
      />
      <DocCard>
        <SubHeading>Who can do what</SubHeading>
        <ProseP>
          In organization mode only admins create, edit, mute, test or delete rules. Everyone else sees what is firing
          and the rules for repositories and organizations their own token can see, with delivery destinations
          (webhook URLs, email addresses) hidden. Slack destinations must be <Code>https://hooks.slack.com/</Code>{" "}
          webhooks.
        </ProseP>
      </DocCard>
    </section>
  );
}

// ── People ────────────────────────────────────────────────────────────────────

export function FeatureTeamInsights() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={Users} name="Team insights" path="/team" chips={["What stands out", "30 / 90 days", "Human reviews", "People", "Account links"]} />
      <ProseP>
        Pick a repository and a window — 30 or 90 days, for the whole page (<Code>?days=90</Code> survives reload and
        sharing). The page starts with <strong>What stands out</strong>: findings computed from the numbers below, worst
        first, each linking to its section — after-hours work, one person doing every review, merges nobody else
        reviewed, commits over the size limit, pull requests with too many commits, self-merges. Only findings with
        evidence appear; when nothing stands out, it says so.
      </ProseP>
      <ProseP>
        Below: merged pull requests (and how many were opened in the window — a different set), the true median time from
        open to merge, pull requests <strong>reviewed by a human</strong> (a submitted approve, request-changes or comment
        review by someone who is neither a bot nor the author), the reviewer bus factor (fewest people giving half the
        human reviews; aim for 2+), and self-merges. <strong>Who reviews whom</strong> lists each pair by pull requests
        and turns into a heatmap once 4 or more people review. <strong>Workload to watch</strong> (<Flag k="workloadRisk" />)
        shows after-hours and weekend share and open pull requests against fixed limits (30%, 25%, 4). <strong>People</strong>
        puts each person&apos;s author, reviewer and habit figures in one table, sortable and exportable as CSV; columns for
        a feature you are not granted are left out of the table and the file.
      </ProseP>
      <ProseP>
        Bots never count toward the team numbers. <strong>Include bots</strong> shows their rows and review pairs dimmed;
        otherwise a line says how many are hidden. When some data could not be loaded (GitHub rate limit, a very busy
        repository, working habits still backfilling), a coverage line says so and findings that depend on it are left out.
      </ProseP>
      <ScreenshotSlot file="team.jpg" alt="Team insights" />
      <SubHeading>Workday</SubHeading>
      <ProseP>
        After hours means outside the organization&apos;s workday, and weekend means Saturday or Sunday, both in one time zone
        set by an admin in Settings → Team insights (default Asia/Saigon, 08:00–19:00). It applies to Team insights and each
        repository&apos;s Team tab. The contributor profile&apos;s commit-hour chart and the <Code>afterhours_commit_pct</Code> alert
        still use UTC 09:00–18:00.
      </ProseP>
      <SubHeading>Account links</SubHeading>
      <ProseP>
        Some people use two GitHub accounts. When two logins share a name stem (for example <Code>dinhdobathi1992</Code> and
        <Code>dinhdobathi3</Code>) and one reviewed the other in the window, admins see &quot;Are they the same person?&quot; in
        What stands out. <strong>Link accounts</strong> makes every Team page count them as one person — pull requests,
        reviews, commits and working habits are added together, and reviews between them become self-reviews, which never
        count as a human review or toward the bus factor. <strong>Different people</strong> stops the suggestion. Links change
        numbers only, never access: an engineer&apos;s own working-habits view stays their own login. Organization mode only;
        admins review, unlink and undo in Settings → Account links, and every change is in the audit log. On a repository&apos;s
        Team tab linked people are merged too; their averages there are weighted approximations.
      </ProseP>
      <SubHeading>Working habits</SubHeading>
      <ProseP>
        With <Flag k="workingHabits" /> and a database, Team insights shows whether commits and pull requests are kept small,
        for this repository or all of its owner, over the page&apos;s window: commits over the limit (split by files, lines or
        both), pull requests over the commit limit, the largest commit, and the oversized commits grouped by pull request.
        Each person&apos;s share is in the People table. A commit is over the limit when it changes more
        than 10 files or more than 200 lines (additions plus deletions); a pull request is over the limit with more
        than 20 commits. Admins change the limits in Settings → Working habits. Engineers always see their own figures
        on their contributor profile, even without the feature; the Monday leadership digest carries totals only, no names.
      </ProseP>
      <ProseP>
        How it counts: only merged pull requests, by merge date. Commits are measured inside the pull request that carried
        them, so a squash merge is judged by its original commits, never by the one large commit it leaves on the default
        branch. A commit shared by stacked pull requests counts once, for the pull request merged first. Merge commits and
        bots are left out; when GitHub cannot count a very large commit&apos;s files, its lines alone decide. A commit whose
        email is not linked to a GitHub account is credited to the pull-request author and marked &quot;via PR author&quot;.
      </ProseP>
      <ProseP>
        Limits: commits pushed straight to the default branch are not counted, and repositories without GitHub Actions
        history are not synced (the section says &quot;Not tracked&quot;). The first nightly runs backfill 90 days; until
        that finishes the coverage line reads &quot;backfill in progress&quot;. The <Code>oversized_commit_pct</Code> alert
        needs at least 5 commits and a fully analysed window, and an organization-wide rule reports the first repository
        that breaches in a window.
      </ProseP>
    </section>
  );
}

export function FeatureContributor() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={User} name="Contributor profile & 1:1 prep" path="/contributor/[login]" chips={["52-week activity", "PR funnel", "Commit hours", "1:1 brief"]} />
      <ProseP>
        One person&apos;s contribution within an organization (or your own account) — open it from Team insights or a
        repository&apos;s Team tab: pull requests merged, lead time, reviews given and merge rate, a 52-week activity map,
        weekly commits, the pull-request funnel from opened to merged, commit hours (to spot after-hours patterns),
        languages touched and recent pull requests.
      </ProseP>
      <ScreenshotSlot file="contributor.jpg" alt="Contributor profile" />
      <DocCard>
        <SubHeading>1:1 prep sheet</SubHeading>
        <ProseP>
          <Code>/contributor/[login]/brief</Code> compares this period with the last — pull requests merged, reviews
          given, hours to merge — and lists talking points and recent pull requests. It is print-friendly and makes no
          extra GitHub calls.
        </ProseP>
      </DocCard>
    </section>
  );
}

// ── Cost and reports ──────────────────────────────────────────────────────────

export function FeatureCost() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={DollarSign} name="Cost" path="/cost-analytics" chips={["Monthly spend", "Daily spend by runner", "Top repositories", "Savings ideas"]} />
      <ProseP>
        GitHub Actions spend for the selected organization and month: daily spend by runner, where the money goes (top
        repositories), ways to spend less (estimated from this month&apos;s usage) and spend by runner type. Needs the{" "}
        <Flag k="costAnalytics" /> feature.
      </ProseP>
      <ScreenshotSlot file="cost.jpg" alt="Cost" />
      <Callout type="info">
        Billing comes from GitHub&apos;s billing APIs, which need a fine-grained token with the organization&apos;s
        Administration: read permission. Per-repository spend is only available where GitHub reports it for the
        account.
      </Callout>
    </section>
  );
}

export function FeatureReports() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={TrendingUp} name="Reports" path="/reports" chips={["Daily trends", "Quarterly comparison", "Sync now"]} />
      <ProseP>
        Long-term trends and quarter-over-quarter comparisons for a repository, from GitDash&apos;s own database — so
        they reach further back than GitHub&apos;s run retention. Needs organization mode with a database. Admins can
        pull the latest runs with Sync now; otherwise the nightly sync and webhooks keep it current.
      </ProseP>
      <ScreenshotSlot file="reports.jpg" alt="Reports" />
    </section>
  );
}

// ── Organization ──────────────────────────────────────────────────────────────

export function FeatureOrg() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={Building2} name="Org overview & health scorecard" path="/org/[org] · /org/[org]/health" chips={["Repository table", "Healthy / Watch / At risk", "Worst first"]} />
      <ProseP>
        <Code>/org/[org]</Code> summarizes an organization — total and active repositories, recent runs and average
        success rate — with a sortable repository table.
      </ProseP>
      <DocCard>
        <SubHeading>Health scorecard</SubHeading>
        <ProseP>
          <Code>/org/[org]/health</Code> (the Health scorecard button on Repositories) ranks every repository worst
          first as Healthy, Watch or At risk, combining its DORA level with bus-factor risk, and shows the estate
          distribution and median score. Repositories without enough activity are left out, and scores computed from
          partial data say so. Needs <Flag k="healthScorecard" />.
        </ProseP>
        <ScreenshotSlot file="org-health.jpg" alt="Health scorecard" />
      </DocCard>
    </section>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function FeatureSettings() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader icon={Sliders} name="Settings" path="/settings" chips={["My features", "Notifications", "Access by group", "AI provider", "Email and digests"]} />
      <ScreenshotSlot file="settings.jpg" alt="Settings" />
      <DocTable
        headers={["Section", "Who sees it", "What it is for"]}
        rows={[
          ["General", "Everyone", "The mode and your groups."],
          ["My features", "Everyone", "Switch features on or off for yourself. In organization mode only features your groups were granted are listed, and you can only switch them off."],
          ["Notifications", "Everyone", "Browser notifications for firing alerts."],
          ["Access by group", "Organization admins", "Grant features to groups (the same matrix as Admin → Permissions)."],
          ["Members", "Organization admins", "Put people in groups; people waiting for access are counted."],
          ["AI provider", "Admins, or you in standalone mode", "Bring your own provider, model and key for AI insights."],
          ["Email and digests", "Admins, or you in standalone mode", "Email delivery for alerts and digests."],
          ["Audit log", "Organization admins", "Every access change: who, when, before and after."],
        ]}
      />
      <Callout type="info">
        <ListChecks className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
        Admins also have <strong>Admin</strong> in the sidebar with the same users, permissions and audit views. See
        Access control.
      </Callout>
    </section>
  );
}

// ── AI insights ───────────────────────────────────────────────────────────────
export function FeatureAiInsights() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={Sparkles} name="AI Insights" path="/repos/[owner]/[repo] · /org/[orgName]/health"
        chips={["Bailian, Gemini and Qwen", "Server-side keys only", "Metrics-only prompts", "Hidden when unconfigured"]}
        since="4.1.0"
      />
      <ProseP>
        An optional layer that turns the metrics already on screen into plain-English analysis —
        what changed, why it matters, and what to do next. It appears as a collapsible card on the
        Repository Overview and Team Health Scorecard pages.
      </ProseP>

      <DocCard>
        <div className="flex items-center gap-2 mb-2">
          <SubHeading>Anomaly explanations</SubHeading>
          <VersionBadge v="4.1.1" />
        </div>
        <ProseP>
          On the Workflow Detail <strong>Reliability</strong> tab, each flagged metric gains a{" "}
          <strong>&ldquo;Why did duration spike?&rdquo;</strong> button. It explains the outliers
          from surrounding metadata — baseline statistics, when the workflow file last changed, and
          the mix of triggers — then suggests one concrete check you can run yourself.
        </ProseP>
        <Callout type="warning">
          <strong>These explanations never read run logs.</strong> GitDash does not fetch log
          content for any feature, and the model is told explicitly that it does not have logs and
          must not write as though it does. A hypothesis is inferred from timing and metadata only,
          so treat it as a lead to check rather than a diagnosis.
        </Callout>
        <ProseP>
          The request is lazy — opening the Reliability tab costs nothing until you click. Results
          are cached for 30 minutes.
        </ProseP>
      </DocCard>

      <DocCard>
        <div className="flex items-center gap-2 mb-2">
          <SubHeading>Failure hypotheses</SubHeading>
          <VersionBadge v="4.1.2" />
        </div>
        <ProseP>
          When a workflow has <strong>3 or more recent failures</strong>, the Reliability tab offers{" "}
          <strong>&ldquo;Suggest why this is failing&rdquo;</strong> — up to three ranked likely
          causes, each with the evidence behind it and a confidence level. Below that threshold the
          feature stays quiet: speculating about one flaky run is noise, and the floor is enforced
          server-side, not just hidden in the UI.
        </ProseP>
        <DocTable
          headers={["Signal used", "What it suggests"]}
          rows={[
            ["A workflow-file change dated just before the first failure", "Someone changed the pipeline — usually the answer"],
            ["One step failing far more than the rest", "A flaky or newly-broken step, rather than the environment"],
            ["Failures clustered on one trigger or branch type", "A context-specific problem (PR-only, main-only)"],
            ["A shift in run duration", "Timeouts, early exits, or infrastructure pressure"],
            ["A long success streak ending abruptly", "Something changed at a knowable point in time"],
          ]}
        />
        <Callout type="warning">
          <strong>Confidence is meant literally.</strong> &ldquo;Low&rdquo; means the model is mostly
          guessing, and it is told that one honest low-confidence hypothesis beats three invented
          ones. Treat every hypothesis as a lead to check — the evidence line tells you exactly which
          numbers it came from, so you can verify it in seconds.
        </Callout>
        <ProseP>
          Cost is kept proportional to the problem: job detail is fetched only for runs that actually
          failed, capped at 10, and the GitHub fan-out is cached separately from the generation.
          This surface is rate-limited to 10 requests/minute — half the others.
        </ProseP>
      </DocCard>

      <Callout type="info">
        <strong>Entirely opt-in.</strong> With no AI provider key configured on the server, every AI
        surface is hidden and GitDash behaves exactly as it did before v4.1.0. There is no
        placeholder and no prompt to enable anything.
      </Callout>

      <ScreenshotSlot file="ai-insights.jpg" alt="AI Insights card" />

      <DocCard>
        <SubHeading>What data leaves your instance</SubHeading>
        <ProseP>
          This is the part worth reading carefully. Prompts are assembled server-side from a typed
          snapshot that allowlists its fields — anything not in the list cannot be sent, and the
          test suite fails the build if a forbidden field appears.
        </ProseP>
        <DocTable
          headers={["Sent", "Never sent"]}
          rows={[
            ["Aggregate metrics (DORA figures, success rates, run counts, bus factor)", "Your PAT or OAuth token"],
            ["Repository, workflow, job and step names", "Workflow run logs"],
            ["GitHub logins of contributors and commit authors", "Source code or file contents"],
            ["Dates and timestamps", "Workflow YAML contents"],
            ["Risk bands and composite scores", "PR or commit message bodies"],
            ["Whether the data was partial", "Email addresses"],
          ]}
        />
        <Callout type="warning">
          <strong>Logins are sent.</strong> Contributor and author logins are included so the model
          can attribute observations to people. If that is not acceptable for your organisation,
          leave the AI keys unset — there is no partial mode.
        </Callout>
      </DocCard>

      <DocCard>
        <div className="flex items-center gap-2 mb-2">
          <SubHeading>Bring your own provider</SubHeading>
          <VersionBadge v="4.1.5" />
        </div>
        <ProseP>
          In <strong>organization mode</strong>, <strong>Settings → AI Provider</strong> lets a team
          point GitDash at its own account: provider, model, API key, and an optional base URL for a
          gateway or regional endpoint. Useful when the deployment&apos;s default key belongs to
          someone else, or when you want a larger model than the operator chose.
        </ProseP>
        <ProseP>
          In <strong>standalone mode</strong> the section does not appear at all. A self-hosted
          personal instance is meant to work from the environment defaults with no setup, so there is
          nothing to configure.
        </ProseP>
        <Callout type="warning">
          <strong>Your key is used exclusively.</strong> When an organization configures its own
          provider, the server&apos;s keys are never tried as a fallback behind it. If your key fails,
          the request fails — it does not quietly succeed on someone else&apos;s account and bill
          them. The status pill in Settings shows which source is actually in effect.
        </Callout>
        <ProseP>
          The key is write-only: encrypted at rest with the same AES-256-GCM helper used for email
          credentials, never returned to the browser, shown only as a masked hint. Leaving the field
          blank keeps the stored key. Base URLs must be <Code>https</Code>, because that URL carries
          the key. Changes take effect within 30 seconds.
        </ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Providers and keys</SubHeading>
        <ProseP>
          Three providers are supported and tried in order; any without a key is skipped, so
          configuring one is enough. No vendor SDK is installed — the layer talks to each endpoint
          with plain <Code>fetch</Code>. Keys are read server-side only and never reach the browser:{" "}
          <Code>/api/ai/status</Code> reports which providers are configured, never the key material.
        </ProseP>
        <DocTable
          headers={["Order", "Provider", "Wire format", "Notes"]}
          rows={[
            ["1", "Bailian (Alibaba Cloud)", "Anthropic Messages API", "Qwen models. Extended thinking is disabled automatically — see below"],
            ["2", "Google Gemini", "OpenAI-compatible", "Flash class is sufficient for this workload"],
            ["3", "Qwen via DashScope", "OpenAI-compatible", "Distinct endpoint from Bailian"],
          ]}
        />
        <DocTable
          headers={["Variable", "Default", "Purpose"]}
          rows={[
            ["BAILIAN_API_KEY", "—", "Primary provider. Unset = skipped"],
            ["BAILIAN_MODEL", "qwen3.6-flash", "Also: qwen3.6-plus, qwen3.7-plus, qwen3.7-max, qwen3.8-max"],
            ["BAILIAN_BASE_URL", "token-plan…/apps/anthropic/v1", "Anthropic-protocol endpoint"],
            ["GEMINI_API_KEY", "—", "Second in order"],
            ["GEMINI_MODEL", "gemini-2.5-flash", ""],
            ["QWEN_API_KEY", "—", "Third in order"],
            ["QWEN_MODEL", "qwen-plus", ""],
            ["AI_DISABLED", "—", "Set to true to hard-kill the layer regardless of keys"],
            ["AI_TIMEOUT_MS", "15000", "Per provider attempt"],
            ["AI_TOTAL_BUDGET_MS", "45000", "Wall-clock ceiling across all attempts in one request"],
            ["AI_DAILY_TOKEN_BUDGET", "2000000", "Per instance per UTC day. 0 = unlimited"],
          ]}
        />
        <Callout type="info">
          <strong>Extended thinking is disabled on Bailian.</strong> Qwen models there enable it by
          default, which cost roughly <strong>10× the output tokens</strong> for no benefit on
          structured extraction — measured at 799 vs 85 output tokens on an identical request. The
          layer sends <Code>thinking: {"{ type: \"disabled\" }"}</Code>, and still reads the response&apos;s
          text block explicitly in case a model ignores that.
        </Callout>
      </DocCard>

      <DocCard>
        <SubHeading>Cost and rate limiting</SubHeading>
        <ProseP>
          Calls are cached for 15 minutes and fingerprinted on the snapshot, so unchanged metrics
          reuse the previous generation. Requests are rate-limited to 20/minute per token, and a
          daily token budget stops runaway usage.
        </ProseP>
        <Callout type="warning">
          Both the cache and the limiters are <strong>in-process</strong>. On a multi-instance
          deployment each instance keeps its own counters, so these bound cost per instance rather
          than globally — a damage-limiter, not a hard spend cap.
        </Callout>
      </DocCard>

      <DocCard>
        <SubHeading>How it fails</SubHeading>
        <DocTable
          headers={["Situation", "What you see"]}
          rows={[
            ["No provider keys configured", "The card is not rendered at all"],
            ["Feature switched off in Settings", "The card is not rendered at all"],
            ["Provider is down or returns an error", "A muted \"unavailable\" line — the page's own metrics are unaffected"],
            ["Rate limit or daily budget reached", "A muted \"try again in a minute\" line"],
            ["Some metrics could not be fetched", "A \"partial data\" badge, and the model is told to hedge"],
          ]}
        />
      </DocCard>

      <Callout type="warning">
        Generated text can be wrong. Every figure it cites comes from the snapshot, but the
        reasoning around those figures is a model&apos;s. Treat it as a starting point for a
        conversation, not a source of truth — the underlying numbers on the page are.
      </Callout>
    </section>
  );
}
