"use client";

import Link from "next/link";
import { Rocket, Server, Settings2, Terminal } from "lucide-react";
import { Callout } from "@/components/docs/Callout";
import { CodeBlock, Code } from "@/components/docs/CodeBlock";
import { DocCard, DocTable, FeatureGrid, FeatureCard } from "@/components/docs/DocCard";
import { Tabs, Tab } from "@/components/docs/Tabs";
import { Steps, Step } from "@/components/docs/Steps";
import { SectionHeading, SubHeading, ProseP, ScreenshotSlot } from "./primitives";

// ── Introduction ──────────────────────────────────────────────────────────────

export function GettingStarted() {
  return (
    <section id="getting-started" className="scroll-mt-20 space-y-6">
      <SectionHeading id="getting-started" icon={Rocket}>Introduction</SectionHeading>

      <ProseP>
        GitDash turns your GitHub Actions runs and pull requests into delivery metrics — DORA, reliability, cost and
        team health — on infrastructure you run yourself. It reads GitHub with each person&apos;s own token, so nobody
        sees more than GitHub already lets them see.
      </ProseP>

      <ScreenshotSlot file="repos.jpg" alt="Repositories: every repository with status, success rate, recent runs and p95 duration" />

      <FeatureGrid>
        <FeatureCard icon="📊" title="Delivery metrics">
          DORA four keys per repository, pull-request cycle time, workflow reliability and performance, with drill-downs
          down to a single step.
        </FeatureCard>
        <FeatureCard icon="🔔" title="Alerts that explain themselves">
          Rules on CI and people metrics, delivered in the browser, by email or to Slack, plus a weekly leadership digest.
        </FeatureCard>
        <FeatureCard icon="👥" title="Team health">
          Reviewer load, bus factor, workload risk and a one-click 1:1 prep sheet — framed as conversation starters.
        </FeatureCard>
        <FeatureCard icon="🔐" title="Access you control">
          In organization mode an admin decides which groups see which features, and the server enforces it.
        </FeatureCard>
      </FeatureGrid>

      <DocCard>
        <SubHeading>Two ways to run it</SubHeading>
        <DocTable
          headers={["Mode", "Use it when"]}
          rows={[
            [<Code key="s">standalone</Code>, "You want your own dashboard: sign in with a personal access token, no OAuth App or database needed."],
            [<Code key="o">organization</Code>, "A team shares one deployment: GitHub OAuth or token sign-in, a Postgres database, groups and permissions, alerts and reports."],
          ]}
        />
        <ProseP>See Auth modes for the full comparison.</ProseP>
      </DocCard>
    </section>
  );
}

// ── Quick start ───────────────────────────────────────────────────────────────

export function QuickStart() {
  return (
    <section id="quick-start" className="scroll-mt-20 space-y-6">
      <SectionHeading id="quick-start" icon={Terminal}>Quick start</SectionHeading>

      <DocCard>
        <SubHeading>Prerequisites</SubHeading>
        <ProseP>
          Node.js 20 or later and pnpm (<Code>corepack enable pnpm</Code> — the version is pinned in{" "}
          <Code>package.json</Code>). Docker is enough if you only want to run the published image.
        </ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Standalone — your own dashboard</SubHeading>
        <CodeBlock language="bash" filename="terminal">
          {`git clone https://github.com/dinhdobathi1992/gitdash.git
cd gitdash
pnpm install --frozen-lockfile
cp .env.local.example .env.local   # then set the two values below

# .env.local
MODE=standalone
SESSION_SECRET=$(openssl rand -hex 32)

pnpm run dev`}
        </CodeBlock>
        <ProseP>
          Open <Code>http://localhost:3000</Code>; you are sent to <Code>/setup</Code> to paste a personal access token.
        </ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Organization — for a team</SubHeading>
        <Steps>
          <Step title="Create a GitHub OAuth App" step={1}>
            GitHub → Settings → Developer settings → OAuth Apps → New OAuth App. Set the callback URL to{" "}
            <Code>http://localhost:3000/api/auth/callback</Code> (your public URL in production).
          </Step>
          <Step title="Provide a Postgres database" step={2}>
            Any Postgres works (Neon on Vercel). Tables are created automatically on first start.
          </Step>
          <Step title="Configure .env.local" step={3}>
            <CodeBlock language="bash" filename=".env.local">
              {`MODE=organization
SESSION_SECRET=replace_with_openssl_rand_hex_32
GITHUB_CLIENT_ID=your_oauth_app_client_id
GITHUB_CLIENT_SECRET=your_oauth_app_client_secret
DATABASE_URL=postgres://user:pass@host/db?sslmode=require
GITDASH_ADMIN_GITHUB_IDS=12345678    # your numeric id: gh api user --jq .id
GITDASH_ALLOWED_ORGS=my-org          # optional
NEXT_PUBLIC_APP_URL=http://localhost:3000`}
            </CodeBlock>
          </Step>
          <Step title="Start and assign access" step={4}>
            <Code>pnpm run dev</Code>, sign in, then use <strong className="text-fg">Admin</strong> to put people in
            groups. See Access control for the rollout order.
          </Step>
        </Steps>
      </DocCard>

      <DocCard>
        <SubHeading>Token scopes</SubHeading>
        <DocTable
          headers={["Token", "Needs"]}
          rows={[
            ["Classic PAT", <><Code key="a">repo</Code>, <Code key="b">workflow</Code>, <Code key="c">read:org</Code>, <Code key="d">read:user</Code>, <Code key="e">user:email</Code></>],
            ["Fine-grained PAT", "Read access to Actions, Contents, Metadata and Pull requests on the repositories you want to see; for an organization, create it with the org as resource owner and grant Members: read."],
            ["Cost page", "A fine-grained token with the organization's Administration: read permission (GitHub billing APIs)."],
          ]}
        />
      </DocCard>
    </section>
  );
}

