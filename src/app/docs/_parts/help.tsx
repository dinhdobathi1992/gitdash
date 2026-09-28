"use client";

import { HelpCircle, Terminal, GitPullRequest, CheckCircle } from "lucide-react";
import { CodeBlock, Code } from "@/components/docs/CodeBlock";
import { DocCard } from "@/components/docs/DocCard";
import { Steps, Step } from "@/components/docs/Steps";
import { SectionHeading, SubHeading } from "./primitives";

export function FAQ() {
  const items = [
    {
      q: "Organization mode: sign-in says the account is not a member of an allowed organization.",
      a: <>With <Code>GITDASH_ALLOWED_ORGS</Code> set, GitDash asks GitHub whether the account is an active member; if GitHub will not say, sign-in is refused and the server log shows GitHub&apos;s reason. Usual causes: the org has <strong className="text-white">OAuth App access restrictions</strong> and has not approved the GitDash OAuth App (an org owner approves it under the org&apos;s Third-party access settings); a <strong className="text-white">fine-grained PAT</strong> whose resource owner is the user instead of the org, or that lacks <Code>Members: read</Code> or is still awaiting org approval; a <strong className="text-white">classic PAT</strong> without <Code>read:org</Code>, or one the org rejects for living longer than 366 days.</>,
    },
    {
      q: "Organization mode: I was added to a group but still see the waiting page.",
      a: <>Group lookups are cached for 60 seconds. The waiting page checks every 15 seconds and moves on by itself once the grant is visible, so allow up to a minute. It also shows your GitHub login and numeric id to send to an admin.</>,
    },
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
      a: <>The sign-in cookie belongs to the host that started sign-in, so GitHub must send you back to that same host: if the app answers on several hosts (an apex domain, <Code>www</Code>, a <Code>*.vercel.app</Code> URL), start sign-in on the host in the OAuth App&apos;s callback URL, and redirect the others to it. State tokens also expire after 5 minutes — start again with Continue with GitHub if authorizing took longer.</>,
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
      a: <>Read the release notes first — some releases need new settings. Then pull the image (<Code>docker pull dinhdobathi/gitdash:latest</Code>, or a version tag) and restart; with Helm, upgrade the chart; self-built deployments pull the latest commit and rebuild. Database migrations run automatically on start.</>,
    },
    {
      q: "Can I use a fine-grained PAT instead of a classic PAT?",
      a: <>Yes. Grant read access to Actions, Contents, Metadata and Pull requests on the repositories you want. A fine-grained token belongs to one resource owner: for an organization&apos;s repositories, create it with the <strong className="text-fg">organization</strong> as owner and add <Code>Members: read</Code> if sign-in is limited with <Code>GITDASH_ALLOWED_ORGS</Code>.</>,
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
    <section id="faq" className="scroll-mt-20 space-y-6">
      <SectionHeading id="faq" icon={HelpCircle}>FAQ &amp; Troubleshooting</SectionHeading>
      <div className="space-y-3">
        {items.map((item, i) => (
          <DocCard key={i}>
            <div className="flex items-start gap-3">
              <Terminal className="w-4 h-4 mt-0.5 text-violet-400 shrink-0" />
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-white">{item.q}</p>
                <div className="text-sm text-slate-400 leading-relaxed">{item.a}</div>
              </div>
            </div>
          </DocCard>
        ))}
      </div>
    </section>
  );
}

export function Contributing() {
  return (
    <section id="contributing" className="scroll-mt-20 space-y-6">
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
          <Step title="Check your change" step={4}>
            <CodeBlock language="bash" filename="terminal">
              {`pnpm run lint
pnpm exec tsc --noEmit
pnpm run test          # vitest; database tests use an in-memory Postgres (PGlite)
pnpm run build`}
            </CodeBlock>
          </Step>
        </Steps>
      </DocCard>

      <DocCard>
        <SubHeading>Where things live</SubHeading>
        <CodeBlock language="text">
          {`src/app/                 pages (one folder per route)
src/app/api/             API routes: github/*, db/*, alerts, admin/*, auth/*, cron/*, webhooks/*
src/proxy.ts             sign-in and access checks for every request
src/lib/permissions.ts   route → feature registry used by the proxy
src/lib/                 GitHub client, caching, database, identity, AI
src/components/          UI; the docs page is src/app/docs with sections in _parts/
tests/                   vitest suites
helm/gitdash/            Helm chart`}
        </CodeBlock>
      </DocCard>

      <DocCard>
        <SubHeading>PR Guidelines</SubHeading>
        <ul className="space-y-2 text-sm text-slate-300">
          {[
            "Register every new API route in src/lib/permissions.ts — unregistered routes are denied — and give it the feature that should gate it",
            "Validate owner, repo and org parameters with src/lib/validation.ts before calling GitHub",
            "Wrap new GitHub reads in the shared cache, keyed per token",
            "Update this documentation and CHANGELOG.md with any user-visible change",
            "Never log or return credentials; CI runs lint, type check, tests, build, CodeQL and a dependency audit",
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
