"use client";

import { useState } from "react";
import { Breadcrumb } from "@/components/Sidebar";
import {
  BookOpen, Rocket, Server, Settings2, GitBranch,
  Layers, Shield, HelpCircle, Terminal, ChevronRight,
  AlertTriangle, Info, CheckCircle, Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Table of Contents ─────────────────────────────────────────────────────────
const SECTIONS = [
  { id: "getting-started", label: "Getting Started",   icon: Rocket },
  { id: "deployment",      label: "Deployment",         icon: Server },
  { id: "configuration",   label: "Configuration",      icon: Settings2 },
  { id: "modes",           label: "Modes",              icon: GitBranch },
  { id: "features",        label: "Features",           icon: Layers },
  { id: "security",        label: "Security",           icon: Shield },
  { id: "faq",             label: "FAQ & Troubleshooting", icon: HelpCircle },
  { id: "release-notes",   label: "Release Notes",      icon: Tag },
];

// ── Shared sub-components ─────────────────────────────────────────────────────
function SectionHeading({ id, icon: Icon, children }: {
  id: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-violet-400" />
      </div>
      <h2 id={id} className="text-xl font-bold text-white">{children}</h2>
    </div>
  );
}

function Code({ children, block = false }: { children: React.ReactNode; block?: boolean }) {
  if (block) {
    return (
      <pre className="font-mono text-sm bg-slate-900 border border-slate-700/50 rounded-xl p-4 overflow-x-auto text-slate-300 leading-relaxed">
        {children}
      </pre>
    );
  }
  return (
    <code className="font-mono text-xs bg-slate-800 border border-slate-700/50 rounded px-1.5 py-0.5 text-violet-300">
      {children}
    </code>
  );
}

function Callout({ type = "info", children }: {
  type?: "info" | "warning" | "success"; children: React.ReactNode;
}) {
  const styles = {
    info:    { bg: "bg-blue-500/8 border-blue-500/20",   icon: Info,          text: "text-blue-400" },
    warning: { bg: "bg-amber-500/8 border-amber-500/20", icon: AlertTriangle, text: "text-amber-400" },
    success: { bg: "bg-emerald-500/8 border-emerald-500/20", icon: CheckCircle, text: "text-emerald-400" },
  }[type];
  const Icon = styles.icon;
  return (
    <div className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm text-slate-300", styles.bg)}>
      <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", styles.text)} />
      <div>{children}</div>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700/50 bg-slate-800/60">
            {headers.map((h) => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/30 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-slate-300 align-top">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
      {children}
    </div>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────
function GettingStarted() {
  return (
    <section id="getting-started" className="scroll-mt-6">
      <SectionHeading id="getting-started" icon={Rocket}>Getting Started</SectionHeading>
      <div className="space-y-6">
        <Card>
          <h3 className="font-semibold text-white">Prerequisites</h3>
          <ul className="space-y-1.5 text-sm text-slate-300">
            <li className="flex items-start gap-2"><ChevronRight className="w-3.5 h-3.5 mt-0.5 text-violet-400 shrink-0" /> Node.js 20+</li>
            <li className="flex items-start gap-2"><ChevronRight className="w-3.5 h-3.5 mt-0.5 text-violet-400 shrink-0" /> npm</li>
            <li className="flex items-start gap-2"><ChevronRight className="w-3.5 h-3.5 mt-0.5 text-violet-400 shrink-0" /> A GitHub Personal Access Token (standalone mode) or a GitHub OAuth App (organization mode)</li>
          </ul>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Quick Start — Standalone Mode</h3>
          <p className="text-sm text-slate-400">The fastest way to get running. No OAuth App needed.</p>
          <Code block>{`git clone https://github.com/dinhdobathi1992/gitdash.git
cd gitdash
cp .env.local.example .env.local

# Edit .env.local:
#   MODE=standalone
#   SESSION_SECRET=$(openssl rand -hex 32)

npm install
npm run dev`}</Code>
          <p className="text-sm text-slate-400">
            Open <Code>http://localhost:3000</Code> — you will be redirected to <Code>/setup</Code> to enter your PAT.
          </p>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Quick Start — Organization Mode</h3>
          <p className="text-sm text-slate-400">For teams sharing a single deployment. Requires a GitHub OAuth App.</p>
          <Code block>{`# 1. Create a GitHub OAuth App:
#    Settings → Developer settings → OAuth Apps → New OAuth App
#    Callback URL: http://localhost:3000/api/auth/callback

# 2. Configure .env.local
MODE=organization
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
SESSION_SECRET=$(openssl rand -hex 32)

# 3. Run
npm install && npm run dev`}</Code>
          <Callout type="info">
            Generate a strong <Code>SESSION_SECRET</Code> with: <Code>openssl rand -hex 32</Code>
          </Callout>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Required GitHub PAT Scopes</h3>
          <Table
            headers={["Scope", "Purpose"]}
            rows={[
              [<Code key="s1">repo</Code>, "Repository list + workflow data (private repos)"],
              [<Code key="s2">workflow</Code>, "Workflow runs and job details"],
              [<Code key="s3">read:org</Code>, "Organization membership + org repo list"],
              [<Code key="s4">read:user</Code>, "User identity (avatar, name, login)"],
            ]}
          />
          <Callout type="info">
            For reduced permissions, use a fine-grained PAT with <Code>Actions: read</Code> and <Code>Contents: read</Code> scoped to specific repos.
          </Callout>
        </Card>
      </div>
    </section>
  );
}

function Deployment() {
  return (
    <section id="deployment" className="scroll-mt-6">
      <SectionHeading id="deployment" icon={Server}>Deployment</SectionHeading>
      <div className="space-y-6">
        <Card>
          <h3 className="font-semibold text-white">Docker — Standalone</h3>
          <Code block>{`docker run -d \\
  --name gitdash \\
  -p 3000:3000 \\
  -e MODE=standalone \\
  -e SESSION_SECRET=your_32_char_secret_here \\
  --restart unless-stopped \\
  dinhdobathi1992/gitdash:latest`}</Code>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Docker — Organization Mode</h3>
          <Code block>{`docker run -d \\
  --name gitdash \\
  -p 3000:3000 \\
  -e MODE=organization \\
  -e GITHUB_CLIENT_ID=your_client_id \\
  -e GITHUB_CLIENT_SECRET=your_client_secret \\
  -e SESSION_SECRET=your_32_char_secret_here \\
  -e NEXT_PUBLIC_APP_URL=https://gitdash.example.com \\
  --restart unless-stopped \\
  dinhdobathi1992/gitdash:latest`}</Code>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Docker Compose</h3>
          <p className="text-sm text-slate-400">Create a <Code>docker-compose.yml</Code> alongside your <Code>.env.local</Code>:</p>
          <Code block>{`services:
  gitdash:
    image: dinhdobathi1992/gitdash:latest
    ports:
      - "3000:3000"
    env_file:
      - .env.local
    restart: unless-stopped`}</Code>
          <Code block>{`docker compose up -d      # start
docker compose down       # stop
docker compose logs -f    # view logs`}</Code>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Vercel (One-click)</h3>
          <p className="text-sm text-slate-400">GitDash deploys to Vercel automatically on push to <Code>main</Code>. To deploy your own fork:</p>
          <ol className="space-y-2 text-sm text-slate-300 list-decimal list-inside">
            <li>Fork the repository on GitHub</li>
            <li>Import the fork in Vercel (New Project → Import Git Repository)</li>
            <li>Add all required environment variables in Vercel&apos;s project settings</li>
            <li>Set the <Code>Authorization callback URL</Code> in your GitHub OAuth App to <Code>https://your-vercel-url/api/auth/callback</Code></li>
          </ol>
          <Callout type="warning">
            <Code>DATABASE_URL</Code> must be added manually in Vercel&apos;s project settings → Environment Variables → Production. It is not included in the repository.
          </Callout>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Reverse Proxy / Custom Domain</h3>
          <ol className="space-y-2 text-sm text-slate-300 list-decimal list-inside">
            <li>Set <Code>NEXT_PUBLIC_APP_URL</Code> to your public URL (e.g. <Code>https://gitdash.example.com</Code>)</li>
            <li>Update the OAuth App callback URL to match</li>
            <li>Ensure your proxy forwards the <Code>x-forwarded-proto</Code> header — the app uses this to enforce HTTPS redirects</li>
          </ol>
        </Card>
      </div>
    </section>
  );
}

function Configuration() {
  return (
    <section id="configuration" className="scroll-mt-6">
      <SectionHeading id="configuration" icon={Settings2}>Configuration</SectionHeading>
      <div className="space-y-6">
        <Card>
          <h3 className="font-semibold text-white">Environment Variables</h3>
          <Table
            headers={["Variable", "Required", "Description", "Example"]}
            rows={[
              [
                <Code key="v1">SESSION_SECRET</Code>,
                <span key="r1" className="text-red-400 font-medium">Required</span>,
                "Random string ≥ 32 characters. Encrypts session cookies with AES-256-GCM. App refuses to start in production if missing or too short.",
                <Code key="e1">openssl rand -hex 32</Code>,
              ],
              [
                <Code key="v2">MODE</Code>,
                <span key="r2" className="text-slate-400">Optional</span>,
                <>Default: <Code>standalone</Code>. Set to <Code>organization</Code>, <Code>org</Code>, or <Code>team</Code> to enable org mode.</>,
                <Code key="e2">organization</Code>,
              ],
              [
                <Code key="v3">GITHUB_CLIENT_ID</Code>,
                <span key="r3" className="text-amber-400 font-medium">Org mode only</span>,
                "GitHub OAuth App Client ID.",
                <Code key="e3">Ov23liXXXXXXXX</Code>,
              ],
              [
                <Code key="v4">GITHUB_CLIENT_SECRET</Code>,
                <span key="r4" className="text-amber-400 font-medium">Org mode only</span>,
                "GitHub OAuth App Client Secret. Never commit this value.",
                <Code key="e4">a1b2c3d4e5...</Code>,
              ],
              [
                <Code key="v5">DATABASE_URL</Code>,
                <span key="r5" className="text-amber-400 font-medium">Org mode only</span>,
                "PostgreSQL connection string (Neon or any Postgres). Required for alert rules, reports, and sync features.",
                <Code key="e5">postgresql://user:pass@host/db</Code>,
              ],
              [
                <Code key="v6">NEXT_PUBLIC_APP_URL</Code>,
                <span key="r6" className="text-slate-400">Optional</span>,
                "Public URL of the deployment. Used to build OAuth callback URLs and enforce HTTPS redirects.",
                <Code key="e6">https://gitdash.example.com</Code>,
              ],
              [
                <Code key="v7">NEXT_PUBLIC_APP_VERSION</Code>,
                <span key="r7" className="text-slate-400">Optional</span>,
                "App version shown in the sidebar version badge. Set automatically by the release workflow.",
                <Code key="e7">2.3.0</Code>,
              ],
            ]}
          />
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Example <Code>.env.local</Code> — Standalone</h3>
          <Code block>{`MODE=standalone
SESSION_SECRET=replace_with_openssl_rand_hex_32_output
NEXT_PUBLIC_APP_URL=http://localhost:3000`}</Code>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Example <Code>.env.local</Code> — Organization</h3>
          <Code block>{`MODE=organization
GITHUB_CLIENT_ID=your_oauth_app_client_id
GITHUB_CLIENT_SECRET=your_oauth_app_client_secret
SESSION_SECRET=replace_with_openssl_rand_hex_32_output
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
NEXT_PUBLIC_APP_URL=https://gitdash.example.com`}</Code>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Creating a GitHub OAuth App</h3>
          <ol className="space-y-2 text-sm text-slate-300 list-decimal list-inside">
            <li>Go to <strong className="text-white">GitHub → Settings → Developer settings → OAuth Apps → New OAuth App</strong></li>
            <li>Fill in the fields:</li>
          </ol>
          <Table
            headers={["Field", "Value"]}
            rows={[
              ["Application name", "GitDash"],
              ["Homepage URL", <Code key="h">https://your-domain.com</Code>],
              ["Authorization callback URL", <Code key="c">https://your-domain.com/api/auth/callback</Code>],
            ]}
          />
          <ol start={3} className="space-y-1 text-sm text-slate-300 list-decimal list-inside">
            <li>Click <strong className="text-white">Register application</strong>, then copy the <strong className="text-white">Client ID</strong></li>
            <li>Click <strong className="text-white">Generate a new client secret</strong> and copy it immediately — it is shown only once</li>
          </ol>
        </Card>
      </div>
    </section>
  );
}

function Modes() {
  return (
    <section id="modes" className="scroll-mt-6">
      <SectionHeading id="modes" icon={GitBranch}>Modes</SectionHeading>
      <div className="space-y-6">
        <Card>
          <h3 className="font-semibold text-white">Standalone vs. Organization</h3>
          <Table
            headers={["", "Standalone", "Organization"]}
            rows={[
              ["Auth method", "Personal Access Token (PAT)", "GitHub OAuth App"],
              ["Login page", <Code key="l1">/setup</Code>, <Code key="l2">/login</Code>],
              ["Best for", "Personal use, local dashboards", "Teams sharing one deployment"],
              ["OAuth App required", <span key="o1" className="text-emerald-400">No</span>, <span key="o2" className="text-red-400">Yes</span>],
              ["Database features", <span key="d1" className="text-slate-500">Not available</span>, <span key="d2" className="text-emerald-400">Available</span>],
              ["Alert rules", <span key="a1" className="text-slate-500">Not available</span>, <span key="a2" className="text-emerald-400">Available</span>],
              ["Reports / sync", <span key="r1" className="text-slate-500">Not available</span>, <span key="r2" className="text-emerald-400">Available</span>],
              ["Cost Analytics", "Own repos only", "All org repos (Enhanced Billing Plan required)"],
              ["Multi-user", <span key="m1" className="text-slate-500">No — single session</span>, <span key="m2" className="text-emerald-400">Yes — isolated sessions per user</span>],
            ]}
          />
        </Card>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium">standalone</span>
              <h3 className="font-semibold text-white">When to use Standalone</h3>
            </div>
            <ul className="space-y-1.5 text-sm text-slate-300">
              {[
                "You're the only user",
                "You don't want to create a GitHub OAuth App",
                "You're running locally on your laptop",
                "You want the simplest possible setup",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <CheckCircle className="w-3.5 h-3.5 mt-0.5 text-emerald-400 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/20 font-medium">organization</span>
              <h3 className="font-semibold text-white">When to use Organization</h3>
            </div>
            <ul className="space-y-1.5 text-sm text-slate-300">
              {[
                "Multiple team members share one deployment",
                "You want each person to use their own GitHub account",
                "You need alert rules, reports, or DB-backed features",
                "You want to restrict access to a specific GitHub org",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <CheckCircle className="w-3.5 h-3.5 mt-0.5 text-violet-400 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card>
          <h3 className="font-semibold text-white">Switching Modes</h3>
          <p className="text-sm text-slate-400">
            Change the <Code>MODE</Code> environment variable and restart the server. All session data is invalidated automatically — users will be redirected to the appropriate login page.
          </p>
          <Code block>{`# Switch to org mode
MODE=organization

# Switch back to standalone
MODE=standalone   # or unset MODE entirely`}</Code>
        </Card>
      </div>
    </section>
  );
}

function Features() {
  const pages = [
    {
      name: "Repositories",
      path: "/",
      desc: "Browse all your personal and organization repositories. Fuzzy search with keyboard navigation. Switch between personal repos and any org you belong to via the sidebar.",
      chips: ["Fuzzy search", "Org switcher", "Workflow status chips"],
    },
    {
      name: "Workflow Dashboard",
      path: "/repos/[owner]/[repo]/workflows/[id]",
      desc: "5-tab deep-dive into any workflow. Auto-refreshes every 30 seconds while runs are in progress.",
      chips: ["Overview", "Performance", "Reliability", "Triggers", "Runs"],
    },
    {
      name: "Cost Analytics",
      path: "/cost-analytics",
      desc: "GitHub Actions minutes and cost breakdown. Requires org mode with the Enhanced Billing Platform (Team/Enterprise). Shows per-repo, per-workflow spend.",
      chips: ["Org mode", "Enhanced Billing Plan required"],
    },
    {
      name: "Reports",
      path: "/reports",
      desc: "Scheduled and historical reports backed by the database. Available in organization mode only.",
      chips: ["Org mode only", "Database required"],
    },
    {
      name: "Alerts",
      path: "/alerts",
      desc: "Define alert rules triggered by workflow outcomes, duration thresholds, or failure streaks. Available in organization mode only.",
      chips: ["Org mode only", "Database required"],
    },
    {
      name: "Settings",
      path: "/settings",
      desc: "Manage your PAT (standalone) or view your OAuth session (org mode). Includes a GitHub Actions billing widget showing remaining free minutes.",
      chips: ["PAT management", "Billing widget"],
    },
  ];

  return (
    <section id="features" className="scroll-mt-6">
      <SectionHeading id="features" icon={Layers}>Features</SectionHeading>
      <div className="space-y-6">
        <div className="grid gap-4">
          {pages.map((p) => (
            <Card key={p.name}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-white">{p.name}</h3>
                    <Code>{p.path}</Code>
                  </div>
                  <p className="text-sm text-slate-400">{p.desc}</p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {p.chips.map((c) => (
                      <span key={c} className="text-xs px-2 py-0.5 rounded bg-slate-700/60 text-slate-300 border border-slate-600/50">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Card>
          <h3 className="font-semibold text-white">Workflow Dashboard Tabs</h3>
          <Table
            headers={["Tab", "What you see"]}
            rows={[
              ["Overview", "Rolling success rate, duration trend, outcome pie chart, run frequency heatmap"],
              ["Performance", "Per-job avg/p95 bar chart, stacked job waterfall per run, slowest steps table"],
              ["Reliability", "MTTR, failure streaks, flaky branch detection, re-run rate, pass/fail timeline"],
              ["Triggers", "Event breakdown, top branches, hour-of-day heatmap, day-of-week chart, actor leaderboard"],
              ["Runs", "Sortable table with commit message, PR link, run attempt count, CSV export"],
            ]}
          />
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Other Capabilities</h3>
          <ul className="space-y-1.5 text-sm text-slate-300">
            {[
              "Job & step drill-down — expand any run row to see per-job and per-step timings",
              "Per-chart PNG download — export any chart as an image",
              "Auto-refresh — polls every 30 seconds while any run is in progress",
              "Browser notifications for new workflow failures (opt-in)",
              "CSV export from the Runs tab",
              "Multi-arch Docker image (amd64 + arm64)",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <CheckCircle className="w-3.5 h-3.5 mt-0.5 text-violet-400 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}

function Security() {
  return (
    <section id="security" className="scroll-mt-6">
      <SectionHeading id="security" icon={Shield}>Security</SectionHeading>
      <div className="space-y-6">
        <Callout type="success">
          GitDash is designed so your PAT or OAuth token <strong>never touches the browser</strong>. All credentials live in an encrypted, HTTP-only session cookie on the server.
        </Callout>

        <Card>
          <h3 className="font-semibold text-white">Request Flow</h3>
          <Code block>{`Browser ──── request ────► Middleware (decrypt session cookie)
                                    │
                                    ├─ No token? ──► Redirect to /setup or /login
                                    │
                                    ▼ Valid session
                         /api/github/* routes
                                    │
                            Retrieve encrypted token
                            from session (server-side)
                                    │
                                    ▼
                          GitHub REST API
                         (Bearer token auth)
                                    │
                                    ▼
                           JSON response
                     (token never sent to browser)`}</Code>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Protection Layers</h3>
          <Table
            headers={["Layer", "Mechanism"]}
            rows={[
              ["Encryption", "AES-256-GCM via iron-session v8 — industry-standard authenticated encryption"],
              ["Cookie flags", <><Code key="h">HttpOnly</Code> (no JS access), <Code key="s">Secure</Code> (HTTPS only in production), <Code key="ss">SameSite=Lax</Code> (CSRF protection)</>],
              ["Session secret", "32+ character minimum enforced at startup in production. Generates with openssl rand -hex 32."],
              ["Rate limiting", <><Code key="rl">/api/auth/setup</Code>: 5 attempts/min/IP (standalone). <Code key="rl2">/api/auth/login</Code>: 10 attempts/min/IP (org mode)</>],
              ["Input validation", <>All <Code key="ov">owner</Code>, <Code key="rv">repo</Code>, <Code key="orgv">org</Code> params validated against <Code key="pat">[a-zA-Z0-9_.-]{"{1,100}"}</Code></>],
              ["HTTP headers", "CSP, HSTS, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy"],
              ["Docker", "Runs as non-root user nextjs (uid 1001). Built from node:20-alpine."],
              ["Logout", <><Code key="sd">session.destroy()</Code> deletes the cookie immediately. POST method prevents CSRF.</>],
            ]}
          />
        </Card>

        <Card>
          <h3 className="font-semibold text-white">What Is Never Stored</h3>
          <ul className="space-y-1.5 text-sm text-slate-300">
            {[
              "PAT in localStorage or sessionStorage — verified: 0 matches in src/",
              "PAT in API responses returned to the client — verified: 0 matches in src/app/api/",
              "PAT in server logs — only IP + timestamp logged on security events",
              "PAT as a URL query parameter — always POST body, HTTPS encrypted in transit",
              "OAuth token in the database — session-only, lives in the encrypted cookie",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Shield className="w-3.5 h-3.5 mt-0.5 text-emerald-400 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h3 className="font-semibold text-white">Self-Audit Commands</h3>
          <p className="text-sm text-slate-400 mb-3">Run these in the project root to verify security claims yourself:</p>
          <Code block>{`# PAT never in browser storage
grep -r "localStorage|sessionStorage" src/ --include="*.tsx" --include="*.ts"
# Expected: 0 matches ✓

# PAT never returned in API responses
grep -rn "return.*pat|json.*pat" src/app/api --include="*.ts"
# Expected: 0 matches ✓

# PAT never logged
grep -rn "console.*\${.*pat|console.*pat\)" src/ --include="*.ts" --include="*.tsx"
# Expected: 0 matches ✓

# XSS: dangerouslySetInnerHTML not used
grep -r "dangerouslySetInnerHTML" src/
# Expected: 0 matches ✓

# Check dependency vulnerabilities
npm audit --production
# Expected: 0 high/critical vulnerabilities ✓`}</Code>
        </Card>
      </div>
    </section>
  );
}

function FAQ() {
  const items = [
    {
      q: "I see a blank screen or 500 error after deploying.",
      a: (
        <>
          Check that <Code>SESSION_SECRET</Code> is set and is at least 32 characters. The app throws at startup in production if it is missing or too short. Check server logs for <Code>[startup]</Code> errors.
        </>
      ),
    },
    {
      q: "Cost Analytics shows a 404 error about billing.",
      a: (
        <>
          In <strong className="text-white">org mode</strong>, Cost Analytics requires the GitHub Enhanced Billing Platform (Team or Enterprise). Your org may not be on this plan. In <strong className="text-white">standalone mode</strong>, only your personal billing data is available — org billing is not accessible via a PAT.
        </>
      ),
    },
    {
      q: "OAuth callback fails with 'state mismatch' or 'expired state'.",
      a: (
        <>
          OAuth state tokens expire after 5 minutes. If the user takes longer to authorize, they will need to click &quot;Sign in with GitHub&quot; again. Also verify that <Code>NEXT_PUBLIC_APP_URL</Code> exactly matches the callback URL registered in your GitHub OAuth App.
        </>
      ),
    },
    {
      q: "DATABASE_URL is set but reports/alerts still don't work.",
      a: (
        <>
          Confirm you are in <Code>MODE=organization</Code>. These features are disabled in standalone mode regardless of whether <Code>DATABASE_URL</Code> is set. Also check that the database is reachable from your deployment (Neon requires the correct SSL mode: <Code>?sslmode=require</Code>).
        </>
      ),
    },
    {
      q: "SESSION_SECRET must be at least 32 characters — but I'm running locally.",
      a: (
        <>
          This check only applies when <Code>NODE_ENV=production</Code>. In development (<Code>npm run dev</Code>) any value is accepted. For local testing you can use any string; for production, generate one with <Code>openssl rand -hex 32</Code>.
        </>
      ),
    },
    {
      q: "The sidebar shows 'standalone' but I set MODE=organization.",
      a: (
        <>
          Restart the server after changing environment variables — Next.js reads env vars at startup. Also confirm the variable is set in the correct file (<Code>.env.local</Code> for local; Vercel/Docker env for production) and that there is no trailing whitespace.
        </>
      ),
    },
    {
      q: "How do I update to a new version?",
      a: (
        <>
          Pull the latest Docker image: <Code>docker pull dinhdobathi1992/gitdash:latest</Code> then restart your container. For self-built deployments, pull the latest commit and rebuild.
        </>
      ),
    },
    {
      q: "Can I use a fine-grained PAT instead of a classic PAT?",
      a: (
        <>
          Yes. Use a fine-grained PAT with <Code>Actions: read</Code> and <Code>Contents: read</Code> scoped to specific repositories. This gives least-privilege access. Note that fine-grained PATs cannot access organization data (<Code>read:org</Code> scope), so org-level features will not work.
        </>
      ),
    },
  ];

  return (
    <section id="faq" className="scroll-mt-6">
      <SectionHeading id="faq" icon={HelpCircle}>FAQ &amp; Troubleshooting</SectionHeading>
      <div className="space-y-4">
        {items.map((item, i) => (
          <Card key={i}>
            <div className="flex items-start gap-3">
              <Terminal className="w-4 h-4 mt-0.5 text-violet-400 shrink-0" />
              <div className="space-y-2">
                <p className="text-sm font-semibold text-white">{item.q}</p>
                <p className="text-sm text-slate-400 leading-relaxed">{item.a}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function ReleaseNotes() {
  const releases = [
    {
      version: "2.3.0",
      date: "2026-03-01",
      badge: "latest",
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "In-app /docs page with 7 sections, sticky table of contents, and version badge",
          "GitHub webhook receiver at /api/webhooks/github — workflow_run events now auto-sync into Neon DB without manual triggers",
          "Alert rule evaluation wired into POST /api/db/sync — rules are checked after every sync",
          "Slack webhook delivery for alert rules (channel=slack)",
          "alerts_fired count shown in Reports page sync result banner",
          "/docs publicly accessible before authentication (no login required)",
          "Documentation link added to /login and /setup footers",
        ],
        fixed: [
          "Sidebar no longer renders on /docs for unauthenticated visitors",
          "SWR global 401 handler no longer redirects away from /docs",
        ],
        improved: [
          "upsertRuns() replaced N+1 per-row SQL loop with a single Neon HTTP transaction — up to 500× fewer round-trips per sync",
        ],
      },
    },
    {
      version: "2.2.0",
      date: "2026-02-20",
      badge: null,
      badgeColor: "",
      changes: {
        added: [
          "Reports page — DB-backed historical reporting with daily area chart and quarterly breakdown",
          "Alert rules CRUD UI at /alerts with per-repo and per-org scopes",
          "Neon PostgreSQL integration with idempotent schema migration (ensureSchema)",
          "POST /api/db/sync — incremental GitHub → DB sync with cursor tracking",
          "GET /api/db/runs and /api/db/trends endpoints for historical queries",
          "Quarterly summary SQL aggregation (getQuarterlySummary)",
          "Org daily trend aggregation across all repos (getOrgDailyTrends)",
        ],
        fixed: [],
        improved: [
          "Sync cursor prevents re-fetching already-stored runs on repeated syncs",
        ],
      },
    },
    {
      version: "2.1.0",
      date: "2026-02-10",
      badge: null,
      badgeColor: "",
      changes: {
        added: [
          "Cost Analytics page at /cost-analytics — GitHub Actions billing breakdown by SKU/runner type",
          "Monthly burn rate progress bar with warning/critical thresholds",
          "Projected end-of-month minutes calculation",
          "Org dashboard at /org/[orgName] — reliability heatmap and sortable repo table",
          "Audit tab at /repos/[owner]/[repo]/audit — workflow file commit history",
          "Security tab at /repos/[owner]/[repo]/security",
          "Team stats tab at /repos/[owner]/[repo]/team — per-contributor heatmaps and leaderboard",
        ],
        fixed: [
          "OAuth state now expires after 5 minutes to prevent stale CSRF tokens",
        ],
        improved: [
          "Repo overview fetches up to 10 workflows in parallel batches of 5",
        ],
      },
    },
    {
      version: "2.0.0",
      date: "2026-01-15",
      badge: null,
      badgeColor: "",
      changes: {
        added: [
          "Organization mode — GitHub OAuth App login with isolated per-user sessions",
          "Multi-arch Docker image (linux/amd64 + linux/arm64)",
          "Automated CI pipeline: lint → typecheck → build on every push to main",
          "Vercel deployment pipeline with automatic preview and production deploys",
          "Middleware-based auth gate (proxy.ts) with ALWAYS_PUBLIC path list",
          "iron-session v8 with AES-256-GCM cookie encryption",
          "HTTP security headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options",
          "Rate limiting on /api/auth/setup (5 req/min) and /api/auth/login (10 req/min)",
          "Input validation for all owner/repo/org path parameters",
          "HTTP → HTTPS redirect via x-forwarded-proto in production",
          "Non-root Docker user (nextjs uid 1001)",
        ],
        fixed: [],
        improved: [
          "SESSION_SECRET minimum length enforced at startup in production",
          "Lazy Neon DB singleton — no build-time crash when DATABASE_URL is absent",
        ],
      },
    },
    {
      version: "1.0.0",
      date: "2025-12-01",
      badge: null,
      badgeColor: "",
      changes: {
        added: [
          "Initial release — standalone mode with PAT-based authentication",
          "Repositories list with fuzzy search and keyboard navigation",
          "Workflow dashboard with 5 tabs: Overview, Performance, Reliability, Triggers, Runs",
          "Per-job and per-step drill-down with timing waterfall",
          "Auto-refresh every 30 seconds while runs are in-progress",
          "Browser notifications for new workflow failures (opt-in)",
          "CSV export from the Runs tab",
          "Per-chart PNG download",
          "Success rate, MTTR, failure streaks, and flaky branch detection",
          "Trigger analytics: event breakdown, actor leaderboard, hour/day heatmaps",
        ],
        fixed: [],
        improved: [],
      },
    },
  ];

  const chipColors: Record<string, string> = {
    added:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    fixed:    "bg-blue-500/10 text-blue-400 border-blue-500/20",
    improved: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  };

  const dotColors: Record<string, string> = {
    added:    "text-emerald-400",
    fixed:    "text-blue-400",
    improved: "text-violet-400",
  };

  return (
    <section id="release-notes" className="scroll-mt-6">
      <SectionHeading id="release-notes" icon={Tag}>Release Notes</SectionHeading>
      <div className="space-y-6">
        {releases.map((r) => (
          <Card key={r.version}>
            {/* version header */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-lg font-bold text-white">v{r.version}</span>
              {r.badge && (
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${r.badgeColor}`}>
                  {r.badge}
                </span>
              )}
              <span className="text-xs text-slate-500">{r.date}</span>
            </div>

            {/* change groups */}
            <div className="space-y-4 pt-1">
              {(["added", "fixed", "improved"] as const).map((kind) => {
                const items = r.changes[kind];
                if (!items.length) return null;
                const label = kind === "added" ? "Added" : kind === "fixed" ? "Fixed" : "Improved";
                return (
                  <div key={kind}>
                    <span className={`inline-block text-xs px-2 py-0.5 rounded border font-semibold mb-2 ${chipColors[kind]}`}>
                      {label}
                    </span>
                    <ul className="space-y-1.5">
                      {items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                          <ChevronRight className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${dotColors[kind]}`} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}


export default function DocsPage() {
  const [active, setActive] = useState("getting-started");

  function scrollTo(id: string) {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <Breadcrumb items={[{ label: "Docs" }]} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-violet-400" />
            <h1 className="text-2xl font-bold text-white">Documentation</h1>
            <span className="text-xs px-2 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/20 font-mono">
              v{process.env.NEXT_PUBLIC_APP_VERSION ?? "2.0.0"}
            </span>
          </div>
          <p className="text-slate-400 text-sm">
            Everything you need to deploy, configure, and use GitDash.
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex gap-10 items-start">
        {/* Sticky ToC */}
        <nav className="w-52 shrink-0 sticky top-8 self-start">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">On this page</p>
          <ul className="space-y-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  onClick={() => scrollTo(id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-left transition-colors",
                    active === id
                      ? "bg-violet-500/15 text-violet-300 border border-violet-500/20"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                  )}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Main content */}
        <div className="flex-1 space-y-16 min-w-0">
          <GettingStarted />
          <Deployment />
          <Configuration />
          <Modes />
          <Features />
          <Security />
          <FAQ />
          <ReleaseNotes />
        </div>
      </div>
    </div>
  );
}
