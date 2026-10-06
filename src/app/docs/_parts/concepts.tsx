"use client";

import { Cpu, GitBranch, Gauge, Shield, UsersRound } from "lucide-react";
import { Callout } from "@/components/docs/Callout";
import { CodeBlock, Code } from "@/components/docs/CodeBlock";
import { DocCard, DocTable } from "@/components/docs/DocCard";
import { Steps, Step } from "@/components/docs/Steps";
import { SectionHeading, SubHeading, ProseP, ScreenshotSlot } from "./primitives";

// ── Auth modes ────────────────────────────────────────────────────────────────

export function Modes() {
  return (
    <section id="modes" className="scroll-mt-20 space-y-6">
      <SectionHeading id="modes" icon={GitBranch}>Auth modes</SectionHeading>

      <ProseP>
        GitDash runs in one of two modes, chosen with the <Code>MODE</Code> environment variable. The mode decides how
        people sign in, whether a database is needed, and who controls which features each person sees.
      </ProseP>

      <DocCard>
        <SubHeading>Standalone vs. organization</SubHeading>
        <DocTable
          headers={["", "Standalone (default)", "Organization"]}
          rows={[
            ["Who it is for", "One person, one token", "A team sharing one deployment"],
            ["Sign in", <>Personal access token on <Code key="s">/setup</Code></>, <>GitHub OAuth or a personal access token on <Code key="l">/login</Code></>],
            ["Database", "Optional", <><Code key="d">DATABASE_URL</Code> required</>],
            ["Who decides what you see", "You, in Settings → My features", "An admin, per group (see Access control)"],
            ["Alerts, Reports, sync", "Not available", "Available"],
            ["Restrict sign-in to your orgs", "—", <Code key="a">GITDASH_ALLOWED_ORGS</Code>],
          ]}
        />
      </DocCard>

      <DocCard>
        <SubHeading>Sign-in</SubHeading>
        <ProseP>
          In organization mode the sign-in page offers <strong className="text-fg">Continue with GitHub</strong> (the
          OAuth App) and a personal-access-token form. Both end in the same place: GitDash asks GitHub who the token
          belongs to and keys everything — groups, grants, audit entries — on that account&apos;s numeric GitHub id,
          never on anything the browser sends.
        </ProseP>
        <ScreenshotSlot file="login.jpg" alt="GitDash sign-in page with GitHub and personal access token options" />
      </DocCard>

      <DocCard>
        <SubHeading>Switching modes</SubHeading>
        <ProseP>
          Change <Code>MODE</Code> and restart. A GitHub (OAuth) session does not carry over to standalone mode, so
          people signed in that way sign in again with a token. Moving to organization mode also needs the settings
          listed under Access control.
        </ProseP>
      </DocCard>
    </section>
  );
}

// ── Access control (organization mode) ───────────────────────────────────────

