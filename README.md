<p align="center">
  <img src="public/logo.png" alt="GitDash Logo" width="120" />
</p>

<h1 align="center">GitDash</h1>

<p align="center">
  <strong>Self-Hosted GitHub Actions Metrics Dashboard</strong><br />
  DORA metrics, workflow analytics, team insights, cost tracking — all in one place.
</p>

<p align="center">
  <a href="#-intro-video">Video</a> &nbsp;&bull;&nbsp;
  <a href="#-live-demo">Demo</a> &nbsp;&bull;&nbsp;
  <a href="#-key-capabilities">Features</a> &nbsp;&bull;&nbsp;
  <a href="#-quick-start">Quick Start</a> &nbsp;&bull;&nbsp;
  <a href="#-deployment">Deployment</a> &nbsp;&bull;&nbsp;
  <a href="#-documentation">Docs</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-149eca?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss" alt="Tailwind" />
  <img src="https://img.shields.io/github/license/dinhdobathi1992/gitdash?color=green" alt="License" />
  <img src="https://img.shields.io/github/v/release/dinhdobathi1992/gitdash?color=orange" alt="Release" />
</p>

---

## 🎬 Intro Video

Get a quick overview of what GitDash can do:

https://github.com/user-attachments/assets/e9228cb1-3287-456c-b4f7-e2e351f98beb

---

## 🖥 Live Demo

Watch a full walkthrough of GitDash in action — navigating repos, exploring DORA metrics, workflow analytics, team insights, cost tracking, and more:

https://github.com/user-attachments/assets/8cf2625a-3a88-4494-a703-07cb5181c11a

---

## 🚀 Key Capabilities

| Capability | Description |
| --- | --- |
| **DORA Metrics** | Track Deployment Frequency, Lead Time for Changes, Change Failure Rate, and MTTR derived directly from real PR and release data. |
| **Precision Drill-Downs** | PR Cycle Time Breakdown, PR Size vs. Velocity scatter plots, Throughput Trends, and Workflow Stability charts. |
| **Workflow Intelligence** | Deep-dive into success rates, queue wait times, run duration trends, and cost estimation across all GitHub Actions. |
| **Team & Contributor Insights** | CI delivery metrics, reviewer load balances, 52-week activity heatmaps, and PR lifecycle funnels. |
| **Cost Analytics** | Track GitHub Actions spend month-over-month to identify expensive workflows and optimize CI budgets. |
| **Enterprise-Grade Security** | AES-256-GCM encrypted sessions, zero browser token exposure, and workflow configuration static analysis. |
| **DB-Backed Reporting** | Persist historical data beyond GitHub's 90-day retention and evaluate advanced alerting rules. |

---

## 📸 Screenshots

<details>
<summary><strong>Repository Dashboard</strong> — browse all repositories with health indicators</summary>
<br />
<p align="center">
  <img src="public/screenshots/00-repos.png" alt="Repositories" width="800" />
</p>
</details>

<details>
<summary><strong>Repository Overview & DORA Scorecard</strong> — health cards, PR cycle time, workflow trends</summary>
<br />
<p align="center">
  <img src="public/screenshots/08-repo-overview.png" alt="Repository Overview" width="800" />
</p>
</details>

<details>
<summary><strong>Workflow Analytics — Overview & Performance</strong> — run stats, job breakdowns, step timing</summary>
<br />
<p align="center">
  <img src="public/screenshots/01-overview.png" alt="Workflow Overview" width="800" />
</p>
<p align="center">
  <img src="public/screenshots/03-performance-jobs.png" alt="Performance — Jobs" width="800" />
</p>
</details>

<details>
<summary><strong>Workflow Analytics — Reliability & Triggers</strong> — failure trends, flaky detection, trigger distribution</summary>
<br />
<p align="center">
  <img src="public/screenshots/05-reliability.png" alt="Reliability" width="800" />
</p>
<p align="center">
  <img src="public/screenshots/06-triggers.png" alt="Triggers" width="800" />
</p>
</details>

<details>
<summary><strong>Audit Trail & Security Scan</strong> — workflow change log, YAML security analysis</summary>
<br />
<p align="center">
  <img src="public/screenshots/09-audit.png" alt="Audit Trail" width="800" />
</p>
<p align="center">
  <img src="public/screenshots/10-security.png" alt="Security Scan" width="800" />
</p>
</details>

<details>
<summary><strong>Team Insights & Contributor Profiles</strong> — delivery metrics, reviewer load, activity heatmaps</summary>
<br />
<p align="center">
  <img src="public/screenshots/12-team-insights.png" alt="Team Insights" width="800" />
</p>
<p align="center">
  <img src="public/screenshots/13-contributor.png" alt="Contributor Profile" width="800" />
</p>
</details>

