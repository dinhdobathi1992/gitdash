# Prompt — GitDash 4.5 introduction video

Copy everything below the line into the video model. It is self-contained: product facts, feature
inventory, visual system, storyboard, narration and delivery specs.

---

## Your task

Make a **90-second product introduction video for GitDash 4.5**, an open-source, self-hosted dashboard
for GitHub Actions and engineering delivery. The video must show **every feature area listed in the
inventory below** at least once — some in a hero scene, the rest in a fast montage — so a viewer who
has never heard of GitDash understands everything it does.

**Tagline (use it verbatim, on screen at the start and the end):** *Everything metrics, measured.*

**One-line pitch:** DORA, reliability, cost and team health from your GitHub Actions runs and pull
requests — on infrastructure you run yourself.

**Audience:** engineering managers, platform / DevOps leads and CTOs at teams that run CI on GitHub
Actions. They are technical, short on time and allergic to hype.

**Tone:** calm, precise, confident. Show real UI, not metaphors. No stock footage, no people, no
glowing "AI brain" imagery, no exaggerated claims.

## Product facts (do not contradict these)

- Name: **GitDash**. Version: **4.5**. License: MIT, open source. Self-hosted (Docker, Helm/Kubernetes, Vercel).
- Reads from the **GitHub API** with the signed-in user's own token; the token is kept server-side in an
  encrypted, HTTP-only session cookie and never reaches the browser.
- Two modes:
  - **Standalone** — one person signs in with a personal access token.
  - **Organization** — sign in with GitHub OAuth or a token; admins decide which **group** (Admin,
    DevOps, Security, Developer, PM) sees which feature; new users wait on a pending page until approved.
- Optional Postgres database powers alerts, history, shared caching and permissions.
- Optional AI provider key powers summaries and failure hypotheses; without a key those surfaces simply
  don't appear.

## Complete feature inventory

Cover all of these. Group names are suggested scene groupings.

### 1. Monitor
- **Repositories home** — fleet KPI strip (workflow runs, success rate, p95 run duration, p95 queue
  wait, each with a trend sparkline and a worded delta such as "↓ 12s faster"); time range 24h / 7d /
  30d / 90d.