export function AccessControl() {
  return (
    <section id="access-control" className="scroll-mt-20 space-y-6">
      <SectionHeading id="access-control" icon={UsersRound} badge="Organization mode">Access control</SectionHeading>

      <ProseP>
        In organization mode an admin decides who sees which features. Features are the same switches people used to
        flip for themselves in Settings; now an admin grants them per group, and the server enforces the grant.
      </ProseP>

      <DocCard>
        <SubHeading>The model</SubHeading>
        <DocTable
          headers={["Concept", "How it works"]}
          rows={[
            ["Identity", "The numeric GitHub id of the signed-in token, looked up from GitHub on every request (cached for a minute)."],
            ["Groups", <>Fixed: <Code key="g1">admin</Code>, <Code key="g2">devops</Code>, <Code key="g3">security</Code>, <Code key="g4">dev</Code>, <Code key="g5">pm</Code>. A person can be in several.</>],
            ["Grants", "An admin turns features on per group. A person gets every feature any of their groups has."],
            ["Admins", <>Members of <Code key="ad">admin</Code> get every feature and the admin screens. Ids in <Code key="ai">GITDASH_ADMIN_GITHUB_IDS</Code> are always admins, even with no group row.</>],
            ["No group", "Signed in, but no access: the person waits on /pending until an admin adds them to a group."],
            ["Personal choice", "People can still switch off features they were granted, in Settings → My features. They can never switch on a feature they were not granted."],
          ]}
        />
      </DocCard>

      <DocCard>
        <SubHeading>Managing access</SubHeading>
        <ProseP>
          Admins manage access in <strong className="text-fg">Admin</strong> (sidebar) or in{" "}
          <strong className="text-fg">Settings → Access by group / Members / Audit log</strong> — both edit the same
          data. Every change is written to the audit log with who made it and what changed.
        </ProseP>
        <ScreenshotSlot file="admin-users.jpg" alt="Admin: users and their groups" />
        <ScreenshotSlot file="admin-permissions.jpg" alt="Admin: features granted to each group" />
        <ScreenshotSlot file="admin-audit.jpg" alt="Admin: audit log of access changes" />
        <Callout type="info">
          The last admin cannot be removed: a change that would leave nobody in <Code>admin</Code> (apart from the ids
          in <Code>GITDASH_ADMIN_GITHUB_IDS</Code>) is refused.
        </Callout>
      </DocCard>

      <DocCard>
        <SubHeading>Waiting for access</SubHeading>
        <ProseP>
          Someone who signs in without a group lands on <Code>/pending</Code>. The page shows their GitHub login and
          numeric id to send to an admin, checks again every 15 seconds, and moves on by itself once a group is granted
          — usually within a minute, because group lookups are cached for 60 seconds.
        </ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Enforcement</SubHeading>
        <ProseP>
          Every request passes through <Code>src/proxy.ts</Code>, which classifies the route and checks the grant
          before the route runs. A feature&apos;s pages redirect and its API routes answer 403 without the grant — also
          when called directly. API routes that are not registered are denied. Grants and revocations reach new
          requests within 60 seconds.
        </ProseP>
        <ProseP>
          The grant decides which <em>GitDash features</em> someone can use; it never widens what their own GitHub
          token can read. Data GitDash serves from its own database (Reports, alert rules) is filtered by what the
          viewer&apos;s token can see on GitHub.
        </ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Settings and rollout</SubHeading>
        <CodeBlock language="bash" filename=".env">
          {`DATABASE_URL=postgres://...        # required: users, groups, grants and the audit log
GITDASH_ADMIN_GITHUB_IDS=12345678   # required: numeric ids (gh api user --jq .id), comma-separated
GITDASH_ALLOWED_ORGS=my-org         # optional: only active members of these orgs may sign in
GITDASH_RBAC_ENFORCE=false          # rollout switch; set true once groups are assigned`}
        </CodeBlock>
        <Steps>
          <Step title="Deploy with enforcement off" step={1}>
            With <Code>GITDASH_RBAC_ENFORCE</Code> unset or <Code>false</Code>, everyone keeps full access; only the
            admin screens are restricted. The app refuses to start in organization mode without{" "}
            <Code>DATABASE_URL</Code> and a valid <Code>GITDASH_ADMIN_GITHUB_IDS</Code>, and <Code>/api/health</Code>{" "}
            answers 503.
          </Step>
          <Step title="Let people sign in, then assign" step={2}>
            Grant features to groups, then put people in groups. New sign-ins appear in the users list automatically.
          </Step>
          <Step title="Turn enforcement on" step={3}>
            Set <Code>GITDASH_RBAC_ENFORCE=true</Code> and redeploy. On Vercel, environment variable changes only apply
            to new deployments.
          </Step>
        </Steps>
      </DocCard>

      <DocCard>
        <SubHeading>When sign-in is refused</SubHeading>
        <ProseP>
          With <Code>GITDASH_ALLOWED_ORGS</Code> set, GitDash asks GitHub whether the account is an active member. If
          GitHub will not say, sign-in is refused — GitDash cannot tell a member from a stranger — and the server log
          records GitHub&apos;s reason.
        </ProseP>
        <DocTable
          headers={["Cause", "Fix"]}
          rows={[
            ["The org restricts OAuth Apps (every “Continue with GitHub” sign-in fails)", "An org owner approves the GitDash OAuth App in the org's Third-party access settings. Unapproved, the app also cannot read the org's private repositories."],
            ["A fine-grained PAT created under the user", <>Create it with the <strong key="o">organization as resource owner</strong> and grant <Code key="m">Members: read</Code>. If the org approves fine-grained tokens, an owner must approve it first.</>],
            ["A classic PAT the org does not accept", <>It needs <Code key="r">read:org</Code>; some orgs also reject classic tokens that live longer than 366 days.</>],
          ]}
        />
      </DocCard>
    </section>
  );
}