<details>
<summary><strong>Cost Analytics</strong> — billing breakdown by workflow and runner type</summary>
<br />
<p align="center">
  <img src="public/screenshots/cost-analytics.png" alt="Cost Analytics" width="800" />
</p>
</details>

<details>
<summary><strong>Reports, Alerts & Settings</strong> — historical trends, alert rules, configuration</summary>
<br />
<p align="center">
  <img src="public/screenshots/14-reports.png" alt="Reports" width="800" />
</p>
<p align="center">
  <img src="public/screenshots/15-alerts.png" alt="Alerts" width="800" />
</p>
<p align="center">
  <img src="public/screenshots/16-settings.png" alt="Settings" width="800" />
</p>
</details>

<details>
<summary><strong>Organization Overview</strong> — aggregated org-level metrics</summary>
<br />
<p align="center">
  <img src="public/screenshots/17-org-overview.png" alt="Organization Overview" width="800" />
</p>
</details>

---

## ⚡ Quick Start

### Prerequisites

- Node.js 20+
- npm

### 1. Clone and install

```bash
git clone https://github.com/dinhdobathi1992/gitdash.git
cd gitdash
npm ci
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Set at minimum:

```env
SESSION_SECRET=replace_with_a_random_32+_char_secret
MODE=standalone
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Generate a secure secret:

```bash
openssl rand -hex 32
```

### 3. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). In `standalone` mode you'll be redirected to `/setup`; in `organization` mode to `/login`.

---

## 🔐 Authentication Modes

| Mode | Best for | Login flow |
| --- | --- | --- |
| **`standalone`** (default) | Individual / self-hosted use | User enters PAT at `/setup`, token stored in encrypted HttpOnly session cookie |
| **`organization`** | Shared team deployment | GitHub OAuth via `/login` and `/api/auth/callback`, token stored in encrypted session cookie |

Mode is controlled by the `MODE` environment variable.

### Organization Mode Setup (OAuth)

Set the following additional variables:

```env
GITHUB_CLIENT_ID=your_oauth_app_client_id
GITHUB_CLIENT_SECRET=your_oauth_app_client_secret
```

Create a GitHub OAuth App with:

- **Homepage URL:** `http://localhost:3000`
- **Callback URL:** `http://localhost:3000/api/auth/callback`

### Token Scope Guidance

**Standalone PAT (recommended minimum):** `repo`, `workflow`, `read:org`, `read:user`

For tighter access, prefer a fine-grained PAT scoped to only the repositories and read permissions you need.

> **Cost Analytics note:** `/api/github/billing/cost-analysis` uses GitHub Enhanced Billing APIs. Some org/account combinations require fine-grained PAT permissions (e.g. org Administration read).

---

## 🏗 Architecture

GitDash is a **Next.js App Router** application that proxies authenticated requests to GitHub APIs.

```
Browser  ──▶  /api/*  ──▶  Server reads token from encrypted session cookie (iron-session)
                           ──▶  GitHub REST APIs via Octokit / fetch
                           ──▶  Optional: DB routes persist & query historical workflow runs
```

**Key code entry points:**

| Path | Purpose |
| --- | --- |
| `src/proxy.ts` | Auth gating + production HTTPS redirect |
| `src/lib/session.ts` | Encrypted session cookie configuration |
| `src/lib/mode.ts` | Auth mode selection (`standalone` vs `organization`) |
| `src/app/api/github/*` | GitHub data endpoints |
| `src/app/api/db/*` + `src/lib/db.ts` | Optional historical DB layer |

---

## 🚢 Deployment

### Docker Compose

```bash
cp .env.local.example .env.local
# edit .env.local with your values
docker compose up --build -d
```

```bash
docker compose down   # to stop
```

**Docker image behavior:** multi-stage build (`deps` → `builder` → `runner`), non-root runtime user (`nextjs`, uid 1001), `DOCKER_BUILD=1` enables Next standalone output during build.

### Kubernetes (Helm)

```bash
helm upgrade --install gitdash ./helm/gitdash -n gitdash --create-namespace
```

Adjust `helm/gitdash/values.yaml` for mode, ingress, and secrets.

---

## 🗄 Optional: Historical DB + Webhooks

GitDash works without a database for live GitHub analytics. Add a **Postgres/Neon** database to unlock historical persistence and reporting:

- `DATABASE_URL` enables `/api/db/*` and alert rule storage
- `/reports` relies on DB data (available in organization mode)
- `/api/webhooks/github` upserts workflow runs from GitHub webhooks

Optional webhook hardening: set `GITHUB_WEBHOOK_SECRET` and configure the `workflow_run` event in GitHub.

---