- **Needs attention list** — what is wrong right now, first: failing repositories ("deploy is failing
  on main · 3 failures in a row") and firing alerts, one row each, one click to investigate.
- **Repository table** — status pill (Passing, Failing, Running, Queued, No recent runs), 30-day
  success bar, last-10-runs strip, p95 duration, last run and branch; filter chips with counts,
  language filter, "Needs attention first" sorting, compact/comfortable density.
- **Pin repositories** (star) — pinned repos appear in the sidebar with a live status dot.
- **Keyboard first** — ⌘K command palette searches repositories and pages; on the list: `/` filter,
  ↑ ↓ move, ↵ open, `p` pin.
- **Org switcher** and **GitHub API budget meter** in the sidebar; one global Refresh that bypasses caches.

### 2. Repository
- **Overview** — AI summary of the last 30 days (optional), **DORA metrics** (deploy frequency, lead
  time for changes, change failure rate, time to restore) each rated Elite / High / Medium / Low with a
  sparkline, measured **GitHub Deployments** panel, DORA drill-down (cycle-time breakdown, PR size vs
  speed, throughput), **run duration chart** (daily p50 and p95 with the worst day called out),
  **outcomes** breakdown and **jobs that fail most**.
- Tabs: **Workflows · Pull requests · Team · Issues · Security · Audit trail**.
- **Pull requests** — open PR health, time to first review (p50/p90), approval-to-merge time, abandon
  rate, age distribution, work in progress per author.
- **Team (repo)** — contributor stats, bus factor and knowledge concentration, runner utilization,
  review bottlenecks, workload risk.
- **Issues** — backlog growth, opened vs closed, median and p90 days to close, stale issues.
- **Security** — GitHub's own Dependabot, code-scanning and secret-scanning alerts by severity, oldest
  unresolved alert, plus static analysis of workflow YAML for risky patterns.
- **Audit trail** — history of changes to workflow files and deployment tracking.

### 3. Workflow detail
- Status with failure streak ("Failing · 3 in a row"), trigger and file path, CSV export.
- 6-figure KPI strip: success rate, average duration, p95 queue wait, time to recover, re-run rate,
  developer time lost in failed runs.
- **Last 40 runs** bar chart — height is duration, colour is outcome, p95 reference line.
- **Why it's failing** — AI hypotheses ranked Likely / Possible / Unlikely with evidence and a next step.
- **Where the time goes** — per-job p50 bar and p95 tick; the slowest job highlighted.
- Recent runs table; tabs for **Runs, Performance** (job composition, slowest steps, queue heatmap),
  **Reliability** (MTTR, flaky branches, pass/fail timeline, **anomaly detection** with an optional
  "file as GitHub issue"), **Triggers** and CI-based **DORA**; optimization tips; browser notification
  when a new run fails.

### 4. Analyze
- **Team insights** — pull requests merged, median cycle time, reviews given, **review bus factor**
  ("2 people do 72% of reviews"), self-merged share; **who-reviews-whom heatmap**; **workload to watch**
  (after-hours and weekend commits, open-PR overload, activity cliffs); contributors table with export.
- **Contributor profile** and **1:1 prep sheet** for managers.
- **Cost** — real GitHub Actions billing from the Enhanced Billing API: billed so far, projected
  month-end vs last month, daily burn, minutes; **daily spend by runner OS** with a faded projection;
  **top repositories by spend**; **ways to spend less** with estimated monthly savings; CSV download.
- **Reports** — historical trends from synced run data.
- **Organization overview** and **Team health scorecard** — every repository ranked worst-first by
  DORA tier and bus-factor risk.

### 5. Alerts and communication
- **Alert rules** on failure rate, p95 duration, queue wait, failure streaks, anomalies and people
  metrics (review response, unreviewed PR age, abandon rate, after-hours commits).
- Plain-language rule builder with a live preview sentence ("You will be alerted in Slack when the
  failure rate on api goes above 20% within 24 hours").
- Delivery to **Slack, email, browser or a daily digest**; "Firing now" list with Mute 1h and
  Investigate; send a test; delivery history.
- **Weekly leadership digest** email — org-wide narrative every Monday.

### 6. Access, settings and trust
- **Access by group** matrix (feature × group checkboxes, Admin always on), **waiting for access**
  queue with Approve, **members** and an **audit log** of every permission change.
- **My features** — each person can hide features they don't use.
- Settings for the AI provider and email delivery; standalone token management.
- Security model: tokens server-side only, per-user caching, deny-by-default route permissions,
  allowed-organization sign-in restriction.
- Works on phones: compact layout with a bottom tab bar (Repos · Alerts · Team · More).

## Visual system (match the product exactly)

- Theme: dark "Graphite console". Page `#0B0D11`, panels `#0F1217`, cards `#13171D` with a subtle
  top-lit gradient `#161B23 → #12161C`, borders `#1E242D`.
- Text: primary `#EDEAE3`, secondary `#A3A9B4`, captions `#7A818D`.
- Brand violet `#6D4AFF` (buttons, gradient `#8163FF → #6440F5`), active marks `#A48BFF`, links
  `#B9A6FF`; data cyan `#4FD1E8`.
- Status: success `#3DD68C`, failure `#FF6B6B`, warning `#F5B544`, running `#4FD1E8`, cancelled `#626A77`.
- Type: **Geist** for prose, **Geist Mono** for every number, repository name, SHA and duration.
- Logo: four rising bars (cyan → blue → periwinkle → violet) on a dark rounded tile, soft violet glow.
- Atmosphere: two faint radial lights at the top of the frame (violet right, cyan left). Colour marks
  state and data only — never decoration.
- Motion: short, confident ease-out moves (250–400 ms), numbers counting up in mono, sparklines drawing
  left to right, run-strip squares filling oldest → newest. No bounce, no spin, no glitch effects.

Reference screens (use as layout ground truth): `design/screenshots/` — `Main.png` (Repositories),
`Repo.png`, `Workflow.png`, `Team.png`, `Cost.png`, `Alerts.png`, `Settings.png`, `Login.png`,
`Mobile.png`, `MobileRepo.png`, `Sidebar.png`.

## Storyboard (90 s, 16:9)

| # | Time | Scene | On screen | Narration (voice-over) |
|---|---|---|---|---|
| 1 | 0–6 s | Open | Logo assembles bar by bar; "GitDash 4.5"; tagline *Everything metrics, measured.* types in, "measured." in violet | "Your CI already knows how your team ships. GitDash makes it readable." |
| 2 | 6–16 s | Monitor | Repositories home: KPI strip counts up; Needs attention row slides in: "deploy is failing on main · 3 failures in a row" | "Open GitDash and the first thing you see is what's wrong right now — then everything else." |
| 3 | 16–24 s | Table + keyboard | Filter chip "Failing 2", run strips fill, ⌘K palette jumps to a repo, star pins it into the sidebar | "Every repository: status, success rate, last ten runs, p95 time. Filter, sort, pin — all from the keyboard." |
| 4 | 24–36 s | Repository | Repo overview: DORA cards with Elite/High/Medium chips, change-failure card turns warm; run-duration chart highlights the worst day; tabs flash Pull requests → Issues → Security → Audit trail | "Each repository gets DORA metrics, run duration, the jobs that fail most — and tabs for pull requests, issues, security and audit history." |
| 5 | 36–48 s | Workflow | 6-figure strip, last-40-runs bars with p95 line, "Why it's failing" hypotheses labelled Likely / Possible, "Where the time goes" highlights the slowest job | "Drill into a workflow to see why it fails and where the time goes." |
| 6 | 48–58 s | Team | Review bus factor "2 people do 72% of reviews", heatmap cells fill, Workload to watch chips (High, Watch) | "See review load, bus factor and who's working too late — before it becomes a resignation." |
| 7 | 58–66 s | Cost | Daily spend by runner stacks, faded projection bars, "Move jobs off macOS runners −$180/mo" | "Real Actions billing, a month-end projection, and concrete ways to spend less." |
| 8 | 66–74 s | Alerts | Rule builder preview sentence writes itself; Slack · Email · Browser · Digest; Firing now with Mute 1h | "Alerts in plain language, delivered to Slack, email, the browser or a daily digest." |
| 9 | 74–82 s | Montage | Quick cuts (≈1 s each): Settings access matrix ticking, members approve, phone layout, Reports, Org health scorecard, Contributor 1:1 sheet, Leadership digest email | "Group permissions, audit logs, a phone layout, org scorecards, one-to-one prep and a weekly leadership digest." |
| 10 | 82–90 s | Close | Login screen hero; chips "DORA per repo and org · Alerts that explain themselves · Self-hosted"; tagline + "Open source · Self-hosted · github.com/dinhdobathi1992/gitdash" | "GitDash. Everything metrics, measured. Open source, on your infrastructure." |

## Rules

- All data shown is **sample data**; use neutral names (`api-service`, `web-app`, `deploy-prod`,
  `infra-terraform`) and generic people (initials only). Never show real company, customer or
  employee names, tokens or URLs other than the public GitHub repository.
- Every number is in Geist Mono; every status carries a word as well as a colour.
- Keep on-screen text legible: nothing smaller than 24 px at 1080p; one idea per scene.
- Do not invent features that are not in the inventory, and do not claim GitDash is a hosted SaaS.
- Captions: burn in subtitles matching the narration.

## Deliverables

1. **Master:** 1920×1080, 30 fps, H.264 MP4, 88–92 s, stereo, narration at −16 LUFS with a quiet,
   minimal electronic bed (no vocals).
2. **Social cut:** 1080×1920 (9:16), 30–45 s — scenes 1, 2, 4, 5, 7, 8, 10.
3. **Silent loop:** 1920×1080, 20 s, no narration, for the README and the sign-in page.
4. A thumbnail frame: tagline over the Repositories screen.