// ── Caching and rate limits ───────────────────────────────────────────────────

export function Caching() {
  return (
    <section id="caching" className="scroll-mt-20 space-y-6">
      <SectionHeading id="caching" icon={Gauge}>Caching &amp; rate limits</SectionHeading>

      <ProseP>
        Every GitHub token has an hourly budget (5,000 requests for most tokens). Dashboards fan out into many calls, so
        GitDash caches GitHub reads in layers and shows the remaining budget at the bottom of the sidebar.
      </ProseP>

      <DocCard>
        <SubHeading>Layers</SubHeading>
        <DocTable
          headers={["Layer", "What it does"]}
          rows={[
            ["In-memory (per instance)", "Each GitHub route caches its result per token for its own lifetime — most for 5 minutes, fast-moving data for 15–60 seconds. Identical requests already in flight share one GitHub call."],
            ["Shared Postgres (api_cache)", <>With <Code key="d">DATABASE_URL</Code> set, results are also stored in Postgres so every replica reuses them. Lookups give up after 300 ms and a failing database is bypassed, so the cache never slows a page down. <Code key="l">GITDASH_L2_CACHE=0</Code> turns it off.</>],
            ["Browser", <>Responses are private to the signed-in user (<Code key="v">Vary: Cookie</Code>); pages polled for live status are not browser-cached.</>],
          ]}
        />
        <Callout type="info">
          Cache entries are keyed by a hash of the token, never the token itself, so one person&apos;s cached data —
          which reflects their private-repo access — is never served to someone else.
        </Callout>
      </DocCard>

      <DocCard>
        <SubHeading>Refresh</SubHeading>
        <ProseP>
          The refresh button in the top bar bypasses every layer and fetches live data from GitHub. Use it when you
          need a result from the last few minutes; otherwise the cache keeps the budget for everyone.
        </ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Seeing where the budget goes</SubHeading>
        <ProseP>
          Set <Code>GITDASH_GH_LOG=1</Code> to log every GitHub call with the route that made it and the remaining
          budget. The server also warns once per token when the budget runs low.
        </ProseP>
      </DocCard>
    </section>
  );
}

// ── Security model ────────────────────────────────────────────────────────────