## ⚙️ Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `SESSION_SECRET` | Yes | Session encryption key (>= 32 chars in production) |
| `MODE` | No | `standalone` (default) or `organization` (aliases: `org`, `team`) |
| `NEXT_PUBLIC_APP_URL` | Recommended | Public app URL for OAuth/callback flows |
| `GITHUB_CLIENT_ID` | Org mode | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Org mode | GitHub OAuth App client secret |
| `DATABASE_URL` | Optional | Enables historical DB sync, trends, and alerts |
| `GITHUB_WEBHOOK_SECRET` | Optional | Signature verification for `/api/webhooks/github` |
| `GITHUB_TOKEN` | Optional | Fallback when no session token is available |

---

## 🗺 Main Routes

### UI Pages

| Route | Description |
| --- | --- |
| `/` | Repository dashboard |
| `/repos/[owner]/[repo]` | Repository overview + links to audit, security, team |
| `/repos/[owner]/[repo]/workflows/[id]` | Workflow analytics tabs |
| `/team` | Team insights |
| `/cost-analytics` | Cost analytics |
| `/reports` | Historical reports |
| `/alerts` | Alert rules & events |
| `/settings` | Application settings |
| `/docs` | Built-in documentation |

### API Groups

| Prefix | Purpose |
| --- | --- |
| `/api/auth/*` | Session setup, login, logout, whoami |
| `/api/github/*` | GitHub data + analytics endpoints |
| `/api/db/*` | Optional historical sync and trend endpoints |
| `/api/alerts` | Alert-rule CRUD + events |
| `/api/webhooks/github` | Workflow webhook ingest |

---

## 🛠 Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router) |
| UI | React 19, TypeScript (strict), Tailwind CSS v4 |
| Data fetching | SWR |
| Visualizations | Recharts |
| GitHub integration | Octokit + GitHub REST API |
| Session management | iron-session (encrypted cookies) |
| Database (optional) | Neon Postgres (`@neondatabase/serverless`) |

---

## 📁 Project Layout

```
gitdash/
├── src/
│   ├── app/                  # Pages + route handlers
│   ├── components/           # UI and shared client components
│   ├── lib/                  # Core logic (GitHub, DB, sessions, validation)
│   └── proxy.ts              # Auth/redirect proxy layer
├── walkthrough-output/       # Intro video + demo walkthrough
├── public/screenshots/       # Application screenshots
├── docs/                     # Plans & design docs
├── helm/gitdash/             # Helm chart
├── .github/workflows/        # CI/CD workflows
├── Dockerfile
└── docker-compose.yml
```

---

## 🔒 Security

- Session cookie: `HttpOnly`, `SameSite=lax`, `Secure` in production
- `SESSION_SECRET` enforced >= 32 chars in production
- Auth entry points rate-limited (`/api/auth/setup`, `/api/auth/login`)
- OAuth `state` verified and expires
- Input validation centralized in `src/lib/validation.ts`
- Security headers (CSP, HSTS, X-Frame-Options) configured in `next.config.ts`

For full details see [`README-SECURITY-ENHANCEMENTS.md`](README-SECURITY-ENHANCEMENTS.md).

---

## 🔄 CI/CD Workflows

| Workflow | Purpose |
| --- | --- |
| `ci.yml` | Lint, type-check, build, npm audit, Snyk, CodeQL |
| `docker.yml` | Multi-arch Docker build and push |
| `release.yml` | Semver release/tag flow |
| `vercel.yml` | Production deploy with Vercel CLI |

---

## 🧑‍💻 Developer Commands

```bash
npm run dev       # local development server
npm run build     # production build
npm run start     # run production build
npm run lint      # eslint
npm run test      # run tests
npx tsc --noEmit  # type-check without emitting
```

---

## 📚 Documentation

GitDash ships with comprehensive **built-in documentation** accessible at the [`/docs`](https://gitdash.vercel.app/docs) route in the running application.

The docs cover:

- **Getting Started** — installation, deployment, configuration
- **Core Concepts** — authentication modes, security model, data sources
- **Feature Guides** — detailed walkthroughs for every dashboard section
- **Metrics Reference** — DORA 4 Keys, PR Cycle Time, Workflow metrics, Team & People metrics, CI & Alert metrics
- **API Reference** — all available REST endpoints
- **FAQ & Troubleshooting** — common issues and solutions

> **Tip:** The docs page includes full-text search, tabbed examples, and interactive code blocks.

For the DORA Metrics integration plan and roadmap, see [`docs/DORA-REPO-METRICS-PLAN.md`](docs/DORA-REPO-METRICS-PLAN.md).

---

## 📋 Changelog

See [`CHANGELOG.md`](CHANGELOG.md).

---

## 📄 License

MIT

---

<p align="center">
  <sub>Made by <a href="https://github.com/dinhdobathi1992">Dinh Do Ba Thi</a></sub>
</p>
