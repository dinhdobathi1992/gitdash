# GitDash

A self-hosted GitHub Actions metrics dashboard. Browse your personal and organization repositories, and explore deep workflow metrics — success rates, durations, reliability trends, trigger patterns, and job-level breakdowns.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Table of Contents

- [How It Works](#how-it-works)
- [Authentication Modes](#authentication-modes)
  - [Standalone Mode](#standalone-mode-default)
  - [Organization Mode](#organization-mode)
  - [Choosing a Mode](#choosing-a-mode)
- [Features](#features)
- [Deploy Locally](#deploy-locally)
- [Deploy with Docker](#deploy-with-docker)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Security Checklist](#security-checklist)

---

## How It Works

GitDash is a Next.js application that acts as a thin proxy between your browser and the GitHub REST API. It never stores tokens in the browser — all credentials live in an encrypted, HTTP-only session cookie (using [iron-session](https://github.com/vvo/iron-session)).

When you navigate to a page:

1. The middleware (`src/proxy.ts`) checks the session cookie.
2. If the session is valid it forwards your request to the Next.js app.
3. The app's API routes (`/api/github/*`) call the GitHub REST API on your behalf using the token stored in your server-side session.
4. Data is returned to the browser as JSON — the raw GitHub token is never sent to the client.

```
Browser ──── request ────► Next.js middleware (session check)
                                    │
                                    ▼
                         /api/github/* routes
                                    │
                                    ▼
                          GitHub REST API
                         (token from session)
```

---

## Authentication Modes

GitDash supports two modes, controlled by the `MODE` environment variable.

### Standalone Mode (default)

**Best for:** personal use, local dashboards, or situations where you don't want to create a GitHub OAuth App.

- No OAuth App required.
- Each user enters their own **GitHub Personal Access Token (PAT)** on the `/setup` page.
- The PAT is validated against `GET /user` on GitHub, then stored in an encrypted session cookie.
- The `/setup` page is the only public route; all other routes require a valid session.

**Flow:**

```
User visits / ──► middleware redirects to /setup
User enters PAT ──► POST /api/auth/setup validates against GitHub
                         │
                         ▼
                  PAT stored in encrypted session cookie
                         │
                         ▼
              User redirected to / (dashboard)
```

**Required token scopes:**

| Scope | Purpose |
|---|---|
| `repo` | Repository list + workflow data (private repos) |
| `workflow` | Workflow runs and job details |
| `read:org` | Organization membership + org repo list |
| `read:user` | User identity |

> **Scope note:** `repo` grants full read/write access to all repositories — this is an architectural limitation of the GitHub API. If you only need access to public repos, you can omit `repo`. For reduced-scope private repo access, consider a **fine-grained PAT** with `Actions: read` and `Contents: read` permissions instead.

**To enable:** set `MODE=standalone` (or leave `MODE` unset — this is the default).

---

### Organization Mode

**Best for:** teams sharing a single GitDash deployment, where each person signs in with their own GitHub account.

- Requires a **GitHub OAuth App**.
- Users click "Sign in with GitHub" on the `/login` page.
- GitHub redirects back to `/api/auth/callback` with an authorization code.
- The server exchanges the code for an access token and stores it in an encrypted session cookie.
- Each user gets an isolated session — no shared credentials.

**Flow:**

```
User visits / ──► middleware redirects to /login
User clicks "Sign in with GitHub"
        │
        ▼
GitHub OAuth authorize page
        │ (authorization code)
        ▼
GET /api/auth/callback
        │ exchanges code for access_token
        ▼
Access token stored in encrypted session cookie
        │
        ▼
User redirected to / (dashboard)
```

**OAuth scopes requested:**

| Scope | Purpose |
|---|---|
| `read:user` | User identity (avatar, name, login) |
| `user:email` | Email address |
| `repo` | Repository list + workflow data (private repos) |
| `workflow` | Workflow runs and job details |
| `read:org` | Organization membership + org repo list |

**To enable:** set `MODE=organization` and provide `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`.

---

### Choosing a Mode

| Situation | Recommended mode |
|---|---|
| Personal use on your laptop | `standalone` |
| You don't want to create an OAuth App | `standalone` |
| Multiple team members sharing one deployment | `organization` |
| You want each person to use their own GitHub account | `organization` |
| You want to restrict access to a specific GitHub org | `organization` |

---

## Features

- **Two authentication modes** — standalone PAT or GitHub OAuth
- **Personal + org repo view** — switch between your personal repos and any org you belong to via the sidebar dropdown
- **5-tab workflow dashboard:**
  - **Overview** — rolling success rate, duration trend, outcome pie, run frequency
  - **Performance** — job avg/p95 bar chart, stacked job waterfall per run, slowest steps table
  - **Reliability** — MTTR, failure streaks, flaky branch detection, re-run rate, pass/fail timeline
  - **Triggers** — event breakdown, top branches, hour-of-day heatmap, day-of-week chart, actor leaderboard
  - **Runs** — sortable table with commit message, PR link, run attempt, CSV export
- **Job & step drill-down** — expand any run row to see per-job and per-step timings
- **Per-chart PNG download** — export any chart as an image
- **GitHub Actions billing widget** in Settings
- **Auto-refresh** — polls every 30 seconds while any run is in progress
- **Browser notifications** for new workflow failures (opt-in)
- **Fuzzy search** with keyboard navigation on the repo list

---

## Deploy Locally

### Prerequisites

- Node.js 20+
- npm

### 1. Clone the repository

```bash
git clone https://github.com/dinhdobathi1992/gitdash.git
cd gitdash
```

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` for your chosen mode:

**Standalone mode:**
```env
MODE=standalone
SESSION_SECRET=replace_with_at_least_32_random_characters
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Organization mode:**
```env
MODE=organization
GITHUB_CLIENT_ID=your_oauth_app_client_id
GITHUB_CLIENT_SECRET=your_oauth_app_client_secret
SESSION_SECRET=replace_with_at_least_32_random_characters
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Generate a strong `SESSION_SECRET`:
```bash
openssl rand -hex 32
```

#### Create a GitHub OAuth App (organization mode only)

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Fill in:

   | Field | Value |
   |---|---|
   | Application name | GitDash |
   | Homepage URL | `http://localhost:3000` |
   | Authorization callback URL | `http://localhost:3000/api/auth/callback` |

3. Click **Register application**, then copy the **Client ID**
4. Click **Generate a new client secret** and copy it immediately

### 3. Install dependencies and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- **Standalone mode:** you will be redirected to `/setup` to enter your PAT.
- **Organization mode:** you will be redirected to `/login` to sign in with GitHub.

---

## Deploy with Docker

The Docker image uses a multi-stage build (deps → builder → runner) and runs as a **non-root user** (`nextjs`, uid 1001).

### Standalone mode

```bash
# 1. Configure environment
cp .env.local.example .env.local
# Edit .env.local: set MODE=standalone and SESSION_SECRET

# 2. Build and start
docker compose up --build -d

# 3. Open the app
open http://localhost:3000
```

### Organization mode

```bash
# 1. Configure environment
cp .env.local.example .env.local
# Edit .env.local:
#   MODE=organization
#   GITHUB_CLIENT_ID=...
#   GITHUB_CLIENT_SECRET=...
#   SESSION_SECRET=...
#   NEXT_PUBLIC_APP_URL=http://localhost:3000

# 2. Build and start
docker compose up --build -d
```

### docker-compose.yml reference

```yaml
services:
  gitdash:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env.local
    restart: unless-stopped
```

The compose file reads all variables from `.env.local` automatically via `env_file`.

### Stop / remove

```bash
docker compose down
```

### Deploying to a custom domain

If you are running behind a reverse proxy (nginx, Caddy, Traefik) or deploying to a cloud host:

1. Set `NEXT_PUBLIC_APP_URL` to your public URL (e.g. `https://gitdash.example.com`)
2. Update the **Authorization callback URL** in your GitHub OAuth App to `https://gitdash.example.com/api/auth/callback`
3. The app automatically redirects HTTP → HTTPS in production when the `x-forwarded-proto` header is set by your proxy

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `MODE` | No | `standalone` (default) or `organization` |
| `SESSION_SECRET` | **Yes** | Random string ≥ 32 characters. Encrypts session cookies. |
| `GITHUB_CLIENT_ID` | Organization mode only | OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Organization mode only | OAuth App client secret |
| `NEXT_PUBLIC_APP_URL` | No | Public URL of the app. Defaults to `http://localhost:3000` |

> `SESSION_SECRET` must be at least 32 characters. The app throws at startup in production if it is missing or too short.

---

## Project Structure

```
gitdash/
├── Dockerfile
├── docker-compose.yml
├── .env.local.example
├── next.config.ts              # Security headers (CSP, HSTS, etc.)
└── src/
    ├── proxy.ts                # Middleware: session check + HTTPS redirect
    ├── lib/
    │   ├── mode.ts             # getAppMode() — reads MODE env var
    │   ├── session.ts          # iron-session config + SessionData type
    │   ├── github.ts           # Octokit wrappers: listRepos, listWorkflows, etc.
    │   ├── ratelimit.ts        # In-memory sliding-window rate limiter
    │   ├── validation.ts       # Input validators + safeError()
    │   ├── swr.tsx             # SWR fetcher, FetchError, global 401 redirect
    │   └── utils.ts            # cn(), formatDuration(), fuzzyMatch()
    ├── components/
    │   ├── AppShell.tsx        # Layout wrapper (hides sidebar on /setup, /login)
    │   ├── AuthProvider.tsx    # useAuth() hook — user + mode from /api/auth/me
    │   ├── Sidebar.tsx         # Nav, org switcher, user menu
    │   └── StatCard.tsx        # Reusable metric card
    └── app/
        ├── page.tsx            # Repo list with fuzzy search
        ├── setup/              # PAT entry page (standalone only)
        ├── login/              # OAuth login page (organization only)
        ├── settings/           # PAT management + billing widget
        ├── repos/
        │   └── [owner]/[repo]/
        │       ├── page.tsx                    # Workflow card grid
        │       └── workflows/[workflow_id]/
        │           └── page.tsx                # 5-tab metrics dashboard
        └── api/
            ├── auth/
            │   ├── setup/      # POST: validate PAT + save session
            │   ├── login/      # GET: initiate GitHub OAuth
            │   ├── callback/   # GET: exchange code for token
            │   ├── logout/     # POST: destroy session
            │   └── me/         # GET: current user + mode
            └── github/
                ├── repos/          # Authenticated user's repos
                ├── org-repos/      # Org repos
                ├── orgs/           # Orgs the user belongs to
                ├── workflows/      # Workflows for a repo
                ├── runs/           # Workflow runs
                ├── run-details/    # Jobs + steps for a run
                ├── job-stats/      # Aggregated job/step stats
                └── billing/        # GitHub Actions minutes usage
```

---

## Security Checklist

Use this checklist when deploying GitDash. Items marked with a mode tag only apply to that mode.

### Credentials & secrets

- [ ] `SESSION_SECRET` is set to a random string of at least 32 characters
- [ ] `SESSION_SECRET` was generated with `openssl rand -hex 32` or equivalent — not typed manually
- [ ] `SESSION_SECRET` is not committed to version control
- [ ] `.env.local` is listed in `.gitignore` (it is, by default)
- [ ] `[organization]` `GITHUB_CLIENT_SECRET` is stored as a secret, not in plaintext config files
- [ ] `[organization]` The GitHub OAuth App's callback URL exactly matches your deployment URL
- [ ] `[standalone]` Your PAT has only the minimum required scopes (`repo`, `workflow`, `read:org`, `read:user`)
- [ ] `[standalone]` Consider using a **fine-grained PAT** scoped to specific repos with `Actions: read` and `Contents: read` only

### Network & transport

- [ ] HTTPS is enforced in production (the app redirects HTTP → HTTPS when `x-forwarded-proto` is set)
- [ ] A valid TLS certificate is installed on your domain
- [ ] The `Strict-Transport-Security` header is served (the app sets it automatically in production)
- [ ] GitDash is not exposed on a public IP without authentication (the middleware blocks all unauthenticated routes)
- [ ] If behind a reverse proxy, `x-forwarded-proto` is forwarded to the app

### Session & cookies

- [ ] The session cookie is `HttpOnly` (prevents JavaScript access) — this is the iron-session default
- [ ] The session cookie is `Secure` (HTTPS only) — set automatically when `NODE_ENV=production`
- [ ] The session cookie uses `SameSite=Lax` — set by iron-session by default
- [ ] `[organization]` OAuth state tokens expire after 5 minutes — verify this in `src/app/api/auth/login/route.ts`

### HTTP security headers

All headers below are set in `next.config.ts`. Verify with `curl -I https://your-domain`:

- [ ] `Content-Security-Policy` is present and restricts script/style/image/connect origins
- [ ] `X-Frame-Options: DENY` is present (prevents clickjacking)
- [ ] `X-Content-Type-Options: nosniff` is present
- [ ] `Referrer-Policy: strict-origin-when-cross-origin` is present
- [ ] `Permissions-Policy` is present (disables camera, microphone, geolocation)
- [ ] `Strict-Transport-Security` is present in production (HSTS)

### Rate limiting

- [ ] `[standalone]` PAT validation (`POST /api/auth/setup`) is rate-limited to 5 requests/minute/IP
- [ ] `[organization]` OAuth initiation (`GET /api/auth/login`) is rate-limited to 10 requests/minute/IP
- [ ] If you run multiple instances (horizontal scaling), replace the in-memory rate limiter (`src/lib/ratelimit.ts`) with a Redis-backed solution

### Docker

- [ ] The container runs as non-root user `nextjs` (uid 1001) — verify with `docker exec gitdash whoami`
- [ ] `.env.local` is not baked into the Docker image (it is read at runtime via `env_file`)
- [ ] The image is built from `node:20-alpine` (minimal attack surface)
- [ ] Port 3000 is not exposed directly to the internet — use a reverse proxy

### Input validation

- [ ] All `owner`, `repo`, `org` query parameters are validated against the pattern `[a-zA-Z0-9_.-]{1,100}` (done in `src/lib/validation.ts`)
- [ ] `per_page` is clamped to 1–100
- [ ] Error responses sent to the client are generic — raw GitHub errors are logged server-side only

### Dependency hygiene

- [ ] Run `npm audit --production` before deploying — aim for zero high/critical vulnerabilities
- [ ] Dependabot or a similar tool is configured to alert on new CVEs in dependencies

### Logging & monitoring

- [ ] Security events (OAuth state mismatch, expired state, invalid PAT) produce structured `[security]` log lines on the server
- [ ] You have access to server logs (docker logs, cloud log aggregator) to detect brute-force or attack patterns
- [ ] `[standalone]` Repeated 429 responses from `/api/auth/setup` indicate a brute-force attempt — monitor for this

### GitHub App alternative (advanced)

The `repo` OAuth scope grants **write access** to all repositories — this is a GitHub API limitation. For a reduced-permission deployment, consider migrating to a **GitHub App** instead of an OAuth App:

- GitHub Apps support fine-grained permissions (`actions: read`, `contents: read`, `metadata: read`)
- GitHub Apps can be installed at the org level and restricted to specific repositories
- This eliminates the write-access risk of the `repo` scope