// ── Deployment ────────────────────────────────────────────────────────────────

export function Deployment() {
  return (
    <section id="deployment" className="scroll-mt-20 space-y-6">
      <SectionHeading id="deployment" icon={Server}>Deployment</SectionHeading>

      <DocCard>
        <SubHeading>Docker</SubHeading>
        <ProseP>
          Images are published to Docker Hub as <Code>dinhdobathi/gitdash</Code>: <Code>latest</Code> follows{" "}
          <Code>main</Code>, and every release adds <Code>4.5.2</Code>-style and <Code>4.5</Code>-style tags.
        </ProseP>
        <Tabs items={["Standalone", "Organization", "Docker Compose"]}>
          <Tab>
            <CodeBlock language="bash">
              {`docker run -d --name gitdash -p 3000:3000 \\
  -e MODE=standalone \\
  -e SESSION_SECRET=your_32_char_secret_here \\
  --restart unless-stopped \\
  dinhdobathi/gitdash:latest`}
            </CodeBlock>
          </Tab>
          <Tab>
            <CodeBlock language="bash">
              {`docker run -d --name gitdash -p 3000:3000 \\
  -e MODE=organization \\
  -e SESSION_SECRET=your_32_char_secret_here \\
  -e GITHUB_CLIENT_ID=... -e GITHUB_CLIENT_SECRET=... \\
  -e DATABASE_URL=postgres://... \\
  -e GITDASH_ADMIN_GITHUB_IDS=12345678 \\
  -e NEXT_PUBLIC_APP_URL=https://gitdash.example.com \\
  --restart unless-stopped \\
  dinhdobathi/gitdash:latest`}
            </CodeBlock>
          </Tab>
          <Tab>
            <ProseP>The repository&apos;s <Code>docker-compose.yml</Code> builds the image locally and reads <Code>.env.local</Code>:</ProseP>
            <CodeBlock language="bash" filename="terminal">
              {`cp .env.local.example .env.local   # fill in your values
docker compose up --build -d
docker compose logs -f
docker compose down`}
            </CodeBlock>
          </Tab>
        </Tabs>
      </DocCard>

      <DocCard>
        <SubHeading>Kubernetes (Helm)</SubHeading>
        <CodeBlock language="bash" filename="terminal">
          {`helm upgrade --install gitdash ./helm/gitdash -n gitdash --create-namespace -f my-values.yaml`}
        </CodeBlock>
        <ProseP>
          Everything is set in <Code>helm/gitdash/values.yaml</Code>. For organization mode set{" "}
          <Code>config.mode</Code>, <Code>config.adminGithubIds</Code> (a quoted string of numeric ids),{" "}
          <Code>config.allowedOrgs</Code>, <Code>config.rbacEnforce</Code> and <Code>secret.databaseUrl</Code>. The
          chart&apos;s values schema rejects organization mode without admin ids, and the image tag defaults to the
          chart&apos;s <Code>appVersion</Code>.
        </ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Vercel</SubHeading>
        <Steps>
          <Step title="Import the repository" step={1}>New Project → Import Git Repository.</Step>
          <Step title="Set environment variables" step={2}>
            Add them under Settings → Environment Variables. Changes only apply to new deployments — redeploy after
            editing.
          </Step>
          <Step title="Point the OAuth App at Vercel" step={3}>
            Set the callback URL to <Code>https://your-domain/api/auth/callback</Code>. Use one canonical host: the
            sign-in cookie belongs to the host that started sign-in.
          </Step>
        </Steps>
        <Callout type="info">
          <Code>vercel.json</Code> schedules the two nightly sync crons; they need <Code>CRON_SECRET</Code> and{" "}
          <Code>GITHUB_TOKEN</Code>.
        </Callout>
      </DocCard>

      <DocCard>
        <SubHeading>Behind a reverse proxy</SubHeading>
        <ProseP>
          Set <Code>NEXT_PUBLIC_APP_URL</Code> to the public URL, update the OAuth App callback to match, and forward{" "}
          <Code>X-Forwarded-Proto</Code> and <Code>X-Forwarded-Host</Code>. Health probes can use{" "}
          <Code>/api/health</Code>, which answers 503 while required configuration is missing.
        </ProseP>
      </DocCard>
    </section>
  );
}