export function Security() {
  return (
    <section id="security" className="scroll-mt-20 space-y-6">
      <SectionHeading id="security" icon={Shield}>Security model</SectionHeading>

      <Callout type="success" title="Your token never reaches the browser">
        The GitHub token (PAT or OAuth) lives in an encrypted, HTTP-only session cookie that only the server can read.
        Pages call GitDash&apos;s own API; the server calls GitHub.
      </Callout>

      <DocCard>
        <SubHeading>Request flow</SubHeading>
        <CodeBlock language="text">
          {`Browser ── /api/... ──► proxy.ts
                          │  decrypts the session cookie
                          │  no session        → /login or /setup (pages), 401 (API)
                          │  organization mode → identity + groups, then the route's grant
                          ▼
                     API route ── token from the session ──► GitHub REST API
                          │
                          ▼
                     JSON response (never contains the token)`}
        </CodeBlock>
      </DocCard>

      <DocCard>
        <SubHeading>Protection layers</SubHeading>
        <DocTable
          headers={["Layer", "Mechanism"]}
          rows={[
            ["Session", <>iron-session (AES-256-CBC + HMAC-SHA256); cookie is <Code key="h">HttpOnly</Code>, <Code key="s">SameSite=Lax</Code>, <Code key="sc">Secure</Code> in production, 7-day lifetime. <Code key="ss">SESSION_SECRET</Code> must be at least 32 characters.</>],
            ["Sign-in", "The session is replaced on every sign-in, so an old session cannot carry over to a new account."],
            ["Cross-site requests", "State-changing API requests from another origin are rejected; token sign-in only accepts JSON from GitDash's own pages."],
            ["Rate limits", <><Code key="a">/api/auth/setup</Code> 5 per minute per IP · <Code key="b">/api/auth/login</Code> 10 per minute · issue creation 5 per hour</>],
            ["Input validation", <>Owner, repo and org parameters are validated before any GitHub call (<Code key="v">src/lib/validation.ts</Code>).</>],
            ["Authorization", "Organization mode checks the route's grant on the server for every request (see Access control)."],
            ["Secrets in responses", "Alert destinations (webhooks, email) and AI/email settings are visible to admins only in organization mode."],
            ["HTTP headers", "Content-Security-Policy, HSTS, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy."],
            ["Container", <>Runs as the non-root <Code key="u">nextjs</Code> user on <Code key="n">node:20-alpine</Code>.</>],
          ]}
        />
      </DocCard>
    </section>
  );
}

// ── Data sources ──────────────────────────────────────────────────────────────

export function CoreConcepts() {
  return (
    <section id="core-concepts" className="scroll-mt-20 space-y-6">
      <SectionHeading id="core-concepts" icon={Cpu}>Data sources</SectionHeading>

      <DocCard>
        <SubHeading>Live GitHub data</SubHeading>
        <ProseP>
          Almost every screen reads GitHub live through GitDash&apos;s API, with the signed-in person&apos;s own token and
          the cache described in Caching &amp; rate limits. Nothing is copied into a database to draw these screens, so
          what you see always matches what your token can see on GitHub.
        </ProseP>
      </DocCard>

      <DocCard>
        <SubHeading>Historical data (organization mode)</SubHeading>
        <ProseP>
          With a database, GitDash also keeps its own history. It powers Reports and the alert engine, and it outlives
          GitHub&apos;s run retention.
        </ProseP>
        <DocTable
          headers={["Source", "When", "Needs"]}
          rows={[
            [<Code key="c1">/api/cron/sync</Code>, "Daily at 03:17 UTC (Vercel Cron): workflow runs, then alert evaluation", <><Code key="t">GITHUB_TOKEN</Code>, <Code key="c">CRON_SECRET</Code></>],
            [<Code key="c2">/api/cron/sync-pr-facts</Code>, "Daily at 04:17 UTC: pull-request facts for the people-metric alerts", <><Code key="t2">GITHUB_TOKEN</Code>, <Code key="c3">CRON_SECRET</Code></>],
            [<Code key="c4">/api/cron/sync-commit-facts</Code>, "Daily at 04:47 UTC: commits of merged pull requests for working habits, then the oversized-commit alert", <><Code key="t3">GITHUB_TOKEN</Code>, <Code key="c5">CRON_SECRET</Code></>],
            [<Code key="w">/api/webhooks/github</Code>, <>Instantly, for each <Code key="e">workflow_run</Code> event</>, <Code key="s">GITHUB_WEBHOOK_SECRET</Code>],
            ["Reports → Sync now", "On demand (admins in organization mode)", "A signed-in session"],
          ]}
        />
        <Callout type="info">
          The sync uses the server&apos;s <Code>GITHUB_TOKEN</Code>, which usually sees more than any one person. Before
          serving synced data, GitDash checks that the viewer&apos;s own token can see the repository or organization.
        </Callout>
      </DocCard>
    </section>
  );
}
