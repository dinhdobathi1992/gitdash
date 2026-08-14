"use client";

import { useState, useEffect } from "react";
import {
  BookOpen, Rocket, Server, Settings2, GitBranch,
  Layers, Shield, HelpCircle, Terminal, ChevronRight,
  Tag, Search, Menu, X, Code2, Users, ChevronDown,
  ExternalLink, GitPullRequest, Cpu,
  CheckCircle,
  Activity, FileText, ShieldAlert, User, DollarSign,
  TrendingUp, Bell, Building2, List, BarChart3, Trophy, Sliders,
  HeartPulse, AlertTriangle, Mail, MessageCircle, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Callout } from "@/components/docs/Callout";
import { CodeBlock, Code } from "@/components/docs/CodeBlock";
import { DocCard, DocTable, FeatureGrid, FeatureCard } from "@/components/docs/DocCard";
import { Tabs, Tab } from "@/components/docs/Tabs";
import { Steps, Step } from "@/components/docs/Steps";
import { DocSearch } from "@/components/docs/DocSearch";

// ── Navigation structure ──────────────────────────────────────────────────────

type NavItem = { id: string; label: string; icon: React.ElementType; sub?: boolean };
type NavSection = { title: string; items: NavItem[] };

const NAV: NavSection[] = [
  {
    title: "Getting Started",
    items: [
      { id: "getting-started", label: "Introduction", icon: Rocket },
      { id: "deployment", label: "Deployment", icon: Server },
      { id: "configuration", label: "Configuration", icon: Settings2 },
    ],
  },
  {
    title: "Core Concepts",
    items: [
      { id: "modes", label: "Auth Modes", icon: GitBranch },
      { id: "security", label: "Security Model", icon: Shield },
      { id: "core-concepts", label: "Data Sources", icon: Cpu },
    ],
  },
  {
    title: "Features",
    items: [
      { id: "features", label: "Feature Overview", icon: Layers },
      { id: "feat-repositories", label: "Repositories", icon: List, sub: true },
      { id: "feat-repo-overview", label: "Repository Overview", icon: BarChart3, sub: true },
      { id: "feat-workflow", label: "Workflow Detail", icon: Activity, sub: true },
      { id: "feat-audit", label: "Audit Trail", icon: FileText, sub: true },
      { id: "feat-security", label: "Security Scan", icon: ShieldAlert, sub: true },
      { id: "feat-repo-team", label: "Repo Team Stats", icon: Trophy, sub: true },
      { id: "feat-team", label: "Team Insights", icon: Users, sub: true },
      { id: "feat-contributor", label: "Contributor Profile", icon: User, sub: true },
      { id: "feat-cost", label: "Cost Analytics", icon: DollarSign, sub: true },
      { id: "feat-reports", label: "Reports", icon: TrendingUp, sub: true },
      { id: "feat-alerts", label: "Alerts", icon: Bell, sub: true },
      { id: "feat-settings", label: "Settings", icon: Sliders, sub: true },
      { id: "feat-org", label: "Org Overview", icon: Building2, sub: true },
      { id: "feat-health-scorecard", label: "Team Health Scorecard", icon: HeartPulse, sub: true },
      { id: "feat-workload-risk", label: "Workload Risk Radar", icon: AlertTriangle, sub: true },
      { id: "feat-one-on-one", label: "1:1 Prep Sheet", icon: MessageCircle, sub: true },
      { id: "feat-leadership-digest", label: "Leadership Digest", icon: Mail, sub: true },
      { id: "feat-ai-insights", label: "AI Insights", icon: Sparkles, sub: true },
    ],
  },
  {
    title: "Reference",
    items: [
      { id: "metrics-reference",      label: "Metrics Reference",   icon: BarChart3 },
      { id: "metrics-dora",           label: "DORA 4 Keys",         icon: Rocket,      sub: true },
      { id: "metrics-pr-cycle",       label: "PR Cycle Time",       icon: GitBranch,   sub: true },
      { id: "metrics-pr-health",      label: "PR Lifecycle Health", icon: Activity,    sub: true },
      { id: "metrics-workflow",       label: "Workflow Overview",   icon: BarChart3,   sub: true },
      { id: "metrics-performance",    label: "Performance Tab",     icon: TrendingUp,  sub: true },
      { id: "metrics-reliability",    label: "Reliability Tab",     icon: Shield,      sub: true },
      { id: "metrics-team",           label: "Team & People",       icon: Users,       sub: true },
      { id: "metrics-ci-alerts",      label: "CI & Alert Metrics",  icon: Bell,        sub: true },
      { id: "api-reference",          label: "API Reference",       icon: Code2 },
    ],
  },
  {
    title: "Support",
    items: [
      { id: "faq", label: "FAQ & Troubleshooting", icon: HelpCircle },
      { id: "contributing", label: "Contributing", icon: GitPullRequest },
      { id: "release-notes", label: "Release Notes", icon: Tag },
    ],
  },
];

const ALL_SECTIONS = NAV.flatMap((s) => s.items);

// ── Shared micro-components ───────────────────────────────────────────────────