// ── Configuration ─────────────────────────────────────────────────────────────

const REQ = <span className="text-status-fail-text font-medium text-xs">Required</span>;
const ORG = <span className="text-status-warn-text font-medium text-xs">Organization</span>;
const OPT = <span className="text-faint text-xs">Optional</span>;

export function Configuration() {
  return (
    <section id="configuration" className="scroll-mt-20 space-y-6">
      <SectionHeading id="configuration" icon={Settings2}>Configuration</SectionHeading>

      <ProseP>
        Everything is configured with environment variables. <Code>.env.local.example</Code> in the repository lists
        them all with comments; the tables below explain what each one is for.
      </ProseP>

      <DocCard>
        <SubHeading>Core</SubHeading>
        <DocTable
          headers={["Variable", "", "Purpose"]}
          rows={[
            [<Code key="1">SESSION_SECRET</Code>, REQ, "At least 32 characters; encrypts the session cookie. The app refuses to start in production without it."],
            [<Code key="2">MODE</Code>, OPT, <><Code key="s">standalone</Code> (default) or <Code key="o">organization</Code>.</>],
            [<Code key="3">NEXT_PUBLIC_APP_URL</Code>, OPT, "Public URL; used for OAuth redirects, same-origin checks, and the canonical and social-card URLs of public pages. Static pages read it at build time, so pass it to the image build as well when those URLs matter."],
          ]}
        />
      </DocCard>

      <DocCard>
        <SubHeading>Organization mode and access control</SubHeading>
        <DocTable
          headers={["Variable", "", "Purpose"]}
          rows={[
            [<Code key="1">GITHUB_CLIENT_ID</Code>, ORG, "OAuth App client id (Continue with GitHub)."],
            [<Code key="2">GITHUB_CLIENT_SECRET</Code>, ORG, "OAuth App client secret."],
            [<Code key="3">DATABASE_URL</Code>, ORG, "Postgres connection string: users, groups, grants, audit, alerts, reports, shared cache."],
            [<Code key="4">GITDASH_ADMIN_GITHUB_IDS</Code>, ORG, "Comma-separated numeric GitHub ids that are always admins."],
            [<Code key="5">GITDASH_ALLOWED_ORGS</Code>, OPT, "Comma-separated orgs whose active members may sign in; empty means any GitHub account (it lands on /pending)."],
            [<Code key="6">GITDASH_RBAC_ENFORCE</Code>, OPT, <><Code key="t">true</Code> enforces group permissions; <Code key="f">false</Code> (default) keeps everyone&apos;s access during rollout.</>],
            [<Code key="7">GITDASH_LANDING_PAGE</Code>, OPT, <><Code key="t">true</Code> shows the /welcome product page to signed-out visitors at /, with Sign in leading to /login. For the public product site; leave unset when self-hosting.</>],
          ]}
        />
      </DocCard>

      <DocCard>
        <SubHeading>Sync, webhooks and caching</SubHeading>
        <DocTable
          headers={["Variable", "", "Purpose"]}
          rows={[
            [<Code key="1">GITHUB_TOKEN</Code>, OPT, "Server token for the nightly sync crons, which run without a user session."],
            [<Code key="2">CRON_SECRET</Code>, OPT, "Bearer token for /api/cron/*; the routes answer 401 without it."],
            [<Code key="3">GITHUB_WEBHOOK_SECRET</Code>, OPT, "Verifies /api/webhooks/github signatures; without it every webhook is rejected."],
            [<Code key="4">GITDASH_L2_CACHE</Code>, OPT, <><Code key="z">0</Code> keeps the API cache in memory only (default: shared Postgres cache when a database is set).</>],
            [<Code key="5">GITDASH_GH_LOG</Code>, OPT, <><Code key="o">1</Code> logs every GitHub call with its route and remaining budget.</>],
          ]}
        />
      </DocCard>

      <DocCard>
        <SubHeading>Email</SubHeading>
        <DocTable
          headers={["Variable", "", "Purpose"]}
          rows={[
            [<><Code key="1">RESEND_API_KEY</Code>, <Code key="2">RESEND_FROM</Code></>, OPT, "Email delivery through Resend (preferred)."],
            [<><Code key="3">SMTP_HOST</Code>, <Code key="4">SMTP_USER</Code>, <Code key="5">SMTP_PASS</Code>, <Code key="6">SMTP_FROM</Code></>, OPT, <>Generic SMTP instead of Resend (or <Code key="s">SENDGRID_API_KEY</Code>). Admins can also set email in Settings → Email and digests.</>],
          ]}
        />
      </DocCard>

      <DocCard>
        <SubHeading>AI insights</SubHeading>
        <ProseP>
          Optional. Without a key every AI surface is hidden. Providers are tried in this order and any without a key
          is skipped; in organization mode an admin can also set a provider in Settings → AI provider.
        </ProseP>
        <DocTable
          headers={["Variable", "Purpose"]}
          rows={[
            [<><Code key="1">BAILIAN_API_KEY</Code>, <Code key="2">BAILIAN_MODEL</Code>, <Code key="3">BAILIAN_BASE_URL</Code></>, "Alibaba Cloud Bailian (Anthropic Messages API)."],
            [<><Code key="4">GEMINI_API_KEY</Code>, <Code key="5">GEMINI_MODEL</Code></>, "Google Gemini."],
            [<><Code key="6">QWEN_API_KEY</Code>, <Code key="7">QWEN_MODEL</Code></>, "Qwen via DashScope."],
            [<Code key="8">AI_DISABLED</Code>, <><Code key="t">true</Code> turns every AI surface off regardless of keys.</>],
            [<><Code key="9">AI_TIMEOUT_MS</Code>, <Code key="10">AI_TOTAL_BUDGET_MS</Code>, <Code key="11">AI_DAILY_TOKEN_BUDGET</Code></>, "Per-attempt timeout, per-request time budget and a per-instance daily token cap."],
          ]}
        />
      </DocCard>

      <DocCard>
        <SubHeading>Signed-in MCP (AI apps)</SubHeading>
        <ProseP>
          Off by default. It lets an AI app such as Claude or Cursor sign in through GitHub and read your repositories
          at <Code>/mcp/me</Code>, read-only. It needs <Code>MODE=organization</Code>, a database, and{" "}
          <Code>NEXT_PUBLIC_APP_URL</Code>, which must match the address people use; with it unset or different, the
          endpoints answer 503 instead of issuing tokens. See <Link href="/docs/mcp" className="text-link hover:text-violet-200">MCP server</Link> for how
          people connect.
        </ProseP>
        <DocTable
          headers={["Variable", "", "Purpose"]}
          rows={[
            [<Code key="1">GITDASH_MCP</Code>, OPT, <><Code key="t">true</Code> turns on <Code key="m">/mcp/me</Code>, the OAuth endpoints under <Code key="o">/oauth</Code> and the Connected apps screens. Helm: <Code key="h">config.mcp</Code>.</>],
            [<Code key="2">MCP_ALLOW_DCR</Code>, OPT, <><Code key="t">true</Code> also accepts Dynamic Client Registration for apps that cannot publish a client metadata document. Default off.</>],
            [<Code key="3">MCP_NATIVE_SCHEMES</Code>, OPT, <>Comma-separated custom redirect schemes allowed for desktop apps, for example <Code key="c">cursor,vscode</Code>. Default none; <Code key="h">http</Code>, <Code key="s">https</Code>, <Code key="j">javascript</Code> and similar are always refused.</>],
            [<Code key="4">MCP_PREVIOUS_SESSION_SECRET</Code>, OPT, <>When you rotate <Code key="s">SESSION_SECRET</Code>, put the old value here for 30 days, the longest an app token lives, so connected apps keep working; then remove it.</>],
          ]}
        />
        <ProseP>
          Add a second callback URL to the same GitHub OAuth App: <Code>&lt;origin&gt;/api/auth/callback/mcp</Code>,
          next to the existing <Code>&lt;origin&gt;/api/auth/callback</Code>. The web sign-in now names its callback
          explicitly, so both keep working.
        </ProseP>
        <ProseP>
          Expired and revoked grants are deleted by the retention job. <Code>/api/cron/sync</Code> runs it, so
          self-hosted installs that already schedule that cron need nothing more; without the cron, old rows stay until
          you run it.
        </ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Demo data</SubHeading>
        <ProseP>
          <Code>NEXT_PUBLIC_DEMO_MODE=true</Code> (or <Code>?demo=1</Code> on a page) replaces GitHub data with a
          fictional organization, for screenshots and trials. You still sign in.
        </ProseP>
      </DocCard>
    </section>
  );
}