function SectionHeading({ id, icon: Icon, badge, children }: {
  id: string; icon: React.ElementType; badge?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 mb-8 pb-4 border-b border-slate-800">
      <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center shrink-0">
        <Icon className="w-4.5 h-4.5 text-violet-400" />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 id={id} className="text-2xl font-bold text-white">{children}</h2>
        {badge && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20 font-medium">
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="font-semibold text-white text-base mb-3">{children}</h3>;
}

function ProseP({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400 leading-relaxed">{children}</p>;
}

// ── Sections ──────────────────────────────────────────────────────────────────

function GettingStarted() {
  return (
    <section id="getting-started" className="scroll-mt-8 space-y-6">
      <SectionHeading id="getting-started" icon={Rocket}>Introduction</SectionHeading>

      <FeatureGrid>
        <FeatureCard icon="📊" title="Engineering Intelligence">
          Deep-dive into DORA metrics, Cycle Time breakdowns, and success rates across all your GitHub Actions workflows and Pull Requests.
        </FeatureCard>
        <FeatureCard icon="💰" title="Cost Analytics">
          Track GitHub Actions minutes and spend per workflow. Identify runaway costs and optimize your CI budget.
        </FeatureCard>
        <FeatureCard icon="🔒" title="Enterprise Security">
          Your PAT never touches the browser. AES-256-GCM encrypted sessions, HttpOnly cookies, and rate limiting built-in.
        </FeatureCard>
        <FeatureCard icon="👥" title="Team Performance">
          Reviewer load balancing, CI success rates per contributor, and upcoming deep-dive Contributor Profiles to prevent burnout.
        </FeatureCard>
      </FeatureGrid>

      <DocCard>
        <SubHeading>Prerequisites</SubHeading>
        <ul className="space-y-2 text-sm text-slate-300">
          {[
            "Node.js 20+",
            "pnpm (or Docker for containerized deployments)",
            "A GitHub Personal Access Token — for standalone mode",
            "A GitHub OAuth App — for organization mode (team sharing)",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-violet-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </DocCard>

      <DocCard>
        <SubHeading>Quick Start — Standalone Mode</SubHeading>
        <ProseP>The fastest way to get running. No OAuth App needed — just your GitHub PAT.</ProseP>
        <CodeBlock language="bash" filename="terminal">
          {`git clone https://github.com/dinhdobathi1992/gitdash.git
cd gitdash
cp .env.local.example .env.local

# Edit .env.local — set these two values:
MODE=standalone
SESSION_SECRET=$(openssl rand -hex 32)

pnpm install
pnpm run dev`}
        </CodeBlock>
        <ProseP>
          Open <Code>http://localhost:3000</Code> — you will be redirected to <Code>/setup</Code> to enter your PAT.
        </ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Quick Start — Organization Mode</SubHeading>
        <ProseP>For teams sharing a single deployment. Requires a GitHub OAuth App.</ProseP>
        <Steps>
          <Step title="Create a GitHub OAuth App" step={1}>
            Go to <strong className="text-white">GitHub → Settings → Developer settings → OAuth Apps → New OAuth App</strong>.
            Set the callback URL to <Code>http://localhost:3000/api/auth/callback</Code>.
          </Step>
          <Step title="Configure .env.local" step={2}>
            <CodeBlock language="bash" filename=".env.local">
              {`MODE=organization
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
SESSION_SECRET=$(openssl rand -hex 32)`}
            </CodeBlock>
          </Step>
          <Step title="Start the server" step={3}>
            <CodeBlock language="bash" filename="terminal">
              {`pnpm install && pnpm run dev`}
            </CodeBlock>
          </Step>
        </Steps>
        <Callout type="info">
          Generate a strong <Code>SESSION_SECRET</Code> with: <Code>openssl rand -hex 32</Code>
        </Callout>
      </DocCard>

      <DocCard>
        <SubHeading>Required GitHub PAT Scopes</SubHeading>
        <DocTable
          headers={["Scope", "Purpose"]}
          rows={[
            [<Code key="s1">repo</Code>, "Repository list + workflow data (private repos)"],
            [<Code key="s2">workflow</Code>, "Workflow runs and job details"],
            [<Code key="s3">read:org</Code>, "Organization membership + org repo list"],
            [<Code key="s4">read:user</Code>, "User identity (avatar, name, login)"],
          ]}
        />
        <Callout type="success">
          For reduced permissions, use a fine-grained PAT with <Code>Actions: read</Code> and <Code>Contents: read</Code> scoped to specific repos.
        </Callout>
      </DocCard>
    </section>
  );
}

function Deployment() {
  return (
    <section id="deployment" className="scroll-mt-8 space-y-6">
      <SectionHeading id="deployment" icon={Server}>Deployment</SectionHeading>

      <DocCard>
        <SubHeading>Docker</SubHeading>
        <Tabs items={["Standalone", "Organization", "Docker Compose"]}>
          <Tab>
            <CodeBlock language="bash">
              {`docker run -d \\
  --name gitdash \\
  -p 3000:3000 \\
  -e MODE=standalone \\
  -e SESSION_SECRET=your_32_char_secret_here \\
  --restart unless-stopped \\
  dinhdobathi1992/gitdash:latest`}
            </CodeBlock>
          </Tab>
          <Tab>
            <CodeBlock language="bash">
              {`docker run -d \\
  --name gitdash \\
  -p 3000:3000 \\
  -e MODE=organization \\
  -e GITHUB_CLIENT_ID=your_client_id \\
  -e GITHUB_CLIENT_SECRET=your_client_secret \\
  -e SESSION_SECRET=your_32_char_secret_here \\
  -e NEXT_PUBLIC_APP_URL=https://gitdash.example.com \\
  --restart unless-stopped \\
  dinhdobathi1992/gitdash:latest`}
            </CodeBlock>
          </Tab>
          <Tab>
            <CodeBlock language="yaml" filename="docker-compose.yml">
              {`services:
  gitdash:
    image: dinhdobathi1992/gitdash:latest
    ports:
      - "3000:3000"
    env_file:
      - .env.local
    restart: unless-stopped`}
            </CodeBlock>
            <div className="p-4 border-t border-slate-700/30">
              <CodeBlock language="bash" filename="terminal">
                {`docker compose up -d      # start
docker compose down       # stop
docker compose logs -f    # view logs`}
              </CodeBlock>
            </div>
          </Tab>
        </Tabs>
      </DocCard>

      <DocCard>
        <SubHeading>Vercel (One-click)</SubHeading>
        <ProseP>GitDash deploys to Vercel automatically on push to <Code>main</Code>. To deploy your own fork:</ProseP>
        <Steps>
          <Step title="Fork the repository" step={1}>Fork on GitHub, then import the fork in Vercel via <strong className="text-white">New Project → Import Git Repository</strong>.</Step>
          <Step title="Set environment variables" step={2}>Add all required env vars in Vercel&apos;s project settings. <Code>DATABASE_URL</Code> must be added manually — it is not in the repository.</Step>
          <Step title="Update OAuth callback" step={3}>Set the <strong className="text-white">Authorization callback URL</strong> in your GitHub OAuth App to <Code>https://your-vercel-url/api/auth/callback</Code>.</Step>
        </Steps>
        <Callout type="warning">
          <Code>DATABASE_URL</Code> must be added manually in Vercel&apos;s project settings → Environment Variables → Production.
        </Callout>
      </DocCard>

      <DocCard>
        <SubHeading>Reverse Proxy / Custom Domain</SubHeading>
        <ol className="space-y-2 text-sm text-slate-300 list-decimal list-inside">
          <li>Set <Code>NEXT_PUBLIC_APP_URL</Code> to your public URL (e.g. <Code>https://gitdash.example.com</Code>)</li>
          <li>Update the OAuth App callback URL to match</li>
          <li>Ensure your proxy forwards the <Code>x-forwarded-proto</Code> header — the app uses this for HTTPS redirects</li>
        </ol>
      </DocCard>
    </section>
  );
}

function Configuration() {
  return (
    <section id="configuration" className="scroll-mt-8 space-y-6">
      <SectionHeading id="configuration" icon={Settings2}>Configuration</SectionHeading>

      <DocCard>
        <SubHeading>Environment Variables</SubHeading>
        <DocTable
          headers={["Variable", "Required", "Description"]}
          rows={[
            [
              <Code key="v1">SESSION_SECRET</Code>,
              <span key="r1" className="text-red-400 font-medium text-xs">Required</span>,
              "Random string ≥ 32 characters. Encrypts session cookies with AES-256-GCM. App refuses to start in production if missing or too short.",
            ],
            [
              <Code key="v2">MODE</Code>,
              <span key="r2" className="text-slate-400 text-xs">Optional</span>,
              <>Default: <Code>standalone</Code>. Set to <Code>organization</Code> to enable org mode.</>,
            ],
            [
              <Code key="v3">GITHUB_CLIENT_ID</Code>,
              <span key="r3" className="text-amber-400 font-medium text-xs">Org mode only</span>,
              "GitHub OAuth App Client ID.",
            ],
            [
              <Code key="v4">GITHUB_CLIENT_SECRET</Code>,
              <span key="r4" className="text-amber-400 font-medium text-xs">Org mode only</span>,
              "GitHub OAuth App Client Secret. Never commit this value.",
            ],
            [
              <Code key="v5">DATABASE_URL</Code>,
              <span key="r5" className="text-amber-400 font-medium text-xs">Org mode only</span>,
              "PostgreSQL connection string (Neon or any Postgres). Required for alert rules, reports, and sync.",
            ],
            [
              <Code key="v6">NEXT_PUBLIC_APP_URL</Code>,
              <span key="r6" className="text-slate-400 text-xs">Optional</span>,
              "Public URL of the deployment. Used to build OAuth callback URLs and enforce HTTPS redirects.",
            ],
            [
              <Code key="v7">GITHUB_WEBHOOK_SECRET</Code>,
              <span key="r7" className="text-slate-400 text-xs">Optional</span>,
              <>Secret used to verify the HMAC signature on <Code>/api/webhooks/github</Code>. If unset, the webhook endpoint rejects all requests.</>,
            ],
            [
              <Code key="v8">GITHUB_TOKEN</Code>,
              <span key="r8" className="text-slate-400 text-xs">Optional</span>,
              <>Fallback GitHub token used server-side when no session token is available. <strong>Required</strong> for the scheduled sync cron (<Code>/api/cron/sync</Code>), which has no user session.</>,
            ],
            [
              <Code key="v8b">CRON_SECRET</Code>,
              <span key="r8b" className="text-slate-400 text-xs">Optional</span>,
              <>Bearer token that authorizes <Code>/api/cron/sync</Code>. Vercel Cron sends this automatically when the env var is set on the project; the route fails closed (401) if unset.</>,
            ],
            [
              <Code key="v9">NEXT_PUBLIC_DEMO_MODE</Code>,
              <span key="r9" className="text-slate-400 text-xs">Optional</span>,
              <>Set to <Code>true</Code> to serve sanitized demo data with no token. Demo mode can also be enabled per-request with <Code>?demo=1</Code>.</>,
            ],
            [
              <Code key="v10">RESEND_API_KEY</Code>,
              <span key="r10" className="text-slate-400 text-xs">Optional</span>,
              <>Enables Resend email delivery for alert rules (preferred provider). Pair with <Code>RESEND_FROM</Code> to set the sender address.</>,
            ],
            [
              <Code key="v11">SMTP_HOST</Code>,
              <span key="r11" className="text-slate-400 text-xs">Optional</span>,
              <>Generic SMTP email delivery for alerts when Resend is not used. With <Code>SMTP_USER</Code>, <Code>SMTP_PASS</Code>, <Code>SMTP_FROM</Code> (or <Code>SENDGRID_API_KEY</Code>).</>,
            ],
          ]}
        />
      </DocCard>

      <div className="grid md:grid-cols-2 gap-4">
        <DocCard>
          <SubHeading>Standalone <Code>.env.local</Code></SubHeading>
          <CodeBlock language="bash" filename=".env.local">
            {`MODE=standalone
SESSION_SECRET=replace_with_openssl_rand_hex_32
NEXT_PUBLIC_APP_URL=http://localhost:3000`}
          </CodeBlock>
        </DocCard>

        <DocCard>
          <SubHeading>Organization <Code>.env.local</Code></SubHeading>
          <CodeBlock language="bash" filename=".env.local">
            {`MODE=organization
GITHUB_CLIENT_ID=your_oauth_app_client_id
GITHUB_CLIENT_SECRET=your_oauth_app_client_secret
SESSION_SECRET=replace_with_openssl_rand_hex_32
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
NEXT_PUBLIC_APP_URL=https://gitdash.example.com`}
          </CodeBlock>
        </DocCard>
      </div>

      <DocCard>
        <SubHeading>Creating a GitHub OAuth App</SubHeading>
        <Steps>
          <Step title="Open OAuth App settings" step={1}>
            Navigate to <strong className="text-white">GitHub → Settings → Developer settings → OAuth Apps → New OAuth App</strong>.
          </Step>
          <Step title="Fill in the fields" step={2}>
            <DocTable
              headers={["Field", "Value"]}
              rows={[
                ["Application name", "GitDash"],
                ["Homepage URL", <Code key="h">https://your-domain.com</Code>],
                ["Authorization callback URL", <Code key="c">https://your-domain.com/api/auth/callback</Code>],
              ]}
            />
          </Step>
          <Step title="Copy credentials" step={3}>
            Click <strong className="text-white">Register application</strong>, copy the <strong className="text-white">Client ID</strong>, then click <strong className="text-white">Generate a new client secret</strong> — shown only once.
          </Step>
        </Steps>
      </DocCard>
    </section>
  );
}

function Modes() {
  return (
    <section id="modes" className="scroll-mt-8 space-y-6">
      <SectionHeading id="modes" icon={GitBranch}>Auth Modes</SectionHeading>

      <DocCard>
        <SubHeading>Standalone vs. Organization</SubHeading>
        <DocTable
          headers={["", "Standalone", "Organization"]}
          rows={[
            ["Auth method", "Personal Access Token (PAT)", "GitHub OAuth App"],
            ["Login page", <Code key="l1">/setup</Code>, <Code key="l2">/login</Code>],
            ["Best for", "Personal use, local dashboards", "Teams sharing one deployment"],
            ["OAuth App required", <span key="o1" className="text-emerald-400 text-xs font-medium">No</span>, <span key="o2" className="text-red-400 text-xs font-medium">Yes</span>],
            ["Database features", <span key="d1" className="text-slate-500 text-xs">Not available</span>, <span key="d2" className="text-emerald-400 text-xs">Available</span>],
            ["Alert rules", <span key="a1" className="text-slate-500 text-xs">Not available</span>, <span key="a2" className="text-emerald-400 text-xs">Available</span>],
            ["Multi-user", <span key="m1" className="text-slate-500 text-xs">No — single session</span>, <span key="m2" className="text-emerald-400 text-xs">Yes — isolated sessions per user</span>],
            ["Cost Analytics", "Own repos only", "All org repos (Enhanced Billing Plan required)"],
          ]}
        />
      </DocCard>

      <div className="grid md:grid-cols-2 gap-4">
        <DocCard>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium">standalone</span>
            <SubHeading>When to use Standalone</SubHeading>
          </div>
          <ul className="space-y-2 text-sm text-slate-300">
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
        </DocCard>

        <DocCard>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20 font-medium">organization</span>
            <SubHeading>When to use Organization</SubHeading>
          </div>
          <ul className="space-y-2 text-sm text-slate-300">
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
        </DocCard>
      </div>

      <DocCard>
        <SubHeading>Switching Modes</SubHeading>
        <ProseP>Change the <Code>MODE</Code> environment variable and restart the server. All session data is invalidated automatically — users will be redirected to the appropriate login page.</ProseP>
        <CodeBlock language="bash">
          {`# Switch to org mode
MODE=organization

# Switch back to standalone
MODE=standalone   # or unset MODE entirely`}
        </CodeBlock>
      </DocCard>
    </section>
  );
}

function Security() {
  return (
    <section id="security" className="scroll-mt-8 space-y-6">
      <SectionHeading id="security" icon={Shield}>Security Model</SectionHeading>

      <Callout type="success" title="Zero browser exposure">
        GitDash is designed so your PAT or OAuth token <strong>never touches the browser</strong>. All credentials live in an encrypted, HTTP-only session cookie on the server.
      </Callout>

      <DocCard>
        <SubHeading>Request Flow</SubHeading>
        <CodeBlock language="text">
          {`Browser ──── request ────► Middleware (decrypt session cookie)
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
                     (token never sent to browser)`}
        </CodeBlock>
      </DocCard>

      <DocCard>
        <SubHeading>Protection Layers</SubHeading>
        <DocTable
          headers={["Layer", "Mechanism"]}
          rows={[
            ["Encryption", "AES-256-GCM via iron-session v8 — industry-standard authenticated encryption"],
            ["Cookie flags", <><Code key="h">HttpOnly</Code> (no JS access), <Code key="s">Secure</Code> (HTTPS only), <Code key="ss">SameSite=Lax</Code> (CSRF protection)</>],
            ["Session secret", "32+ character minimum enforced at startup in production"],
            ["Rate limiting", <><Code key="rl">/api/auth/setup</Code>: 5 req/min/IP · <Code key="rl2">/api/auth/login</Code>: 10 req/min/IP</>],
            ["Input validation", <>All <Code key="ov">owner</Code>, <Code key="rv">repo</Code>, <Code key="orgv">org</Code> params validated against <Code key="pat">[a-zA-Z0-9_.-]{"{" + "1,100}"}</Code></>],
            ["HTTP headers", "CSP, HSTS, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy"],
            ["Docker", "Runs as non-root user nextjs (uid 1001). Built from node:20-alpine."],
          ]}
        />
      </DocCard>

      <DocCard>
        <SubHeading>Self-Audit Commands</SubHeading>
        <ProseP>Run these in the project root to verify security claims yourself:</ProseP>
        <CodeBlock language="bash" filename="terminal">
          {`# PAT never in browser storage
grep -r "localStorage|sessionStorage" src/ --include="*.tsx"
# Expected: 0 matches ✓

# PAT never returned in API responses
grep -rn "return.*pat|json.*pat" src/app/api --include="*.ts"
# Expected: 0 matches ✓

# XSS: dangerouslySetInnerHTML not used
grep -r "dangerouslySetInnerHTML" src/
# Expected: 0 matches ✓

# Check dependency vulnerabilities
npm audit --production
# Expected: 0 high/critical ✓`}
        </CodeBlock>
      </DocCard>
    </section>
  );
}

function CoreConcepts() {
  return (
    <section id="core-concepts" className="scroll-mt-8 space-y-6">
      <SectionHeading id="core-concepts" icon={Cpu}>Data Sources</SectionHeading>

      <DocCard>
        <SubHeading>Standalone Mode — Direct API</SubHeading>
        <ProseP>
          In standalone mode, every request proxies directly to the GitHub API using your encrypted PAT. No data is stored server-side — all data comes from GitHub in real-time.
        </ProseP>
        <CodeBlock language="text">
          {`Browser ──► /api/github/* ──► GitHub REST API (live)
                                        │
                               No DB storage
                               ~60 req/hr per PAT`}
        </CodeBlock>
        <Callout type="warning">
          GitHub API rate limits apply: 60 unauthenticated, 5,000 authenticated requests/hour. GitDash batches requests to stay within limits.
        </Callout>
      </DocCard>

      <DocCard>
        <SubHeading>Organization Mode — DB-Backed</SubHeading>
        <ProseP>
          In org mode with <Code>DATABASE_URL</Code>, workflow runs are synced to PostgreSQL every 15 minutes (or on-demand via webhook). The UI reads from the DB first, falling back to the GitHub API if data is stale.
        </ProseP>
        <CodeBlock language="text">
          {`Browser ──► /api/db/runs ──► PostgreSQL (fast, historical)
                   │
                   └── Stale? ──► GitHub API (fallback)

Webhook: POST /api/webhooks/github
  workflow_run events ──► Instant sync to DB`}
        </CodeBlock>
        <Callout type="success">
          DB-backed mode reduces GitHub API calls by ~95% and enables long-term historical analytics beyond GitHub&apos;s 90-day run retention.
        </Callout>
      </DocCard>

      <DocCard>
        <SubHeading>GitHub API Rate Limits</SubHeading>
        <DocTable
          headers={["Scenario", "Limit", "GitDash behavior"]}
          rows={[
            ["Standalone (PAT)", "5,000 req/hr", "Batches workflow fetches, caches per-tab"],
            ["Org mode (OAuth token)", "5,000 req/hr per user", "Each user has their own rate limit bucket"],
            ["Org mode + DB", "~250 req/hr (sync only)", "DB serves most requests; API only for sync"],
            ["Cost Analytics", "Enhanced Billing API", "Requires Team/Enterprise GitHub plan"],
          ]}
        />
      </DocCard>
    </section>
  );
}

// ── Feature page shared header ────────────────────────────────────────────────

// Small pill marking a feature (or an addition to an existing one) by the
// version it shipped in. Keep this next to any doc content added going
// forward — it's how "what's new" stays discoverable outside the changelog.
function VersionBadge({ v }: { v: string }) {
  return (
    <span className="text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25 uppercase">
      New in v{v}
    </span>
  );
}

function FeaturePageHeader({
  icon: Icon, name, path, chips, since,
}: {
  icon: React.ElementType; name: string; path: string; chips: string[]; since?: string;
}) {
  return (
    <div className="mb-8 pb-4 border-b border-slate-800">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-violet-400" />
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-bold text-white">{name}</h2>
            <Code>{path}</Code>
            {since && <VersionBadge v={since} />}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 pl-12">
        {chips.map((c) => (
          <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300 border border-slate-600/50">
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Screenshot slot ───────────────────────────────────────────────────────────
// Drop a PNG into /public/screenshots/<file> and it renders automatically.
// If the file is absent a placeholder shows the expected filename instead.
function ScreenshotSlot({ file, alt }: { file: string; alt: string }) {
  const [missing, setMissing] = useState(false);
  const src = `/screenshots/${file}`;
  if (missing) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-slate-600 bg-slate-800/40 flex flex-col items-center justify-center gap-2 py-8 text-center">
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18M3 21h18" />
          </svg>
        </div>
        <p className="text-xs text-slate-500">
          Add a screenshot at{" "}
          <code className="text-slate-400 bg-slate-700/60 px-1.5 py-0.5 rounded">
            public/screenshots/{file}
          </code>
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-lg overflow-hidden border border-slate-700/60 bg-slate-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="w-full object-cover object-top"
        onError={() => setMissing(true)}
      />
    </div>
  );
}

// ── Feature Overview index ────────────────────────────────────────────────────

function Features({ onNavigate }: { onNavigate: (id: string) => void }) {
  const pages: Array<{
    id: string; name: string; path: string; screenshot: string; desc: string;
    chips: string[]; since?: string;
  }> = [
    {
      id: "feat-repositories",
      name: "Repositories",
      path: "/",
      screenshot: "00-repos.png",
      desc: "Browse all personal and org repositories in one table. Fuzzy search with keyboard navigation (/ to focus, ↑↓ to navigate, Enter to open). Run history bars, 30-day trend sparkline, health badges, and org switcher in the sidebar.",
      chips: ["Fuzzy search", "Keyboard shortcuts", "Org switcher", "Health badges", "Run history"],
    },
    {
      id: "feat-repo-overview",
      name: "Repository Overview",
      path: "/repos/[owner]/[repo]",
      screenshot: "08-repo-overview.png",
      desc: "Industry-standard DORA KPI cards (Deploy Frequency, Lead Time, CFR, MTTR) computed with precision from real PR and release data. Expandable intelligent drill-down with four advanced charts: PR Cycle Time Breakdown (Identify bottlenecks), PR Size vs Velocity scatter (Scope discipline), PR Throughput, and Workflow Stability. Below that: Action Duration Trend and a searchable workflow table.",
      chips: ["DORA 4 Keys", "Cycle Time Breakdown", "Size/Velocity Scatter", "Throughput Trends", "Actionable Stability"],
    },
    {
      id: "feat-workflow",
      name: "Workflow Detail",
      path: "/repos/[owner]/[repo]/workflows/[workflow_id]",
      screenshot: "01-overview.png",
      desc: "5-tab deep-dive into a single workflow. Auto-refreshes every 30 seconds while runs are active. Includes CI-based DORA metrics, cost estimation per run, queue wait analysis, anomaly detection, and actionable optimization recommendations.",
      chips: ["Optimization Intelligence", "Cost estimation", "Queue analysis", "Anomaly detection"],
    },
    {
      id: "feat-audit",
      name: "Workflow Audit Trail",
      path: "/repos/[owner]/[repo]/audit",
      screenshot: "09-audit.png",
      desc: "Full commit history of every .github/workflows/*.yml file in the repo. Shows author, timestamp, commit message, and links to GitHub. Highlights changes made in the last 24 hours.",
      chips: ["Workflow file history", "Author + timestamp", "Recent-change highlight"],
    },
    {
      id: "feat-security",
      name: "Security Scan",
      path: "/repos/[owner]/[repo]/security",
      screenshot: "10-security.png",
      desc: "Static analysis of all workflow YAML files for common security anti-patterns: secret injection via env, pull_request_target misuse, unpin third-party actions, and more. Findings grouped by severity (critical, high, medium, low, info).",
      chips: ["Static analysis", "Severity grouping", "Per-file findings"],
    },
    {
      id: "feat-repo-team",
      name: "Repo Team Stats",
      path: "/repos/[owner]/[repo]/team",
      screenshot: "11-repo-team.png",
      desc: "Per-contributor delivery metrics for a repository: CI pass rate, avg run duration, run count. Reviewer load matrix (author × reviewer heatmap). Bus factor analysis showing which modules have fewer than 2 active contributors.",
      chips: ["CI leaderboard", "Reviewer matrix", "Bus factor"],
    },
    {
      id: "feat-team",
      name: "Team Insights",
      path: "/team",
      screenshot: "12-team-insights.png",
      desc: "Global team performance view — select any repository to see a sortable contributor leaderboard (PRs merged, reviews given, avg lead time, avg PR size, review response time, first-pass approval rate, self-merges, comments) and a reviewer load heatmap.",
      chips: ["Sortable leaderboard", "Reviewer load matrix", "Actionable comparisons"],
    },
    {
      id: "feat-contributor",
      name: "Contributor Profile",
      path: "/contributor/[login]",
      screenshot: "13-contributor.png",
      desc: "The ultimate \"Player card\" for any developer. Shows Elite KPI cards (PRs merged, avg lead time, reviews given, CI pass rate), 52-week activity heatmap, weekly commit bar chart, PR lifecycle funnel, commit hour distribution to monitor burnout, languages touched, a recent PRs table, and a period-over-period comparison that powers the 1:1 Prep Sheet.",
      chips: ["52-week heatmap", "Elite KPI cards", "Burnout monitoring", "Lifecycle funnel", "Period comparison"],
    },
    {
      id: "feat-cost",
      name: "Cost Analytics",
      path: "/cost-analytics",
      screenshot: "cost-analytics.png",
      desc: "GitHub Actions billing breakdown by SKU and runner type. Month-by-month navigation, burn rate progress bar with warning/critical thresholds, per-org and per-repo drill-down. Requires Enhanced Billing Platform (GitHub Team/Enterprise).",
      chips: ["Monthly navigation", "SKU breakdown", "Burn rate", "Org mode + Enhanced Billing"],
    },
    {
      id: "feat-reports",
      name: "Reports",
      path: "/reports",
      screenshot: "14-reports.png",
      desc: "DB-backed historical reporting. Daily area chart of pass/fail rates and quarterly summary table. Includes a manual sync trigger to pull the latest runs into the database.",
      chips: ["Daily trend", "Quarterly summary", "DB sync"],
    },
    {
      id: "feat-alerts",
      name: "Alerts",
      path: "/alerts",
      screenshot: "15-alerts.png",
      desc: "Define alert rules for CI metrics (failure rate, duration P95, queue wait P95, success streak) and people metrics (PR throughput drop, review response P90, after-hours commit %, PR abandon rate, unreviewed PR age). Rules fire events visible in-app; Slack and email delivery supported.",
      chips: ["CI alerts", "People alerts", "Browser / Slack / Email", "Rule history"],
    },
    {
      id: "feat-settings",
      name: "Settings",
      path: "/settings",
      screenshot: "16-settings.png",
      desc: "Manage your PAT in standalone mode or view your OAuth session details in org mode. Shows GitHub Actions billing widget with remaining free minutes for the current billing period.",
      chips: ["PAT management", "Session info", "Billing widget"],
    },
    {
      id: "feat-org",
      name: "Org Overview",
      path: "/org/[orgName]",
      screenshot: "17-org-overview.png",
      desc: "Organisation-level reliability heatmap and a sortable repository table with health scores, run history bars, and quick links to each repo's workflow dashboard.",
      chips: ["Org heatmap", "Repo table", "Health scores"],
    },
    {
      id: "feat-health-scorecard",
      name: "Team Health Scorecard",
      path: "/org/[orgName]/health",
      screenshot: "18-health-scorecard.png",
      desc: "Org-wide ranked view of every repo — Healthy / Watch / At Risk — combining a DORA tier score and bus-factor knowledge-concentration risk into one composite score, worst repo first, with a throughput trend indicator.",
      chips: ["Composite DORA + bus-factor score", "Worst-first ranking", "Throughput trend"],
      since: "4.0.0",
    },
    {
      id: "feat-workload-risk",
      name: "Workload Risk Radar",
      path: "/repos/[owner]/[repo]/team",
      screenshot: "19-workload-risk.png",
      desc: "Team-wide burnout and overload signals surfaced on the Repo Team Stats page: sustained after-hours or weekend work, contributors who've gone quiet, and people juggling too many concurrent open PRs. Framed as conversation-starters, not verdicts.",
      chips: ["After-hours / weekend detection", "Activity-cliff alerts", "Concurrent-PR overload"],
      since: "4.0.1",
    },
    {
      id: "feat-one-on-one",
      name: "1:1 Prep Sheet",
      path: "/contributor/[login]/brief",
      screenshot: "20-one-on-one.png",
      desc: "One-click manager brief for any contributor — reachable from the \"1:1 Prep Sheet\" button on their Contributor Profile. Period-over-period PR, review, and cycle-time comparison plus auto-generated talking points. Print-friendly, zero extra GitHub API calls.",
      chips: ["Period-over-period comparison", "Auto-generated talking points", "Print-friendly"],
      since: "4.0.2",
    },
    {
      id: "feat-leadership-digest",
      name: "Leadership Digest",
      path: "/alerts",
      screenshot: "21-leadership-digest.png",
      desc: "Narrative org-wide health summary emailed automatically every Monday. Configured as a special alert rule (metric = leadership_digest) on the Alerts page — pick an org and an email address, no threshold or window to tune. Reuses the Team Health Scorecard's computation.",
      chips: ["Weekly email", "Narrative summary", "No threshold to configure"],
      since: "4.0.3",
    },
    {
      id: "feat-ai-insights",
      name: "AI Insights",
      path: "/repos/[owner]/[repo] · /org/[orgName]/health",
      screenshot: "22-ai-insights.png",
      desc: "Plain-English synthesis of the metrics already on the page: what changed, why it matters, and what to do about it. Optional — the card only appears when AI provider keys are configured on the server. Metrics and names are sent to the provider; never code, logs, or commit messages.",
      chips: ["Gemini + Qwen fallback", "Server-side keys only", "Metrics-only prompts", "Hidden when unconfigured"],
      since: "4.1.0",
    },
  ];

  return (
    <section id="features" className="scroll-mt-8 space-y-6">
      <SectionHeading id="features" icon={Layers}>Feature Overview</SectionHeading>

      <ProseP>
        GitDash has {pages.length} pages. Click any card to open the full feature page with
        screenshots, detailed descriptions, and reference tables.
      </ProseP>

      <div className="grid gap-3">
        {pages.map((p) => (
          <button
            key={p.id}
            onClick={() => onNavigate(p.id)}
            className="group w-full text-left rounded-xl border border-slate-800 bg-slate-900/40 p-4 hover:border-violet-500/40 hover:bg-slate-800/60 transition-all"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-white group-hover:text-violet-300 transition-colors">
                    {p.name}
                  </span>
                  <Code>{p.path}</Code>
                  {p.since && <VersionBadge v={p.since} />}
                </div>
                <p className="text-xs text-slate-500 line-clamp-2">{p.desc}</p>
                <div className="flex flex-wrap gap-1">
                  {p.chips.slice(0, 3).map((c) => (
                    <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400 border border-slate-600/50">
                      {c}
                    </span>
                  ))}
                  {p.chips.length > 3 && (
                    <span className="text-xs px-2 py-0.5 text-slate-600">+{p.chips.length - 3} more</span>
                  )}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-violet-400 shrink-0 mt-0.5 transition-colors" />
            </div>
          </button>
        ))}
      </div>

      <DocCard>
        <SubHeading>Workflow Detail Tabs</SubHeading>
        <DocTable
          headers={["Tab", "What you see"]}
          rows={[
            ["Overview", "Rolling success rate, duration trend, outcome pie chart, run frequency heatmap, DORA 4 Keys (CI-based)"],
            ["Performance", "Per-job avg/p50/p95 bar chart, stacked job waterfall per run, slowest steps table, cost estimate per run"],
            ["Reliability", "MTTR, failure streaks, flaky branch detection, re-run rate, anomaly detection, pass/fail timeline"],
            ["Triggers", "Event breakdown, top branches, hour-of-day heatmap, day-of-week chart, actor leaderboard"],
            ["Runs", "Sortable/filterable run table with commit message, PR link, attempt count, queue wait, CSV export"],
          ]}
        />
      </DocCard>

      <DocCard>
        <SubHeading>DORA Metrics — Two Contexts</SubHeading>
        <DocTable
          headers={["Context", "Data source", "Location"]}
          rows={[
            ["Repository level", "Merged PRs + GitHub Releases — true delivery pipeline metrics", "/repos/[owner]/[repo] — DORA KPI cards + drill-down"],
            ["Workflow level", "CI workflow run outcomes — proxy metrics for the build pipeline", "/repos/[owner]/[repo]/workflows/[workflow_id] — Overview tab"],
          ]}
        />
      </DocCard>
    </section>
  );
}

// ── Individual Feature Pages ──────────────────────────────────────────────────

function FeatureRepositories() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={List} name="Repositories" path="/"
        chips={["Fuzzy search", "Keyboard shortcuts", "Org switcher", "Health badges", "Run history"]}
      />
      <ProseP>
        The main dashboard lists every personal and org repository in a searchable, keyboard-navigable table.
        Each row shows the latest workflow status, a 10-run history bar, a 30-day trend sparkline, and a
        health badge. Switch between personal repos and any GitHub org from the sidebar.
      </ProseP>
      <ScreenshotSlot file="00-repos.png" alt="Repositories dashboard" />
      <DocCard>
        <SubHeading>Keyboard Shortcuts</SubHeading>
        <DocTable
          headers={["Key", "Action"]}
          rows={[
            ["/", "Focus the search box"],
            ["↑ / ↓", "Move selection up / down"],
            ["Enter", "Open the selected repository"],
            ["Escape", "Clear search or close modal"],
            ["?", "Show shortcuts reference modal"],
          ]}
        />
      </DocCard>
    </section>
  );
}

function FeatureRepoOverview() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={BarChart3} name="Repository Overview" path="/repos/[owner]/[repo]"
        chips={["DORA 4 Keys", "PR Cycle Breakdown", "Scatter plot", "Throughput chart", "Stability chart"]}
      />
      <ProseP>
        The repository overview page is the health scorecard for a single codebase. At the top, four
        DORA KPI cards are computed from real merged PRs and GitHub Releases — no extra config needed.
        Expand the drill-down section to see four charts that explain <em>why</em> the numbers look the
        way they do. Below that, an Action Duration Trend and a searchable workflow table.
      </ProseP>
      <ScreenshotSlot file="08-repo-overview.png" alt="Repository Overview — DORA KPI cards" />
      <DocCard>
        <SubHeading>DORA KPI Cards</SubHeading>
        <DocTable
          headers={["Metric", "Data source", "DORA levels"]}
          rows={[
            ["Deploy Frequency", "GitHub Releases → fallback: merged PRs to main", "Elite ≥ 1/day · High ≥ 1/week"],
            ["Lead Time for Changes", "First commit on PR → PR merged timestamp", "Elite < 1h · High < 1d"],
            ["Change Failure Rate", "Hotfix/revert PRs ÷ total merged PRs", "Elite < 5% · High < 10%"],
            ["Time to Restore (MTTR)", "Hotfix/revert PR open → merged duration", "Elite < 1h · High < 1d"],
          ]}
        />
      </DocCard>
      <DocCard>
        <SubHeading>Drill-Down Charts</SubHeading>
        <DocTable
          headers={["Chart", "What it shows"]}
          rows={[
            ["PR Cycle Time Breakdown", "Proportional segmented bar: Time to Open → Pickup → Review → Merge"],
            ["PR Size vs Velocity", "Scatter plot — lines changed (X) vs hours to merge (Y) with regression line"],
            ["PR Throughput", "12-week bar chart of merged PRs per week"],
            ["Workflow Stability", "30-day pass rate line chart with Elite (95%) and High (80%) reference lines"],
          ]}
        />
      </DocCard>
    </section>
  );
}

function FeatureWorkflowDetail() {
  const tabs = [
    {
      name: "Overview",
      desc: "Rolling 30-day success rate, outcome pie chart, run frequency heatmap, DORA 4 Keys (CI-based), and Action Duration Trend.",
      screenshots: ["01-overview.png", "02-overview-stats.png"],
    },
    {
      name: "Performance",
      desc: "Per-job avg/p50/p95 bar chart, stacked job waterfall per run, slowest steps table, cost estimate per run, and queue wait analysis.",
      screenshots: ["03-performance-jobs.png", "04-performance-steps.png"],
    },
    {
      name: "Reliability",
      desc: "MTTR, failure streaks, flaky branch detection, re-run rate, anomaly detection with severity badges, and a pass/fail timeline.",
      screenshots: ["05-reliability.png"],
    },
    {
      name: "Triggers",
      desc: "Event breakdown (push/PR/schedule/manual), top branches, hour-of-day heatmap, day-of-week chart, and actor leaderboard.",
      screenshots: ["06-triggers.png"],
    },
    {
      name: "Runs",
      desc: "Sortable and filterable run table with commit message, PR link, attempt count, queue wait, CSV export, and re-run button.",
      screenshots: ["07-runs.png"],
    },
  ];
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={Activity} name="Workflow Detail" path="/repos/[owner]/[repo]/workflows/[workflow_id]"
        chips={["5 tabs", "DORA metrics", "Cost estimate", "Queue analysis", "Anomaly detection", "Optimization tips", "Auto-refresh"]}
      />
      <ProseP>
        The deepest view in GitDash. Pick any workflow from the repository overview and explore five
        analytical tabs. The page auto-refreshes every 30 seconds while runs are active, and shows
        CI-based DORA metrics alongside cost, queue, anomaly, and optimization insights.
      </ProseP>
      <div className="space-y-6">
        {tabs.map((tab) => (
          <DocCard key={tab.name}>
            <SubHeading>{tab.name}</SubHeading>
            <ProseP>{tab.desc}</ProseP>
            <div className={tab.screenshots.length > 1 ? "grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4" : ""}>
              {tab.screenshots.map((file) => (
                <ScreenshotSlot key={file} file={file} alt={`${tab.name} tab`} />
              ))}
            </div>
          </DocCard>
        ))}
      </div>
    </section>
  );
}

function FeatureAudit() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={FileText} name="Workflow Audit Trail" path="/repos/[owner]/[repo]/audit"
        chips={["Workflow file history", "Author + timestamp", "Recent-change highlight"]}
      />
      <ProseP>
        Shows the full commit history of every <Code>.github/workflows/*.yml</Code> file in a
        repository — sorted newest first. Each entry links to the commit on GitHub. Changes made
        within the last 24 hours are highlighted so you can quickly see what was recently modified.
      </ProseP>
      <ScreenshotSlot file="09-audit.png" alt="Workflow Audit Trail" />
    </section>
  );
}

function FeatureSecurity() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={ShieldAlert} name="Security Scan" path="/repos/[owner]/[repo]/security"
        chips={["Static analysis", "Severity grouping", "Per-file findings"]}
      />
      <ProseP>
        Runs static analysis on all workflow YAML files in the repository, checking for common
        security anti-patterns without executing any code. Findings are grouped by severity and
        collapsed per file for easy triage.
      </ProseP>
      <ScreenshotSlot file="10-security.png" alt="Security Scan results" />
      <DocCard>
        <SubHeading>Checks performed</SubHeading>
        <DocTable
          headers={["Check", "Severity"]}
          rows={[
            ["Secrets injected via env: on untrusted input (pull_request_target)", "Critical"],
            ["pull_request_target with checkout of PR head", "High"],
            ["Third-party actions not pinned to a commit SHA", "Medium"],
            ["Secrets referenced in run: steps (risk of log exposure)", "Medium"],
            ["Deprecated runner OS versions", "Low"],
            ["Missing permissions: block at workflow or job level", "Info"],
          ]}
        />
      </DocCard>
    </section>
  );
}

function FeatureRepoTeam() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={Trophy} name="Repo Team Stats" path="/repos/[owner]/[repo]/team"
        chips={["CI leaderboard", "Reviewer matrix", "Bus factor"]}
      />
      <ProseP>
        Three panels that answer &ldquo;who is doing what?&rdquo; inside a single repository. The CI leaderboard
        shows per-actor build stats. The reviewer load matrix reveals review distribution. The bus
        factor heatmap flags knowledge concentration risks.
      </ProseP>
      <ScreenshotSlot file="11-repo-team.png" alt="Repo Team Stats" />
      <DocCard>
        <SubHeading>Panels</SubHeading>
        <DocTable
          headers={["Panel", "Description"]}
          rows={[
            ["CI Leaderboard", "Per-contributor run count, success rate, avg duration over the last 90 days"],
            ["Reviewer Load Matrix", "Author × reviewer heatmap — who reviews whose PRs"],
            ["Bus Factor Heatmap", "Per-module contributor count and Herfindahl index — flags modules with <2 active contributors"],
          ]}
        />
      </DocCard>
    </section>
  );
}

function FeatureTeamInsights() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={Users} name="Team Insights" path="/team"
        chips={["Sortable leaderboard", "Reviewer load matrix", "Repo picker"]}
      />
      <ProseP>
        A global team performance view — not scoped to a single workflow. Pick any repository from the
        dropdown and see a contributor leaderboard with eight delivery metrics alongside a reviewer load
        heatmap.
      </ProseP>
      <ScreenshotSlot file="12-team-insights.png" alt="Team Insights page" />
      <DocCard>
        <SubHeading>Leaderboard columns</SubHeading>
        <DocTable
          headers={["Column", "Meaning"]}
          rows={[
            ["PRs Merged", "Total PRs merged to default branch in the last 90 days"],
            ["Reviews Given", "Number of PR reviews submitted"],
            ["Avg Lead Time", "Average time from first commit to PR merge"],
            ["Avg PR Size", "Average lines changed per merged PR"],
            ["Review Response", "Median time from PR open to first review comment"],
            ["First-Pass Approval", "% of PRs approved on the first review round"],
            ["Self-Merges", "PRs merged by the author without external approval"],
            ["Comments", "Total review comments left"],
          ]}
        />
      </DocCard>
    </section>
  );
}

function FeatureContributor() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={User} name="Contributor Profile" path="/contributor/[login]"
        chips={["KPI cards", "52-week heatmap", "PR funnel", "Commit hours", "Languages"]}
      />
      <ProseP>
        A full &ldquo;player card&rdquo; for any GitHub user. Navigate here by clicking a contributor name in the
        Team Insights leaderboard or Team Stats page. The profile aggregates data from the PR, review,
        and commit APIs for the selected repository context.
      </ProseP>
      <ScreenshotSlot file="13-contributor.png" alt="Contributor Profile" />
      <DocCard>
        <SubHeading>Sections</SubHeading>
        <DocTable
          headers={["Section", "What it shows"]}
          rows={[
            ["KPI Cards", "PRs merged, avg lead time, reviews given, CI pass rate"],
            ["Activity Heatmap", "52-week contribution calendar (GitHub-style)"],
            ["Weekly Commits", "12-week bar chart of commits per week"],
            ["PR Lifecycle Funnel", "Opened → reviewed → approved → merged counts"],
            ["Commit Hours", "Hour-of-day distribution — burnout risk indicator"],
            ["Languages", "Top languages touched by file extensions in commits"],
            ["Recent PRs", "Last 20 PRs with status, size, and lead time"],
          ]}
        />
      </DocCard>
      <DocCard>
        <div className="flex items-center gap-2 mb-2">
          <SubHeading>1:1 Prep Sheet</SubHeading>
          <VersionBadge v="4.0.2" />
        </div>
        <ProseP>
          Every profile now includes a <strong>period_comparison</strong> field — the same 90-day window
          split into two 45-day halves, so you can see whether a contributor&apos;s output is trending up
          or down. Click the <strong>1:1 Prep Sheet</strong> button at the top of the profile to turn that
          comparison into a manager brief with auto-generated talking points (see{" "}
          <Code>1:1 Prep Sheet</Code> in the sidebar).
        </ProseP>
      </DocCard>
    </section>
  );
}

function FeatureCost() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={DollarSign} name="Cost Analytics" path="/cost-analytics"
        chips={["Monthly navigation", "SKU breakdown", "Burn rate", "Org mode + Enhanced Billing"]}
      />
      <Callout type="warning">
        Requires org mode and the <strong>GitHub Enhanced Billing Platform</strong> (available on
        GitHub Team and Enterprise). The billing API is not available for personal accounts or on
        the legacy billing plan.
      </Callout>
      <ProseP>
        Browse GitHub Actions spend month by month. A burn rate progress bar shows how much of the
        monthly budget has been consumed. The SKU breakdown table shows cost per runner type
        (ubuntu-latest, macos-latest, windows-latest, etc.) and per repository.
      </ProseP>
      <ScreenshotSlot file="cost-analytics.png" alt="Cost Analytics page" />
    </section>
  );
}

function FeatureReports() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={TrendingUp} name="Reports" path="/reports"
        chips={["Daily trend", "Quarterly summary", "DB sync"]}
      />
      <ProseP>
        DB-backed historical reporting using the Neon PostgreSQL database. The daily area
        chart shows pass/fail run counts over time. The quarterly breakdown table aggregates by quarter.
        A manual sync button pulls the latest runs from GitHub into the database on demand.
      </ProseP>
      <ScreenshotSlot file="14-reports.png" alt="Reports page" />
    </section>
  );
}

function FeatureAlerts() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={Bell} name="Alerts" path="/alerts"
        chips={["CI alerts", "People alerts", "Browser / Slack / Email", "Rule history"]}
      />
      <ProseP>
        Define threshold-based alert rules that fire when a metric exceeds or drops below a value.
        Rules are evaluated after every database sync. Fired alerts appear in the event log and can
        be delivered via browser notification, Slack webhook, or email.
      </ProseP>
      <ScreenshotSlot file="15-alerts.png" alt="Alerts page" />
      <DocCard>
        <SubHeading>CI Metrics</SubHeading>
        <DocTable
          headers={["Metric", "Threshold unit", "Description"]}
          rows={[
            ["Failure Rate", "%", "Alert when failure rate exceeds threshold in the time window"],
            ["Duration P95", "minutes", "Alert when the 95th-percentile run duration exceeds threshold"],
            ["Queue Wait P95", "minutes", "Alert when P95 queue wait time exceeds threshold"],
            ["Success Streak", "runs", "Alert when consecutive failures exceed threshold"],
          ]}
        />
      </DocCard>
      <DocCard>
        <SubHeading>People Metrics</SubHeading>
        <DocTable
          headers={["Metric", "Threshold unit", "Description"]}
          rows={[
            ["PR Throughput Drop", "%", "Alert when merged PRs drop >N% week-over-week"],
            ["Review Response P90", "hours", "Alert when P90 time-to-first-review exceeds N hours"],
            ["After-Hours Commits", "%", "Alert when after-hours commit % exceeds threshold (burnout risk)"],
            ["PR Abandon Rate", "%", "Alert when closed-without-merge PRs exceed N% of opened"],
            ["Unreviewed PR Age", "days", "Alert when any open PR has no review after N business days"],
          ]}
        />
      </DocCard>
      <DocCard>
        <div className="flex items-center gap-2 mb-2">
          <SubHeading>Leadership Digest</SubHeading>
          <VersionBadge v="4.0.3" />
        </div>
        <ProseP>
          A fifth rule type, distinct from the threshold-based metrics above. Pick{" "}
          <Code>metric = leadership_digest</Code> when creating a rule: the form switches to just an
          org name and an email address — no threshold or window, because it isn&apos;t event-triggered.
          Instead it sends a narrative org-wide health summary (reusing the Team Health Scorecard&apos;s
          computation) automatically every Monday. See{" "}
          <Code>Leadership Digest</Code> in the sidebar for details.
        </ProseP>
      </DocCard>
    </section>
  );
}

function FeatureSettings() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={Sliders} name="Settings" path="/settings"
        chips={["PAT management", "Session info", "Billing widget"]}
      />
      <ProseP>
        In <strong>standalone mode</strong> — update or revoke your GitHub Personal Access Token.
        In <strong>org mode</strong> — view your OAuth session details (scopes, user, expiry).
        Both modes show a GitHub Actions billing widget with remaining free minutes for the current
        billing period.
      </ProseP>
      <ScreenshotSlot file="16-settings.png" alt="Settings page" />
    </section>
  );
}

function FeatureOrg() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={Building2} name="Org Overview" path="/org/[orgName]"
        chips={["Org heatmap", "Repo table", "Health scores"]}
      />
      <ProseP>
        A bird&apos;s-eye view of an entire GitHub organization. The reliability heatmap shows which
        repositories are red or green at a glance. The sortable repo table includes health scores,
        run history bars, open PR counts, and quick links to each repo&apos;s workflow dashboard.
      </ProseP>
      <ScreenshotSlot file="17-org-overview.png" alt="Org Overview page" />
    </section>
  );
}

function FeatureHealthScorecard() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={HeartPulse} name="Team Health Scorecard" path="/org/[orgName]/health"
        chips={["Composite DORA + bus-factor score", "Worst-first ranking", "Throughput trend"]}
        since="4.0.0"
      />
      <ProseP>
        An org-wide, ranked view built for a leader who owns many repos and needs to know which ones
        need attention first. Every repo in the org gets one composite score combining delivery
        performance and knowledge-concentration risk, sorted worst-first.
      </ProseP>
      <ScreenshotSlot file="18-health-scorecard.png" alt="Team Health Scorecard page" />
      <DocCard>
        <SubHeading>How the score is computed</SubHeading>
        <ProseP>
          <Code>score = round(doraScore × 0.6 + busFactorScore × 0.4)</Code> — delivery performance
          (DORA tier) is weighted higher than knowledge concentration, but a repo with only one active
          contributor still drags the composite down meaningfully.
        </ProseP>
        <DocTable
          headers={["Band", "Score", "Meaning"]}
          rows={[
            ["Healthy", "≥ 80", "Strong delivery metrics and no single-owner risk"],
            ["Watch", "50 – 79", "One dimension is slipping — worth a look, not urgent"],
            ["At Risk", "< 50", "Delivery or bus-factor problems compounding — prioritize"],
          ]}
        />
      </DocCard>
      <DocCard>
        <SubHeading>Trend indicator</SubHeading>
        <ProseP>
          Compares the recent half of the repo&apos;s weekly throughput history against the prior half
          to show whether each repo is trending up, flat, or down — so a currently-healthy repo that&apos;s
          sliding still gets flagged.
        </ProseP>
      </DocCard>
    </section>
  );
}

function FeatureWorkloadRisk() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={AlertTriangle} name="Workload Risk Radar" path="/repos/[owner]/[repo]/team"
        chips={["After-hours / weekend detection", "Activity-cliff alerts", "Concurrent-PR overload"]}
        since="4.0.1"
      />
      <ProseP>
        A people-risk radar embedded in the Repo Team Stats page (Team Analytics section). It surfaces
        burnout and overload signals as conversation-starters for a 1:1 — not as a performance verdict.
      </ProseP>
      <ScreenshotSlot file="19-workload-risk.png" alt="Workload Risk Radar" />
      <DocCard>
        <SubHeading>Signals</SubHeading>
        <DocTable
          headers={["Signal", "Trigger", "Why it matters"]}
          rows={[
            ["After-hours work", "> 30% of commits outside working hours", "Sustained after-hours activity is a leading burnout indicator"],
            ["Weekend work", "> 25% of commits on Sat/Sun", "Same signal, weekend axis"],
            ["Activity cliff", "Contributor went quiet in the last 14 days vs. their 42-day baseline", "Could be planned time off — or disengagement worth checking in on"],
            ["Concurrent-PR overload", "> 4 open PRs at once", "Context-switching load that slows everyone down, not just the author"],
          ]}
        />
        <ProseP>
          A contributor needs at least a minimum sample of recent activity before any signal fires —
          this avoids false positives for people who are simply new or between projects.
        </ProseP>
      </DocCard>
    </section>
  );
}

function FeatureOneOnOne() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={MessageCircle} name="1:1 Prep Sheet" path="/contributor/[login]/brief"
        chips={["Period-over-period comparison", "Auto-generated talking points", "Print-friendly"]}
        since="4.0.2"
      />
      <ProseP>
        A one-click manager brief for any contributor. Open their Contributor Profile and click the{" "}
        <strong>1:1 Prep Sheet</strong> button in the top-right corner of the header — or go directly
        to <Code>/contributor/[login]/brief?owner=[owner]</Code>.
      </ProseP>
      <ScreenshotSlot file="20-one-on-one.png" alt="1:1 Prep Sheet page" />
      <DocCard>
        <SubHeading>What&apos;s on it</SubHeading>
        <DocTable
          headers={["Section", "What it shows"]}
          rows={[
            ["Period comparison", "PRs merged, reviews given, and avg cycle time — most-recent 45 days vs. the prior 45"],
            ["Talking points", "Rules-engine-generated conversation prompts (not verdicts) based on the comparison and workload signals"],
          ]}
        />
        <ProseP>
          The brief reuses the same SWR cache key as the full contributor profile, so opening it
          right after viewing a profile costs <strong>zero</strong> extra GitHub API calls. It&apos;s
          also print-friendly for bringing a paper copy into the room.
        </ProseP>
      </DocCard>
    </section>
  );
}

function FeatureLeadershipDigest() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={Mail} name="Leadership Digest" path="/alerts"
        chips={["Weekly email", "Narrative summary", "No threshold to configure"]}
        since="4.0.3"
      />
      <ProseP>
        A narrative, org-wide health summary delivered by email every Monday — for a leader who wants
        the Team Health Scorecard&apos;s findings pushed to their inbox instead of having to check the
        dashboard.
      </ProseP>
      <ScreenshotSlot file="21-leadership-digest.png" alt="Leadership Digest setup" />
      <DocCard>
        <SubHeading>Setting it up</SubHeading>
        <Steps>
          <Step title="Open Alerts">Go to the Alerts page and click New Rule.</Step>
          <Step title="Pick the metric">Select <Code>leadership_digest</Code> — the form collapses to just two fields: org name and delivery email. Threshold and window are ignored (there&apos;s no cadence to configure; it always sends Monday).</Step>
          <Step title="Save">The rule shows &ldquo;Sent every Monday&rdquo; in place of a threshold on the Alerts list.</Step>
        </Steps>
      </DocCard>
      <Callout type="info">
        Implementation note: this reuses the existing <Code>alert_rules</Code> table as a config store
        rather than adding a new table, and reuses the Team Health Scorecard&apos;s computation rather than
        recomputing anything. It&apos;s explicitly excluded from the normal per-repo threshold evaluation
        that runs on every sync — the daily cron just checks whether today is Monday.
      </Callout>
      <Callout type="warning">
        Delivery requires an email provider to be configured in the deployment
        (<Code>RESEND_API_KEY</Code> or SMTP settings) — see Configuration.
      </Callout>
    </section>
  );
}

function FeatureAiInsights() {
  return (
    <section className="space-y-6">
      <FeaturePageHeader
        icon={Sparkles} name="AI Insights" path="/repos/[owner]/[repo] · /org/[orgName]/health"
        chips={["Gemini + Qwen fallback", "Server-side keys only", "Metrics-only prompts", "Hidden when unconfigured"]}
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

      <Callout type="info">
        <strong>Entirely opt-in.</strong> With no AI provider key configured on the server, every AI
        surface is hidden and GitDash behaves exactly as it did before v4.1.0. There is no
        placeholder and no prompt to enable anything.
      </Callout>

      <ScreenshotSlot file="22-ai-insights.png" alt="AI Insights card" />

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

// ─────────────────────────────────────────────────────────────────────────────
// ── Metrics Reference ─────────────────────────────────────────────────────────

function MetricsReference({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const PAGES = [
    { id: "metrics-dora",        icon: Rocket,     label: "DORA 4 Keys",         desc: "Deploy Frequency, Lead Time, Change Failure Rate, MTTR — the industry standard delivery benchmarks." },
    { id: "metrics-pr-cycle",    icon: GitBranch,  label: "PR Cycle Time",        desc: "The four phases of a PR's life: Time to Open, Pickup Time, Review Time, and Merge Time." },
    { id: "metrics-pr-health",   icon: Activity,   label: "PR Lifecycle Health",  desc: "Open PRs, Review P50/P90, Abandon Rate, Age Distribution, and concurrent WIP per author." },
    { id: "metrics-workflow",    icon: BarChart3,  label: "Workflow Overview",    desc: "Rolling Success Rate, Duration Trend, Outcome Breakdown, Run Frequency, and Optimization Tips." },
    { id: "metrics-performance", icon: TrendingUp, label: "Performance Tab",      desc: "Job Duration avg vs p95, Job Composition per Run, and Slowest Steps rankings." },
    { id: "metrics-reliability", icon: Shield,     label: "Reliability Tab",      desc: "MTTR, Failure Streak, Flaky Branches, Re-run Rate, Pass/Fail Timeline, and Anomaly Detection." },
    { id: "metrics-team",        icon: Users,      label: "Team & People",        desc: "Leaderboard columns, Reviewer Load Matrix, and Bus Factor (HHI) explained." },
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

function MetricsDora() {
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
            ["Deploy Frequency", "How often the team ships to production", "Count of GitHub Releases in the last 30 days, divided by 30. Falls back to merged PRs to main when no releases exist.", "Elite: >1/day · High: >1/week · Medium: >1/month · Low: <1/month"],
            ["Lead Time for Changes", "Time from writing code to it being in production", "Median time from the oldest commit on a PR to that PR being merged. Computed over the last 60 merged PRs.", "Elite: <1h · High: <1d · Medium: <1wk · Low: ≥1wk"],
            ["Change Failure Rate", "How often a deployment causes a production failure", "PRs whose branch name contains 'hotfix', 'revert', or 'fix' as a percentage of all merged PRs in the last 90 days.", "Elite: <5% · High: <10% · Medium: <15% · Low: ≥15%"],
            ["Time to Restore (MTTR)", "How quickly the team recovers from a production failure", "Average cycle time (open → merged) of hotfix/revert PRs identified in the Change Failure Rate calculation.", "Elite: <1h · High: <1d · Medium: <1wk · Low: ≥1wk"],
          ]}
        />
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

function MetricsPrCycle() {
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

function MetricsPrHealth() {
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
            ["Review Round Distribution", "How many review cycles (request → response) merged PRs went through. 0 rounds = merged without review. 3+ rounds = heavy back-and-forth.", "1–2 rounds is healthy. >3 rounds may indicate unclear specs or large PRs."],
            ["Stale & Unreviewed PRs", "Open PRs older than 5 business days that have received no review activity. These directly inflate Review P90 and Pickup Time.", "0 stale PRs is the target."],
          ]}
        />
      </DocCard>
    </section>
  );
}

function MetricsWorkflow() {
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

function MetricsPerformance() {
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

function MetricsReliability() {
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

function MetricsTeam() {
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
            ["After-Hours Commits %", "Percentage of commits made outside 09:00–18:00 UTC. Visible in the commit hour distribution chart on the contributor profile.", "A proxy for burnout risk. A sustained high rate warrants a conversation about workload."],
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
          severely impact the project. GitDash approximates it per file-path prefix using the
          Herfindahl–Hirschman Index (HHI) on commit authorship.
        </ProseP>
        <DocTable
          headers={["Term", "Definition"]}
          rows={[
            ["HHI (Herfindahl Index)", "Sum of squared contribution shares for a module. HHI = 1 means one person owns 100% of commits. HHI = 0.25 means four equal contributors — safer."],
            ["Active contributors", "Authors with at least one commit to that module in the last 90 days."],
            ["Risk threshold", "Modules with fewer than 2 active contributors are flagged. Loss of the single contributor would leave the module unmaintained."],
          ]}
        />
      </DocCard>
    </section>
  );
}

function MetricsCiAlerts() {
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
            ["Deploy Frequency", "Successful runs on the default branch per day over the last 30 days.", "Repo-level uses Releases or merged PRs. CI-based counts every successful workflow run — useful for workflows that deploy on every merge."],
            ["Lead Time", "Average time from the triggering commit timestamp to the run completing successfully.", "Repo-level measures first commit → PR merged. CI-based measures commit → CI green — does not include PR review time."],
            ["Change Failure Rate", "Percentage of default-branch runs that failed (not cancelled/skipped).", "Repo-level uses hotfix/revert PR heuristics. CI-based is a direct CI failure rate — more precise but only reflects build failures, not production incidents."],
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
            ["After-Hours Commits %", "People", "% of commits outside 09:00–18:00 UTC exceeds threshold"],
            ["PR Abandon Rate", "People", "% of PRs closed without merge exceeds threshold"],
            ["Unreviewed PR Age", "People", "Any open PR has been waiting for a first review for more than N business days"],
          ]}
        />
      </DocCard>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function APIReference() {
  return (
    <section id="api-reference" className="scroll-mt-8 space-y-6">
      <SectionHeading id="api-reference" icon={Code2} badge="REST">API Reference</SectionHeading>

      <Callout type="info">
        Most API routes require an authenticated session — unauthenticated requests receive a <Code>401 Unauthorized</Code> response. The exceptions are the public endpoints <Code>/api/health</Code> (liveness/readiness probes), <Code>/api/demo</Code> (sanitized fixture data for demo mode), <Code>/api/webhooks/github</Code> (authenticated by HMAC signature, not a session cookie), and <Code>/api/cron/sync</Code> (authenticated by <Code>CRON_SECRET</Code> bearer token).
      </Callout>

      {[
        {
          method: "GET",
          path: "/api/github/repos",
          description: "List all repositories accessible to the authenticated user (personal + org).",
          params: [
            { name: "org", type: "string", optional: true, desc: "Filter to a specific org slug." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/repo-overview",
          description: "Per-workflow summaries for a repository — status, health, run history, trend, duration points.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/repo-dora",
          description: "Repository-level DORA 4 Keys computed from merged PRs and releases. Includes cycle breakdown, PR scatter, and throughput by week.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/repo-contributors",
          description: "Per-contributor delivery stats for a repository: PRs merged, reviews given, avg lead time, avg PR size, review turnaround, first-pass approval rate, self-merges. Also returns reviewer load matrix and bus factor.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/contributor-profile",
          description: "Full contributor profile: KPI cards, 52-week activity calendar, weekly commits, PR funnel, commit hour distribution, languages, recent PRs, and a period_comparison field (recent vs. prior 45 days) that powers the 1:1 Prep Sheet.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Org or user context for PR search." },
            { name: "login", type: "string", optional: false, desc: "GitHub username." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/workflows",
          description: "List all GitHub Actions workflows for a repository.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/runs",
          description: "Fetch workflow runs for a specific workflow (last 50 by default).",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
            { name: "workflow_id", type: "number", optional: false, desc: "Workflow ID." },
            { name: "per_page", type: "number", optional: true, desc: "Results per page (default 50, max 100)." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/job-stats",
          description: "Per-job and per-step timing stats for a workflow: avg, p50, p95, max durations, success/failure counts, waterfall data.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
            { name: "workflow_id", type: "number", optional: false, desc: "Workflow ID." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/team-stats",
          description: "CI-level team stats: per-actor run count, success rate, avg duration, activity by day/hour.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
            { name: "per_page", type: "number", optional: true, desc: "Runs to analyse (default 100)." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/bus-factor",
          description: "Bus factor analysis: per-file-prefix contributor count and Herfindahl index. Flags modules with fewer than 2 active contributors.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/org-health-scorecard",
          description: "Leadership rollup across every repo in an org: a composite health score (60% DORA tier + 40% bus-factor risk), risk band, and throughput trend, sorted worst-first.",
          params: [
            { name: "org", type: "string", optional: false, desc: "Organization slug." },
            { name: "limit", type: "number", optional: true, desc: "Repos to analyse (default 10, max 20 — this is an expensive fan-out)." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/team-workload-risk",
          description: "Team-wide people-risk signals for a repo: after-hours/weekend commit patterns, activity cliffs, and concurrent open-PR overload, per contributor. A conversation-starter signal, not a verdict.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/security-scan",
          description: "Static analysis of workflow YAML files for security anti-patterns. Returns findings grouped by severity.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/audit-log",
          description: "Commit history for all .github/workflows/*.yml files, sorted by date.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/repo-summary",
          description: "Lightweight per-repo summary — default branch, latest run status, workflow count, and health signal. Called lazily as repository rows enter the viewport.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/rate-limit",
          description: "Current GitHub API rate-limit status for the authenticated user. Calls GET /rate_limit, which GitHub excludes from rate-limit accounting — checking it is always free.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/github/runner-stats",
          description: "Per-runner job counts, durations, and failure rates aggregated across a repo's recent completed workflow runs.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
            { name: "per_page", type: "number", optional: true, desc: "Runs to analyse (default 30, max 50)." },
          ],
        },
        {
          method: "GET",
          path: "/api/cron/sync",
          description: "Scheduled background sync, triggered daily by Vercel Cron. Re-syncs every repo tracked in sync_cursors and sends pending digest-channel alert emails. Requires Authorization: Bearer $CRON_SECRET — not callable from the browser.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/github/run-details",
          description: "Job and step breakdown for a single workflow run: per-job status, timing, and step-level detail.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
            { name: "run_id", type: "number", optional: false, desc: "Workflow run ID." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/open-pr-health",
          description: "Open pull-request health for a repository: age, review rounds, draft state, and awaiting-review flags per PR.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/org-overview",
          description: "Aggregated org-level metrics across all active repositories — totals, active-repo count, and per-repo summaries. Expensive multi-request call (cached 15 min).",
          params: [
            { name: "org", type: "string", optional: false, desc: "Organization slug." },
            { name: "limit", type: "number", optional: true, desc: "Max repositories to analyse." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/org-repos",
          description: "List all repositories in an organization.",
          params: [
            { name: "org", type: "string", optional: false, desc: "Organization slug." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/orgs",
          description: "List organizations the authenticated user belongs to.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/github/billing",
          description: "GitHub Actions billing for the authenticated user or an org: minutes used, paid minutes, included minutes, and per-OS breakdown.",
          params: [
            { name: "org", type: "string", optional: true, desc: "Organization slug; omit for the authenticated user." },
          ],
        },
        {
          method: "GET",
          path: "/api/github/billing/cost-analysis",
          description: "Detailed GitHub Actions cost breakdown via the Enhanced Billing API — per-product/SKU usage and spend for a given month. Some org/account combinations require fine-grained PAT permissions.",
          params: [
            { name: "org", type: "string", optional: false, desc: "Organization slug." },
            { name: "year", type: "number", optional: true, desc: "Billing year (defaults to current)." },
            { name: "month", type: "number", optional: true, desc: "Billing month 1–12 (defaults to current)." },
          ],
        },
        {
          method: "POST",
          path: "/api/db/sync",
          description: "Trigger incremental sync of GitHub workflow runs to the database. Checks alert rules after sync completes.",
          params: [
            { name: "org", type: "string", optional: true, desc: "Limit sync to a specific org." },
          ],
        },
        {
          method: "GET",
          path: "/api/db/runs",
          description: "Historical workflow runs from the Neon database (not the GitHub API). Requires DATABASE_URL; returns 0 results if the DB has no data for the repo yet.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner." },
            { name: "repo", type: "string", optional: false, desc: "Repository name." },
            { name: "limit", type: "number", optional: true, desc: "Max rows to return." },
            { name: "offset", type: "number", optional: true, desc: "Pagination offset." },
            { name: "conclusion", type: "string", optional: true, desc: "Filter by run conclusion (e.g. failure)." },
          ],
        },
        {
          method: "GET",
          path: "/api/db/trends",
          description: "Aggregated historical trend data from the Neon database — daily rollups for charts, quarterly summaries for year-over-year, or org-wide daily trends.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner (or org login for org trends)." },
            { name: "repo", type: "string", optional: true, desc: "Repository name (omit for org trends)." },
            { name: "type", type: "string", optional: true, desc: "daily (default), quarterly, or org." },
            { name: "days", type: "number", optional: true, desc: "Window for daily rollups." },
            { name: "quarters", type: "number", optional: true, desc: "Number of quarters for quarterly summaries." },
          ],
        },
        {
          method: "GET",
          path: "/api/alerts",
          description: "List alert rules, optionally filtered by scope. Set events=1 to also return the 50 most recent alert events.",
          params: [
            { name: "scope", type: "string", optional: true, desc: "Filter to a scope, e.g. repo:owner/name." },
            { name: "events", type: "string", optional: true, desc: "Set to 1 to include recent alert events." },
          ],
        },
        {
          method: "POST",
          path: "/api/alerts",
          description: "Create an alert rule. metric=\"leadership_digest\" creates a Weekly Leadership Digest instead of a threshold rule — scope must be org:X, and threshold/window_hours are ignored (sent every Monday, no cadence to configure).",
          params: [
            { name: "scope", type: "string", optional: false, desc: "(body) Rule scope, e.g. repo:owner/name or org:myorg." },
            { name: "metric", type: "string", optional: false, desc: "(body) Metric to watch." },
            { name: "threshold", type: "number", optional: false, desc: "(body) Threshold that triggers the alert." },
            { name: "window_hours", type: "number", optional: true, desc: "(body) Evaluation window (default 24)." },
            { name: "channel", type: "string", optional: true, desc: "(body) Delivery channel (default browser)." },
            { name: "destination", type: "string", optional: true, desc: "(body) Email address for email delivery." },
          ],
        },
        {
          method: "PATCH",
          path: "/api/alerts",
          description: "Update an existing alert rule — enable/disable or change threshold, window, or destination.",
          params: [
            { name: "id", type: "number", optional: false, desc: "(body) Alert rule ID." },
          ],
        },
        {
          method: "DELETE",
          path: "/api/alerts",
          description: "Delete an alert rule.",
          params: [
            { name: "id", type: "number", optional: false, desc: "Alert rule ID." },
          ],
        },
        {
          method: "POST",
          path: "/api/alerts/test",
          description: "Send a test alert for a rule without a real threshold breach (uses a synthetic value of 1).",
          params: [
            { name: "rule_id", type: "number", optional: false, desc: "(body) Alert rule ID to test." },
          ],
        },
        {
          method: "POST",
          path: "/api/webhooks/github",
          description: "Receive GitHub workflow_run webhook events and upsert runs into the database. Authenticated by HMAC-SHA256 signature against GITHUB_WEBHOOK_SECRET — no session required. Rejects all requests if the secret is unset (fail-safe).",
          params: [],
        },
        {
          method: "GET",
          path: "/api/ai/status",
          description: "Capability probe for the AI layer. Returns { enabled, providers } — which providers have a key configured, never the key material. Not rate-limited (no LLM call).",
          params: [],
        },
        {
          method: "GET",
          path: "/api/ai/insights",
          description: "LLM synthesis of a repository's or org's metrics. Returns { ok, provider, model, generated_at, cached, partial, content: { summary, bullets, actions } }. 503 when no provider key is configured or the provider is unavailable; 429 when rate-limited (20/min per token) or the daily token budget is spent. Prompts are built from an allowlisted, metrics-only snapshot — never code, logs, or commit messages.",
          params: [
            { name: "owner", type: "string", optional: true, desc: "Repository owner (repo surface — pair with repo)" },
            { name: "repo", type: "string", optional: true, desc: "Repository name (repo surface)" },
            { name: "org", type: "string", optional: true, desc: "Organisation login (org surface — takes precedence over owner/repo)" },
            { name: "refresh", type: "1", optional: true, desc: "Bypass the cached generation. Still rate-limited." },
          ],
        },
        {
          method: "GET",
          path: "/api/ai/anomaly-explanation",
          description: "Explain a workflow metric's statistical outliers from surrounding metadata (baseline stats, workflow-file change dates, trigger mix). Returns { ok, provider, model, outlier_count, content: { explanation, check } }. 404 when the metric has no outliers to explain; 503 when unconfigured or unavailable; 429 when rate-limited (20/min per token). Never reads run logs.",
          params: [
            { name: "owner", type: "string", optional: false, desc: "Repository owner" },
            { name: "repo", type: "string", optional: false, desc: "Repository name" },
            { name: "workflow_id", type: "number", optional: false, desc: "Workflow ID" },
            { name: "metric", type: "duration | queue_wait", optional: false, desc: "Which metric's outliers to explain. Validated against a literal allowlist — arbitrary values are rejected, never forwarded to a prompt." },
          ],
        },
        {
          method: "GET",
          path: "/api/health",
          description: "Liveness/readiness probe. Returns {\"status\":\"ok\"} with no authentication. Used by Kubernetes and load balancers.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/demo",
          description: "Sanitized fixture data for demo mode. No authentication required — the payload contains no real credentials.",
          params: [
            { name: "resource", type: "string", optional: false, desc: "repos, runs, or summary." },
            { name: "repo", type: "string", optional: true, desc: "Repository name for run/summary fixtures." },
            { name: "count", type: "number", optional: true, desc: "Number of synthetic runs to generate." },
          ],
        },
        {
          method: "POST",
          path: "/api/auth/setup",
          description: "Standalone mode: validate the submitted PAT and store it in an encrypted session cookie. Rate-limited.",
          params: [
            { name: "pat", type: "string", optional: false, desc: "(body) GitHub Personal Access Token." },
          ],
        },
        {
          method: "DELETE",
          path: "/api/auth/setup",
          description: "Standalone mode: clear the stored PAT (sign out).",
          params: [],
        },
        {
          method: "GET",
          path: "/api/auth/login",
          description: "Organization mode: begin the GitHub OAuth flow (redirects to GitHub). Rate-limited.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/auth/callback",
          description: "Organization mode: OAuth redirect target — verifies state, exchanges the code, and creates the session.",
          params: [
            { name: "code", type: "string", optional: false, desc: "OAuth authorization code (set by GitHub)." },
            { name: "state", type: "string", optional: false, desc: "CSRF state token (set by GitHub)." },
          ],
        },
        {
          method: "POST",
          path: "/api/auth/logout",
          description: "Destroy the session cookie and sign the user out.",
          params: [],
        },
        {
          method: "GET",
          path: "/api/auth/me",
          description: "Return the current session identity (login, mode), or 401 if unauthenticated.",
          params: [],
        },
      ].map((endpoint) => (
        <DocCard key={`${endpoint.method} ${endpoint.path}`}>
          <div className="flex items-center gap-3 mb-3">
            <span className={cn(
              "text-xs font-mono font-bold px-2.5 py-1 rounded-lg",
              endpoint.method === "GET"
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                : "bg-blue-500/15 text-blue-400 border border-blue-500/20"
            )}>
              {endpoint.method}
            </span>
            <code className="text-sm font-mono text-white font-semibold">{endpoint.path}</code>
          </div>
          <ProseP>{endpoint.description}</ProseP>
          {endpoint.params.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Parameters</p>
              <DocTable
                headers={["Name", "Type", "Required", "Description"]}
                rows={endpoint.params.map((p) => [
                  <Code key={p.name}>{p.name}</Code>,
                  <span key="t" className="text-slate-500 text-xs font-mono">{p.type}</span>,
                  p.optional
                    ? <span key="r" className="text-slate-500 text-xs">Optional</span>
                    : <span key="r" className="text-amber-400 text-xs font-medium">Required</span>,
                  <span key="d" className="text-xs">{p.desc}</span>,
                ])}
              />
            </div>
          )}
        </DocCard>
      ))}
    </section>
  );
}

function FAQ() {
  const items = [
    {
      q: "I see a blank screen or 500 error after deploying.",
      a: <>Check that <Code>SESSION_SECRET</Code> is set and is at least 32 characters. The app throws at startup in production if it is missing or too short. Check server logs for <Code>[startup]</Code> errors.</>,
    },
    {
      q: "Cost Analytics shows a 404 error about billing.",
      a: <>In <strong className="text-white">org mode</strong>, Cost Analytics requires the GitHub Enhanced Billing Platform (Team or Enterprise). In <strong className="text-white">standalone mode</strong>, only your personal billing data is available.</>,
    },
    {
      q: "OAuth callback fails with 'state mismatch' or 'expired state'.",
      a: <>OAuth state tokens expire after 5 minutes. If the user takes longer to authorize, they need to click &ldquo;Sign in with GitHub&rdquo; again. Also verify <Code>NEXT_PUBLIC_APP_URL</Code> exactly matches the callback URL in your GitHub OAuth App.</>,
    },
    {
      q: "DATABASE_URL is set but reports/alerts still don't work.",
      a: <>Confirm you are in <Code>MODE=organization</Code>. These features are disabled in standalone mode regardless of <Code>DATABASE_URL</Code>. Also check that <Code>?sslmode=require</Code> is appended for Neon databases.</>,
    },
    {
      q: "SESSION_SECRET must be at least 32 characters — but I'm running locally.",
      a: <>This check only applies when <Code>NODE_ENV=production</Code>. In development (<Code>pnpm run dev</Code>) any value is accepted.</>,
    },
    {
      q: "How do I update to a new version?",
      a: <>Pull the latest Docker image: <Code>docker pull dinhdobathi1992/gitdash:latest</Code> then restart your container. For self-built deployments, pull the latest commit and rebuild.</>,
    },
    {
      q: "Can I use a fine-grained PAT instead of a classic PAT?",
      a: <>Yes. Use a fine-grained PAT with <Code>Actions: read</Code> and <Code>Contents: read</Code> scoped to specific repositories. Note: fine-grained PATs cannot access organization data (<Code>read:org</Code>), so org-level features will not work.</>,
    },
    {
      q: "My organizations don't show up in the org switcher, even though I'm a member.",
      a: <>
        The switcher only lists what GitHub&apos;s <Code>orgs.listForAuthenticatedUser</Code> API
        returns for your current token — which depends on when that token was
        authorized, not just what orgs you belong to today:
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>
            <strong>Organization mode (OAuth):</strong> if you authorized GitDash
            before <Code>read:org</Code> was added to the requested scopes, your
            existing session won&apos;t have it. Sign out and sign back in to
            re-authorize with the current scope list.
          </li>
          <li>
            <strong>Standalone mode (PAT):</strong> a classic PAT needs the{" "}
            <Code>read:org</Code> scope explicitly checked; a fine-grained PAT
            cannot see organization data at all (see the previous question).
          </li>
          <li>
            Some orgs hide private membership from this API even with the
            right scope, depending on the org&apos;s own visibility settings.
          </li>
        </ul>
        In any case, you can still reach an org directly — type its name into
        the &quot;Go to org by name&quot; box in the org switcher, or open{" "}
        <Code>/org/&lt;name&gt;</Code> directly. Both work independently of the
        discovery list, using your token&apos;s actual repo access.
      </>,
    },
  ];

  return (
    <section id="faq" className="scroll-mt-8 space-y-6">
      <SectionHeading id="faq" icon={HelpCircle}>FAQ &amp; Troubleshooting</SectionHeading>
      <div className="space-y-3">
        {items.map((item, i) => (
          <DocCard key={i}>
            <div className="flex items-start gap-3">
              <Terminal className="w-4 h-4 mt-0.5 text-violet-400 shrink-0" />
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-white">{item.q}</p>
                <p className="text-sm text-slate-400 leading-relaxed">{item.a}</p>
              </div>
            </div>
          </DocCard>
        ))}
      </div>
    </section>
  );
}

function Contributing() {
  return (
    <section id="contributing" className="scroll-mt-8 space-y-6">
      <SectionHeading id="contributing" icon={GitPullRequest}>Contributing</SectionHeading>

      <DocCard>
        <SubHeading>Local Development Setup</SubHeading>
        <Steps>
          <Step title="Clone and install" step={1}>
            <CodeBlock language="bash" filename="terminal">
              {`git clone https://github.com/dinhdobathi1992/gitdash.git
cd gitdash
pnpm install`}
            </CodeBlock>
          </Step>
          <Step title="Configure environment" step={2}>
            <CodeBlock language="bash" filename=".env.local">
              {`MODE=standalone
SESSION_SECRET=any_32_char_string_for_local_dev
# DATABASE_URL is optional for standalone mode`}
            </CodeBlock>
          </Step>
          <Step title="Start dev server" step={3}>
            <CodeBlock language="bash" filename="terminal">
              {`pnpm run dev
# → http://localhost:3000`}
            </CodeBlock>
          </Step>
          <Step title="Run type checks" step={4}>
            <CodeBlock language="bash" filename="terminal">
              {`pnpm exec tsc --noEmit
pnpm run lint`}
            </CodeBlock>
          </Step>
        </Steps>
      </DocCard>

      <DocCard>
        <SubHeading>Codebase Structure</SubHeading>
        <CodeBlock language="text">
          {`src/
├── app/
│   ├── (main)/              # App routes (repos, workflows, etc.)
│   ├── docs/                # This docs page
│   └── api/                 # API routes (proxy to GitHub + DB)
│       ├── github/          # GitHub API proxy routes
│       ├── db/              # Database sync + query routes
│       └── auth/            # OAuth + session routes
├── components/
│   ├── docs/                # Docs-specific UI components
│   └── *.tsx                # Shared app components
└── lib/                     # Utilities, DB client, helpers`}
        </CodeBlock>
      </DocCard>

      <DocCard>
        <SubHeading>PR Guidelines</SubHeading>
        <ul className="space-y-2 text-sm text-slate-300">
          {[
            "Every new feature must include a docs update (update this page)",
            "TypeScript strict mode — no any types without justification",
            "Security: never log or expose credentials (checked in CI)",
            "New API routes must follow existing input validation patterns",
            "Test Docker build locally before opening a PR",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle className="w-3.5 h-3.5 mt-0.5 text-emerald-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </DocCard>
    </section>
  );
}

function ReleaseNotes() {
  const releases = [
    {
      version: "4.1.1",
      date: "2026-08-14",
      badge: "latest",
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "AI Anomaly Explanations — each flagged metric on the Workflow Detail reliability tab gains a \"Why did duration spike?\" button that explains the outliers from surrounding metadata: baseline statistics, when the workflow file last changed, and the trigger mix. Lazy by design — opening the tab costs nothing until you ask",
          "Bailian (Alibaba Cloud) added as a third provider and tried first. It speaks the Anthropic Messages API rather than the OpenAI shape, so the provider layer now models the wire format explicitly instead of assuming one protocol",
        ],
        fixed: [],
        improved: [
          "Extended thinking is disabled on Bailian requests. Qwen models there enable it by default, costing roughly 10x the output tokens for no benefit on structured extraction — measured 799 vs 85 output tokens on an identical request. The response parser still picks the text block explicitly, in case a model ignores the flag",
        ],
      },
    },
    {
      version: "4.1.0",
      date: "2026-08-14",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "AI Insights — an optional card on the Repository Overview and Team Health Scorecard pages that turns the metrics already on screen into plain-English analysis: what changed, why it matters, and what to do next. Gemini primary with Qwen fallback, both via their OpenAI-compatible endpoints, so no vendor SDK is installed",
          "Entirely opt-in: with no provider key configured on the server, every AI surface is hidden and GitDash behaves exactly as it did in v4.0.11. New \"AI Insights\" toggle in Settings → Feature Flags, and a new /api/ai/status capability probe",
          "Privacy is enforced at the type level: prompts are built server-side from an allowlisted snapshot, and the test suite walks the serialized output to fail the build if a token, log, commit message, file path or URL ever appears. Metrics, names, logins and dates are sent; code, logs, YAML and message bodies never are",
          "Cost controls: 15-minute snapshot-fingerprinted caching, 20 requests/minute per token, a per-attempt and total wall-clock timeout, and a daily token budget (AI_DAILY_TOKEN_BUDGET). All in-process, so they bound cost per instance rather than globally — documented as a damage-limiter, not a hard spend cap",
        ],
        fixed: [],
        improved: [],
      },
    },
    {
      version: "4.0.11",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [],
        improved: [
          "Team Analytics page redesign, implemented from a second Claude Design import (\"Section Headers\"): PR Leaderboard, Reviewer Load Matrix, Review Bottleneck, Workload Risk Radar, Bus Factor Map, and Runner Utilization now use a polished card-style collapsible header with a live data count badge, instead of a plain chevron-and-text toggle. Content components unchanged — same API, same data",
        ],
      },
    },
    {
      version: "4.0.10",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [],
        improved: [
          "Team Health Scorecard loading state: a spinner + \"Collecting data across up to N repositories…\" status line now sits above the skeleton tiles, so a slow fetch (or one hitting GitHub's rate limits) visibly reads as working rather than frozen",
        ],
      },
    },
    {
      version: "4.0.9",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [
          "Every page logged \"Error with Permissions-Policy header: Unrecognized feature: 'interest-cohort'\" — a stale FLoC-related directive no browser recognizes anymore. Removed; camera/microphone/geolocation stay disabled",
        ],
        improved: [],
      },
    },
    {
      version: "4.0.8",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [],
        improved: [
          "Team Health Scorecard redesign, implemented from a Claude Design import: estate-distribution card + stat tiles in the header, a proper grouped table (column headers, risk-band sections with count chips), interactive filter/sort pills, and bus-factor pip indicators. Presentational only — same API, same data",
        ],
      },
    },
    {
      version: "4.0.7",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [
          "Team Health Scorecard had no visible entry point from the main dashboard — the only labeled link lived in the /org/[orgName] header, reachable solely via an unlabeled icon-only \"Org overview\" button. The main dashboard header now shows a labeled \"Team Health Scorecard\" button directly whenever an org is selected",
        ],
        improved: [],
      },
    },
    {
      version: "4.0.6",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [
          "The four v4.0.0–v4.0.3 features (Team Health Scorecard, Workload Risk Radar, 1:1 Prep Sheet, Leadership Digest) were only mentioned in changelog prose — no dedicated Features doc page, no sidebar entry, so they were effectively undiscoverable outside this release-notes tab. Each now has a full feature page with a \"New in vX.Y\" badge",
          "Feature Overview index still labeled Team Insights \"(In Development)\" and Contributor Profile \"(Coming Soon)\" even though both have been fully built for several releases",
        ],
        improved: [
          "New VersionBadge convention: any doc content added for a new feature (or a meaningful addition to an existing one) now carries a \"New in vX.Y\" pill, so what's new stays visible outside the changelog",
        ],
      },
    },
    {
      version: "4.0.5",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [],
        fixed: [
          "Contributor profile failed with \"Failed to fetch contributor profile\" whenever the repo owner is a personal GitHub account rather than an organization — the route always called GET /orgs/{org}/repos, which 404s for personal accounts. Now falls back to GET /users/{username}/repos on 404",
        ],
        improved: [],
      },
    },
    {
      version: "4.0.4",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Org switcher: \"Go to org by name\" input, always available — reaches any org directly regardless of what GitHub's org-discovery API returns for your token",
        ],
        fixed: [
          "Org switcher showed only \"Personal repos\" with no explanation or workaround when GitHub's orgs.listForAuthenticatedUser API returned an empty list (stale OAuth scope, fine-grained PAT, or org visibility settings) — now explains why and offers the manual org input as a fallback",
          "Navigating to an org not in the auto-discovered list incorrectly showed \"Personal Repos\" as the page title even though the repo list was correctly filtered to that org",
        ],
        improved: [],
      },
    },
    {
      version: "4.0.3",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Weekly Leadership Digest — narrative org-wide summary emailed every Monday. New leadership_digest alert metric in the Alerts page (pick an org + email, no threshold or window needed). Reuses the Team Health Scorecard's computation; no new database table, no \"last sent\" state — the daily cron just checks if today is Monday",
        ],
        fixed: [],
        improved: [],
      },
    },
    {
      version: "4.0.2",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "1:1 Prep Sheet — one-click manager brief at /contributor/[login]/brief: period-over-period PR/review/cycle-time comparison plus auto-generated talking points (conversation prompts, not verdicts). Print-friendly. Zero extra GitHub API calls — reuses the contributor profile's existing data and SWR cache",
        ],
        fixed: [],
        improved: [],
      },
    },
    {
      version: "4.0.1",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Workload Risk Radar — team-wide people-risk signals: sustained after-hours/weekend work, activity cliffs (\"went quiet\"), and concurrent-PR overload. New Team Analytics section, framed as a conversation-starter rather than a verdict",
        ],
        fixed: [],
        improved: [],
      },
    },
    {
      version: "4.0.0",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Team Health Scorecard — org-wide ranked view (Healthy / Watch / At Risk) combining DORA tier and bus-factor risk per repo, worst-first, with a throughput trend. New page at /org/[orgName]/health",
        ],
        fixed: [],
        improved: [
          "Bus-factor calculation extracted into a reusable lib function (src/lib/bus-factor.ts) so the scorecard can compute it per-repo without an internal HTTP round trip; the existing /api/github/bus-factor route is unchanged in behavior",
        ],
      },
    },
    {
      version: "3.2.0",
      date: "2026-08-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Custom domain: production now serves from gitdash.info",
          "Scheduled background sync — daily Vercel Cron re-syncs every tracked repo so Reports and Alerts stay current without a manual click",
          "Rate-limit budget widget in the sidebar — live GitHub API quota, free to check (GET /rate_limit is excluded from rate-limit accounting)",
          "Runner Utilization — per-runner job counts, durations, and failure rates in Team Analytics",
          "Partial-data indicators — fan-out routes (bus-factor, open-pr-health, repo-contributors, contributor-profile, repo-dora) now report when some sub-requests were rate-limited and show an amber banner instead of an undercounted number",
          "Anomaly-driven alerts — new anomaly_count metric fires on statistical outliers using the same detector the workflow detail page already uses",
          "Digest alert channel — bundle matching alerts into one daily summary email instead of a notification per event",
          "Review Bottleneck — flags overloaded reviewers and single-point-of-failure review dependencies in Team Analytics",
        ],
        fixed: [
          "RecentFailuresWidget on the repo dashboard never showed newly-loaded failures — its cache-read memo depended on an identity-stable SWR cache object; now driven by a tick counter",
        ],
        improved: [
          "Consolidated all Recharts imports behind one shared module — eliminates duplicated ~388 KB chunks across routes",
          "DORA drill-down and PR lifecycle sections (collapsed by default on the repo page) now lazy-load via next/dynamic",
          "RepoRow on the home page is memoized — search keystrokes no longer re-render the full visible table",
          "Fan-out routes' batch-of-N loops converted to the bounded worker pool (pLimitSettled) — no more waiting on the slowest member of each batch",
        ],
      },
    },
    {
      version: "3.1.3",
      date: "2026-03-13",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "3.x release line — responsive mobile navigation, redesigned settings, global footer, demo mode, and test infrastructure (Vitest)",
          "DB-backed reporting and alert rules with browser and email delivery (Resend / SendGrid / SMTP)",
          "Cost analytics via the GitHub Enhanced Billing API",
          "Reverse-proxy / Zscaler support — redirects use the public-facing origin from x-forwarded headers; dedicated /api/health endpoint for Kubernetes probes",
        ],
        fixed: [
          "Middleware activation and reverse-proxy redirect fixes (issues #3, #4); ALWAYS_PUBLIC check now runs before the HTTPS redirect so probes and static assets are never redirected",
        ],
        improved: [
          "API Reference rebuilt to cover all REST endpoints; docs corrected (Neon Postgres only — no SQLite; middleware path is src/middleware.ts)",
          "See CHANGELOG.md for the full 3.0.0 → 3.1.3 history",
        ],
      },
    },
    {
      version: "2.10.1",
      date: "2026-03-03",
      badge: null,
      badgeColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      changes: {
        added: [
          "Feature Overview index page — 13 clickable feature cards replacing the long scroll, each navigates to a dedicated feature sub-page",
          "13 individual feature detail pages in docs (one per page in the app): Repositories, Repository Overview, Workflow Detail, Audit Trail, Security Scan, Repo Team Stats, Team Insights, Contributor Profile, Cost Analytics, Reports, Alerts, Settings, Org Overview",
          "Workflow Detail tabs section — each of the 5 tabs (Overview, Performance, Reliability, Triggers, Runs) now has its own card with description and screenshot slots; Performance shows a 2-column screenshot grid",
          "Screenshot slots in every feature page — drop a PNG into public/screenshots/<name>.png and it renders automatically; absent files show a placeholder with the expected filename",
          "Screenshots for Repositories, Workflow Detail (Overview, Performance, Reliability, Triggers, Runs), and Cost Analytics now pre-loaded from docs/screenshots/",
          "Sidebar sub-items for all 13 feature pages — visually indented, smaller text, lighter colour when inactive",
          "⌘K search index expanded with all 13 feature sub-pages (individually searchable with accurate excerpts)",
          "FeaturePageHeader shared component — consistent icon + name + path badge + chip row across all feature pages",
        ],
        fixed: [],
        improved: [
          "Full feature audit — API Reference and feature pages refreshed to match live code",
          "DocSearch section labels now distinguish Features / Reference / Support groups",
        ],
      },
    },
    {
      version: "2.9.0",
      date: "2026-03-03",
      badge: null,
      badgeColor: "",
      changes: {
        added: [
          "DORA 4 Keys at repository level — Deploy Frequency, Lead Time, CFR, MTTR computed from real merged PRs and GitHub Releases",
          "DORA drill-down charts: PR Cycle Time Breakdown (segmented bar), PR Size vs Velocity (scatter + regression line), PR Throughput (12-week bar), Workflow Stability (30d line with Elite/High reference lines)",
          "Team Insights page (/team) — global view with repo picker, sortable contributor leaderboard (8 metrics), and reviewer load heatmap",
          "Contributor Profile page (/contributor/[login]) — KPI cards, 52-week GitHub-style activity heatmap, weekly commit chart, PR lifecycle funnel, commit hour distribution, languages touched, recent PRs table",
          "Bus factor analysis — per-module contributor Herfindahl index, flags modules with <2 active contributors",
          "People-based alert metrics: PR throughput drop, review response P90, after-hours commit %, PR abandon rate, unreviewed PR age",
          "Reviewer Load Matrix component (author × reviewer heatmap) in both /team and repo team pages",
          "/api/github/repo-dora — new endpoint returning full RepoDoraSummary (5-min cache)",
          "/api/github/repo-contributors — new endpoint: per-contributor stats + reviewer matrix + bus factor",
          "/api/github/contributor-profile — new endpoint: full contributor data from PR, review, and commit APIs",
          "/api/github/bus-factor — new endpoint: per-module concentration analysis",
          "Docs redesigned to single-section navigation (opencode.ai style) — clicking nav replaces content, no more full-page scroll",
          "Prev / Next navigation at the bottom of each docs section",
        ],
        fixed: [],
        improved: [
          "Action Duration Trend (renamed from Duration Trend) on repo overview page",
          "Docs search (⌘K) now switches to the selected section instead of scrolling",
          "Version badge in sidebar reads from package.json via NEXT_PUBLIC_APP_VERSION at build time",
        ],
      },
    },
    {
      version: "2.3.0",
      date: "2026-03-01",
      badge: null,
      badgeColor: "",
      changes: {
        added: [
          "Modernized /docs page with component library, search, collapsible sidebar, IntersectionObserver ToC",
          "GitHub webhook receiver at /api/webhooks/github — workflow_run events auto-sync to Neon DB",
          "Alert rule evaluation wired into POST /api/db/sync — rules checked after every sync",
          "Slack webhook delivery for alert rules (channel=slack)",
          "/docs publicly accessible before authentication (no login required)",
        ],
        fixed: [
          "Sidebar no longer renders on /docs for unauthenticated visitors",
          "SWR global 401 handler no longer redirects away from /docs",
        ],
        improved: [
          "upsertRuns() replaced N+1 per-row SQL loop with single Neon HTTP transaction — up to 500× fewer round-trips per sync",
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
        ],
        fixed: [],
        improved: ["Sync cursor prevents re-fetching already-stored runs on repeated syncs"],
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
          "Org dashboard at /org/[orgName] — reliability heatmap and sortable repo table",
          "Audit tab, Security tab, Team stats tab at /repos/[owner]/[repo]/*",
        ],
        fixed: ["OAuth state now expires after 5 minutes to prevent stale CSRF tokens"],
        improved: ["Repo overview fetches up to 10 workflows in parallel batches of 5"],
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
          "iron-session v8 with AES-256-GCM cookie encryption",
          "HTTP security headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options",
          "Rate limiting on /api/auth/setup (5 req/min) and /api/auth/login (10 req/min)",
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
          "Auto-refresh every 30 seconds while runs are in-progress",
          "Browser notifications for new workflow failures (opt-in)",
          "CSV export from the Runs tab",
        ],
        fixed: [],
        improved: [],
      },
    },
  ];

  const chipColors: Record<string, string> = {
    added: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    fixed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    improved: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  };

  const dotColors: Record<string, string> = {
    added: "text-emerald-400",
    fixed: "text-blue-400",
    improved: "text-violet-400",
  };

  return (
    <section id="release-notes" className="scroll-mt-8 space-y-6">
      <SectionHeading id="release-notes" icon={Tag}>Release Notes</SectionHeading>
      <div className="space-y-4">
        {releases.map((r) => (
          <DocCard key={r.version}>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-lg font-bold text-white">v{r.version}</span>
              {r.badge && (
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${r.badgeColor}`}>
                  {r.badge}
                </span>
              )}
              <span className="text-xs text-slate-500">{r.date}</span>
            </div>

            <div className="space-y-4 pt-1">
              {(["added", "fixed", "improved"] as const).map((kind) => {
                const items = r.changes[kind];
                if (!items.length) return null;
                const label = kind === "added" ? "Added" : kind === "fixed" ? "Fixed" : "Improved";
                return (
                  <div key={kind}>
                    <span className={`inline-block text-xs px-2 py-0.5 rounded-full border font-semibold mb-2 ${chipColors[kind]}`}>
                      {label}
                    </span>
                    <ul className="space-y-1.5">
                      {items.map((item, i) => (
                        <li key={i} className={`flex items-start gap-2 text-sm text-slate-300`}>
                          <ChevronRight className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${dotColors[kind]}`} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </DocCard>
        ))}
      </div>
    </section>
  );
}

// ── Sidebar Component ─────────────────────────────────────────────────────────

function DocSidebar({
  active,
  onSelect,
  onSearchOpen,
  mobileOpen,
  onMobileClose,
}: {
  active: string;
  onSelect: (id: string) => void;
  onSearchOpen: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleSection = (title: string) => {
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo / Title */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-white">GitDash Docs</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/20 font-mono">
            v{process.env.NEXT_PUBLIC_APP_VERSION ?? "4.1.1"}
          </span>
        </div>
        {/* Mobile close */}
        <button
          className="lg:hidden text-slate-500 hover:text-white transition-colors"
          onClick={onMobileClose}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search button */}
      <div className="px-3 py-3 border-b border-slate-800">
        <button
          onClick={onSearchOpen}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 text-sm hover:border-violet-500/40 hover:text-white transition-colors"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="flex-1 text-left">Search docs...</span>
          <kbd className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-500 font-mono">⌘K</kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {NAV.map((section) => {
          const isCollapsed = collapsed[section.title];
          return (
            <div key={section.title} className="mb-1">
              <button
                onClick={() => toggleSection(section.title)}
                className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-300 transition-colors"
              >
                {section.title}
                <ChevronDown className={cn("w-3 h-3 transition-transform", isCollapsed && "-rotate-90")} />
              </button>
              {!isCollapsed && (
                <ul className="mt-0.5 space-y-0.5">
                  {section.items.map(({ id, label, icon: Icon, sub }) => (
                    <li key={id}>
                      <button
                        onClick={() => {
                          onSelect(id);
                          onMobileClose();
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 rounded-lg text-left transition-colors",
                          sub
                            ? "pl-7 pr-3 py-1.5 text-xs"
                            : "px-3 py-2 text-sm",
                          active === id
                            ? "bg-violet-500/15 text-violet-300 border border-violet-500/20"
                            : sub
                              ? "text-slate-500 hover:text-slate-200 hover:bg-slate-800/40"
                              : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                        )}
                      >
                        <Icon className={cn("shrink-0", sub ? "w-3 h-3" : "w-3.5 h-3.5")} />
                        {label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer links */}
      <div className="px-4 py-3 border-t border-slate-800 space-y-1">
        <a
          href="https://github.com/dinhdobathi1992/gitdash"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-xs text-slate-500 hover:text-white transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          GitHub Repository
        </a>
        <a
          href="https://github.com/dinhdobathi1992/gitdash/issues"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-xs text-slate-500 hover:text-white transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Report an Issue
        </a>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 sticky top-0 h-screen border-r border-slate-800 bg-slate-950/80 backdrop-blur-sm">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/60" onClick={onMobileClose} />
          <aside className="relative w-72 h-full bg-slate-950 border-r border-slate-800 flex flex-col">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [active, setActive] = useState("getting-started");

  // Section registry is defined here so Features can receive onNavigate
  const SECTION_COMPONENTS: Record<string, React.ReactNode> = {
    "getting-started": <GettingStarted />,
    "deployment": <Deployment />,
    "configuration": <Configuration />,
    "modes": <Modes />,
    "security": <Security />,
    "core-concepts": <CoreConcepts />,
    "features": <Features onNavigate={setActive} />,
    "feat-repositories": <FeatureRepositories />,
    "feat-repo-overview": <FeatureRepoOverview />,
    "feat-workflow": <FeatureWorkflowDetail />,
    "feat-audit": <FeatureAudit />,
    "feat-security": <FeatureSecurity />,
    "feat-repo-team": <FeatureRepoTeam />,
    "feat-team": <FeatureTeamInsights />,
    "feat-contributor": <FeatureContributor />,
    "feat-cost": <FeatureCost />,
    "feat-reports": <FeatureReports />,
    "feat-alerts": <FeatureAlerts />,
    "feat-settings": <FeatureSettings />,
    "feat-org":           <FeatureOrg />,
    "feat-health-scorecard": <FeatureHealthScorecard />,
    "feat-workload-risk":    <FeatureWorkloadRisk />,
    "feat-one-on-one":       <FeatureOneOnOne />,
    "feat-leadership-digest": <FeatureLeadershipDigest />,
    "feat-ai-insights":       <FeatureAiInsights />,
    "metrics-reference":    <MetricsReference onNavigate={setActive} />,
    "metrics-dora":         <MetricsDora />,
    "metrics-pr-cycle":     <MetricsPrCycle />,
    "metrics-pr-health":    <MetricsPrHealth />,
    "metrics-workflow":     <MetricsWorkflow />,
    "metrics-performance":  <MetricsPerformance />,
    "metrics-reliability":  <MetricsReliability />,
    "metrics-team":         <MetricsTeam />,
    "metrics-ci-alerts":    <MetricsCiAlerts />,
    "api-reference":        <APIReference />,
    "faq": <FAQ />,
    "contributing": <Contributing />,
    "release-notes": <ReleaseNotes />,
  };
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Scroll to top whenever the active section changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [active]);

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const activeIndex = ALL_SECTIONS.findIndex((s) => s.id === active);
  const prevSection = activeIndex > 0 ? ALL_SECTIONS[activeIndex - 1] : null;
  const nextSection = activeIndex < ALL_SECTIONS.length - 1 ? ALL_SECTIONS[activeIndex + 1] : null;

  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Sidebar */}
      <DocSidebar
        active={active}
        onSelect={(id) => { setActive(id); setMobileOpen(false); }}
        onSearchOpen={() => setSearchOpen(true)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Mobile header */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 bg-slate-950/90 backdrop-blur-sm border-b border-slate-800">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <BookOpen className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-white">GitDash Docs</span>
          <button
            onClick={() => setSearchOpen(true)}
            className="ml-auto text-slate-400 hover:text-white transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>

        {/* Content area — only the active section is rendered */}
        <main className="max-w-3xl mx-auto px-6 py-10">
          {SECTION_COMPONENTS[active]}

          {/* Prev / Next navigation */}
          <div className="mt-16 pt-6 border-t border-slate-800 flex items-center justify-between gap-4">
            {prevSection ? (
              <button
                onClick={() => setActive(prevSection.id)}
                className="group flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                <ChevronRight className="w-4 h-4 rotate-180 shrink-0 text-slate-600 group-hover:text-violet-400 transition-colors" />
                <div className="text-left">
                  <p className="text-[10px] text-slate-600 uppercase tracking-wider">Previous</p>
                  <p className="font-medium">{prevSection.label}</p>
                </div>
              </button>
            ) : <div />}

            {nextSection ? (
              <button
                onClick={() => setActive(nextSection.id)}
                className="group flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors text-right"
              >
                <div>
                  <p className="text-[10px] text-slate-600 uppercase tracking-wider">Next</p>
                  <p className="font-medium">{nextSection.label}</p>
                </div>
                <ChevronRight className="w-4 h-4 shrink-0 text-slate-600 group-hover:text-violet-400 transition-colors" />
              </button>
            ) : <div />}
          </div>

          {/* Footer */}
          <footer className="mt-8 pb-4 text-center text-xs text-slate-600 space-y-1">
            <p>GitDash v{process.env.NEXT_PUBLIC_APP_VERSION ?? "4.1.1"} — GitHub Actions Dashboard</p>
            <p>
              <a href="https://github.com/dinhdobathi1992/gitdash" target="_blank" rel="noreferrer" className="hover:text-slate-400 transition-colors">
                Open source on GitHub
              </a>
              {" · "}
              <a href="https://github.com/dinhdobathi1992/gitdash/issues" target="_blank" rel="noreferrer" className="hover:text-slate-400 transition-colors">
                Report an issue
              </a>
            </p>
          </footer>
        </main>
      </div>

      {/* Search modal */}
      <DocSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(id) => { setActive(id); setSearchOpen(false); }}
      />
    </div>
  );
}
