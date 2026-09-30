/**
 * /welcome — public product landing page. Full-page route (no app shell) and
 * public in src/proxy.ts, so visitors see it without signing in. Product
 * visuals are illustrations with example data (components/landing).
 */

import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, BarChart3, BellRing, Check, CircleDollarSign, Download, FileBarChart,
  Gauge, GitCommitHorizontal, GitPullRequest, KeyRound, Keyboard, LockKeyhole, Play, Server, ShieldCheck,
  Smartphone, Sparkles, Users, Workflow,
} from "lucide-react";
import { LogoMark, APP_VERSION } from "@/components/shell/Logo";
import { AuthBackdrop } from "@/components/auth/AuthLayout";
import {
  AiSummaryCard, AlertsMock, CostMock, DoraMock, HeroConsole, TeamMock, WorkflowMock,
} from "@/components/landing/ProductMocks";
import { VideoShowcase } from "@/components/landing/VideoShowcase";
import { DeployTabs } from "@/components/landing/DeployTabs";

export const metadata: Metadata = {
  title: "GitDash — Everything metrics, measured.",
  description:
    "DORA, reliability, cost and team health from your GitHub Actions runs and pull requests — self-hosted, open source, on infrastructure you run yourself.",
};

const REPO_URL = "https://github.com/dinhdobathi1992/gitdash";
/** Where "Talk to us" goes. Replace with the sales inbox or booking link before launch. */
const CONTACT_HREF = `${REPO_URL}/issues/new?title=GitDash%20for%20my%20team`;

function GitHubMark({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

const PRIMARY_CTA =
  "inline-flex items-center justify-center gap-2 h-12 px-6 rounded-[12px] bg-primary text-white text-[15px] font-semibold hover:brightness-110 transition-[filter] duration-100";
const SECONDARY_CTA =
  "inline-flex items-center justify-center gap-2 h-12 px-6 rounded-[12px] border border-control bg-surface/80 text-fg text-[15px] font-semibold hover:bg-raised transition-colors duration-100";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-link">{children}</p>;
}

function SectionHeading({ eyebrow, title, accent, lead, center }: {
  eyebrow: string;
  title: string;
  accent?: string;
  lead?: string;
  center?: boolean;
}) {
  return (
    <div className={center ? "text-center mx-auto max-w-[760px]" : "max-w-[820px]"}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-[32px] sm:text-[44px] leading-[1.05] font-semibold tracking-[-0.035em] text-fg">
        {title}{accent && <> <span className="text-link">{accent}</span></>}
      </h2>
      {lead && <p className="mt-5 text-[17px] leading-7 text-muted">{lead}</p>}
    </div>
  );
}

// ── Content ────────────────────────────────────────────────────────────────

const NAV = [
  { href: "#tour", label: "Tour" },
  { href: "#features", label: "Features" },
  { href: "#trust", label: "Security" },
  { href: "#deploy", label: "Deploy" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const PAINS = [
  {
    q: "“Why is CI so slow this week?”",
    a: "p95 duration and queue wait per repository, the slowest jobs and steps, and the exact run where it changed.",
  },
  {
    q: "“Are we actually shipping faster?”",
    a: "The DORA four keys for every repository, rated Elite to Low, measured from deployments or estimated from merged pull requests.",
  },
  {
    q: "“Who is carrying the reviews?”",
    a: "Reviewer bus factor, who reviews whom, merges with no human review and workload outside the org workday.",
  },
];

const SHOWCASE = [
  {
    eyebrow: "Delivery",
    title: "DORA for every repository.",
    body: "Deploy frequency, lead time, change failure rate and time to restore — each with a rating, a trend and a worded change. Drill into cycle time, PR size against speed, throughput and stability.",
    points: ["Measured from GitHub Deployments, or estimated from releases and merged PRs", "Org-wide health scorecard across every repository", "Says how each number is measured, right next to it"],
    Mock: DoraMock,
  },
  {
    eyebrow: "Workflow intelligence",
    title: "Why it fails. Where the time goes.",
    body: "Open any workflow to see failure hypotheses ranked by likelihood, the jobs and steps that eat the most minutes, flaky branches, anomalies and concrete ways to make it faster.",
    points: ["Last runs with duration, outcome and p95 line", "Slowest jobs and steps, trigger breakdown", "Export any table as CSV or JSON"],
    Mock: WorkflowMock,
  },
  {
    eyebrow: "Team insights",
    title: "Healthy teams, not just fast ones.",
    body: "One 30- or 90-day window per repository that leads with what stands out, worst first: review concentration, merges nobody reviewed, stale pull requests and who is working late.",
    points: ["Reviewer bus factor and who-reviews-whom heatmap", "Working habits: oversized commits and PRs per engineer", "Contributor profiles and a printable 1:1 prep sheet"],
    Mock: TeamMock,
  },
  {
    eyebrow: "Cost",
    title: "Spend, explained.",
    body: "Your real GitHub Actions bill by day, runner type and repository, a month-end projection, and savings estimates you can act on today.",
    points: ["Daily spend stacked by Linux, macOS and Windows", "Projection for the rest of the month", "Concrete moves ranked by what they save"],
    Mock: CostMock,
  },
  {
    eyebrow: "Alerts",
    title: "Alerts in plain language.",
    body: "Write a rule the way you would say it. GitDash watches CI and people metrics and tells the right channel — with the reason attached, not just a red number.",
    points: ["Slack, email, browser or a daily digest", "Weekly leadership digest by email", "Mute for an hour; full delivery history"],
    Mock: AlertsMock,
  },
];

const FEATURES = [
  { i: Gauge, t: "Needs attention first", d: "The home page answers “what is wrong right now?” before anything else.", c: "text-status-fail-text" },
  { i: BarChart3, t: "DORA four keys", d: "Per repository and across the org, with drill-downs and ratings.", c: "text-accent" },
  { i: Workflow, t: "Workflow intelligence", d: "Failure hypotheses, slowest jobs, flaky branches, anomalies.", c: "text-brand-fg" },
  { i: GitPullRequest, t: "Pull request health", d: "Review speed and rounds, stale PRs, reviewer load.", c: "text-status-run-text" },
  { i: Users, t: "Team insights", d: "Bus factor, human reviews, workload against the org workday.", c: "text-status-warn-text" },
  { i: GitCommitHorizontal, t: "Working habits", d: "Oversized commits and PRs per engineer, squash-merge aware.", c: "text-status-pass-text" },
  { i: CircleDollarSign, t: "Actions cost", d: "Spend by day, runner and repo, with a month-end projection.", c: "text-status-pass-text" },
  { i: BellRing, t: "Alerts & digests", d: "Slack, email, browser and a weekly leadership digest.", c: "text-status-warn-text" },
  { i: ShieldCheck, t: "Security", d: "GitHub security alerts and static checks on workflow files.", c: "text-accent" },
  { i: LockKeyhole, t: "Group permissions", d: "Admins grant features per group; every change is audited.", c: "text-brand-fg" },
  { i: Sparkles, t: "AI insights (optional)", d: "Plain-English summaries via Bailian, Gemini or Qwen.", c: "text-link" },
  { i: FileBarChart, t: "Reports & scorecards", d: "Historical reports and an org health scorecard.", c: "text-status-run-text" },
  { i: Keyboard, t: "Keyboard first", d: "⌘K palette, / to filter, ↑ ↓ to move, p to pin.", c: "text-muted" },
  { i: Smartphone, t: "Works on a phone", d: "A real mobile layout, not a shrunken desktop.", c: "text-muted" },
  { i: Download, t: "Export anything", d: "CSV or JSON from workflows, scorecards, contributors, cost.", c: "text-muted" },
  { i: Server, t: "Built for the rate limit", d: "Shared Postgres cache across replicas; live API budget meter.", c: "text-muted" },
];

const TRUST = [
  { i: Server, t: "Runs on your infrastructure", d: "Docker, Kubernetes or Vercel. Your CI data stays in your account — GitDash reads it from GitHub with your own token." },
  { i: KeyRound, t: "Your token never reaches the browser", d: "It lives server-side in an encrypted, HTTP-only session cookie. The browser only ever sees the numbers." },
  { i: LockKeyhole, t: "Enforced on the server", d: "In organization mode every page and API route is checked against the person's group grants. Unregistered routes are denied." },
  { i: ShieldCheck, t: "Audited and open", d: "Every permission change goes to the audit log. The code is MIT-licensed — read every line before you run it." },
];

const PERSONAS = [
  { r: "Engineering managers", d: "Review load, bus factor, stale PRs and a 1:1 prep sheet — the conversations you need, with evidence." },
  { r: "Platform & DevOps leads", d: "Failing and slow pipelines, flaky jobs, runner cost and alerts before developers ask." },
  { r: "CTOs & leadership", d: "DORA across the org, a health scorecard and a weekly digest in your inbox." },
];

const PLANS = [
  {
    name: "Community",
    price: "Free",
    unit: "forever · MIT",
    blurb: "The whole product, self-hosted by you.",
    items: ["Every dashboard and feature", "Standalone or organization mode", "Docker, Helm chart and Vercel", "Community support on GitHub"],
    cta: { label: "Star on GitHub", href: REPO_URL, external: true },
    featured: false,
    comingSoon: false,
  },
  {
    name: "Team",
    price: "Talk to us",
    unit: "setup + support",
    blurb: "We stand it up for your organization and keep it healthy.",
    items: ["Deployed in your cloud, org mode ready", "GitHub OAuth, groups and alerts configured", "Onboarding session for your leads", "Priority support and upgrades"],
    cta: { label: "Talk to us", href: CONTACT_HREF, external: true },
    featured: true,
    comingSoon: false,
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "annual",
    blurb: "For larger engineering orgs with specific needs.",
    items: ["Everything in Team", "Custom metrics and reports", "Security review assistance", "Agreed response times"],
    cta: { label: "Contact us", href: CONTACT_HREF, external: true },
    featured: false,
    /** Shown but not yet sold: badge on the card, no clickable call to action. */
    comingSoon: true,
  },
];

const FAQ = [
  { q: "Where does GitDash get its data?", a: "From the GitHub REST API, using the signed-in person's own token: Actions runs and jobs, pull requests, reviews, releases, deployments and billing. With a database, a nightly sync and the workflow_run webhook also keep history for reports and alerts." },
  { q: "Does my code or CI data leave my infrastructure?", a: "No. GitDash runs where you deploy it and talks only to GitHub. The optional AI insights send metrics and names — never code — to the provider you configure, and are hidden entirely without a key." },
  { q: "Do I need a database?", a: "Not for one person. Standalone mode works with just a personal access token. Organization mode needs Postgres for users, groups, the audit log, alerts, reports and the shared cache." },
  { q: "What token permissions does it need?", a: "A classic token needs repo, workflow, read:org, read:user and user:email. A fine-grained token needs read access to Actions, Contents, Metadata and Pull requests. The Cost page needs the organization's Administration: read." },
  { q: "Will it burn through our GitHub rate limit?", a: "It is built not to. GitHub reads are cached per token and shared across replicas through Postgres, and the sidebar shows how much API budget you have left." },
  { q: "Can people see only what they should?", a: "Yes. In organization mode admins grant features to the Admin, DevOps, Security, Dev and PM groups. New users wait on a pending page until an admin places them, and every change is audited." },
];

// ── Page ───────────────────────────────────────────────────────────────────

export default function WelcomePage() {
  return (
    <div className="min-h-screen bg-ground text-fg [scroll-behavior:smooth]">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-line/80 bg-ground/75 backdrop-blur-md">
        <div className="mx-auto max-w-[1200px] px-5 sm:px-8 h-16 flex items-center gap-6">
          <Link href="/welcome" className="flex items-center gap-2.5 shrink-0">
            <LogoMark size={28} />
            <span className="text-[15px] font-semibold">GitDash</span>
          </Link>
          <nav aria-label="Sections" className="hidden md:flex items-center gap-1">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="h-9 px-3 inline-flex items-center rounded-control text-[13px] text-muted hover:text-fg hover:bg-surface transition-colors duration-100">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex h-9 px-3 items-center gap-2 rounded-control text-[13px] text-muted hover:text-fg">
              <GitHubMark /> GitHub
            </a>
            <Link href="/login" className="hidden sm:inline-flex h-9 px-3 items-center rounded-control text-[13px] text-muted hover:text-fg">
              Sign in
            </Link>
            <a href="#deploy" className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-control bg-primary text-white text-[13px] font-semibold hover:brightness-110">
              Get started <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <AuthBackdrop />
          <div className="relative mx-auto max-w-[1200px] px-5 sm:px-8 pt-16 sm:pt-24 pb-20">
            <div className="text-center max-w-[900px] mx-auto">
              <a href="#features" className="inline-flex items-center gap-2 h-8 pl-1.5 pr-3.5 rounded-full border border-control bg-surface/80 text-[13px] text-muted hover:text-fg">
                <span className="h-5 px-2 inline-flex items-center rounded-full bg-brand-soft font-mono text-xs text-link">v{APP_VERSION}</span>
                Team insights v2 — what stands out, worst first
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
              <h1 className="mt-8 text-[48px] sm:text-[72px] lg:text-[88px] leading-[0.98] font-semibold tracking-[-0.05em]">
                Everything metrics,<br />
                <span className="text-link">measured.</span>
              </h1>
              <p className="mt-7 mx-auto max-w-[620px] text-lg sm:text-xl leading-8 text-muted">
                DORA, reliability, cost and team health from your GitHub Actions runs and pull requests — on infrastructure you run yourself.
              </p>
              <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
                <a href="#tour" className={PRIMARY_CTA}>
                  <Play className="w-4 h-4 fill-current" aria-hidden="true" /> Watch the 90-second tour
                </a>
                <a href="#deploy" className={SECONDARY_CTA}>
                  Deploy it free <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </a>
              </div>
              <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[13px] text-muted">
                {["No credit card, no sign-up", "Open source · MIT", "Self-hosted in minutes"].map((t) => (
                  <li key={t} className="inline-flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-status-pass-text" aria-hidden="true" /> {t}
                  </li>
                ))}
              </ul>
            </div>

            <figure aria-label="Illustration of the GitDash repositories page with example data" className="relative mt-16 mx-auto max-w-[1040px]">
              <div className="absolute -inset-x-10 -inset-y-8 bg-[radial-gradient(60%_60%_at_50%_40%,rgba(124,92,255,0.18),transparent_70%)] pointer-events-none" aria-hidden="true" />
              <div className="relative shadow-float rounded-[16px]">
                <HeroConsole />
              </div>
              <div className="hidden lg:block absolute -right-12 -bottom-10 z-10">
                <AiSummaryCard />
              </div>
            </figure>
          </div>
        </section>

        {/* Fact strip */}
        <section aria-label="At a glance" className="border-y border-line bg-panel/60">
          <dl className="mx-auto max-w-[1200px] px-5 sm:px-8 py-8 grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { v: "4", l: "DORA keys per repository" },
              { v: "16", l: "feature areas in one app" },
              { v: "0", l: "tokens sent to the browser" },
              { v: "3", l: "ways to deploy: Docker, Helm, Vercel" },
            ].map((s) => (
              <div key={s.l}>
                <dt className="sr-only">{s.l}</dt>
                <dd>
                  <span className="block font-mono text-[34px] font-semibold text-fg tracking-tight">{s.v}</span>
                  <span className="block mt-1 text-[13px] text-muted">{s.l}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Problem */}
        <section className="mx-auto max-w-[1200px] px-5 sm:px-8 py-24">
          <SectionHeading
            eyebrow="The problem"
            title="Your CI already knows how your team ships."
            accent="GitDash makes it readable."
            lead="GitHub holds every run, review and deploy — scattered across hundreds of pages. GitDash turns it into the answers engineering leaders actually ask for."
          />
          <div className="mt-12 grid md:grid-cols-3 gap-4">
            {PAINS.map((p) => (
              <div key={p.q} className="card p-6">
                <p className="text-lg font-semibold text-fg">{p.q}</p>
                <p className="mt-3 text-sm leading-6 text-muted">{p.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Video tour */}
        <section id="tour" className="scroll-mt-20 relative border-y border-line bg-panel/40">
          <div className="mx-auto max-w-[1200px] px-5 sm:px-8 py-24">
            <SectionHeading
              eyebrow="Product tour"
              title="See all of GitDash"
              accent="in 90 seconds."
              lead="Every screen, real UI, no slides. Jump straight to the part you care about."
            />
            <div className="mt-12">
              <VideoShowcase />
            </div>
          </div>
        </section>

        {/* Deep dives */}
        <section className="mx-auto max-w-[1200px] px-5 sm:px-8 py-24 space-y-28">
          {SHOWCASE.map(({ eyebrow, title, body, points, Mock }, i) => (
            <div key={title} className="grid gap-10 lg:gap-16 lg:grid-cols-2 items-center">
              <div className={i % 2 ? "lg:order-2" : ""}>
                <Eyebrow>{eyebrow}</Eyebrow>
                <h3 className="mt-3 text-[30px] sm:text-[38px] leading-[1.08] font-semibold tracking-[-0.03em] text-fg">{title}</h3>
                <p className="mt-5 text-[17px] leading-7 text-muted">{body}</p>
                <ul className="mt-6 space-y-3">
                  {points.map((pt) => (
                    <li key={pt} className="flex items-start gap-3 text-[15px] text-fg">
                      <span className="mt-0.5 w-5 h-5 rounded-full bg-brand-soft text-brand-fg inline-flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3" aria-hidden="true" />
                      </span>
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={`min-w-0 ${i % 2 ? "lg:order-1" : ""}`}>
                <Mock />
              </div>
            </div>
          ))}
        </section>

        {/* Feature grid */}
        <section id="features" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto max-w-[1200px] px-5 sm:px-8 py-24">
            <SectionHeading
              center
              eyebrow="Everything included"
              title="One dashboard."
              accent="Every question answered."
              lead="No plugins, no add-ons, no per-seat feature gates. Switch off whatever a team does not need."
            />
            <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-px rounded-[16px] overflow-hidden border border-line bg-line">
              {FEATURES.map(({ i: Icon, t, d, c }) => (
                <div key={t} className="bg-surface p-6 hover:bg-raised/60 transition-colors duration-100">
                  <span className="w-9 h-9 rounded-control border border-control bg-panel inline-flex items-center justify-center">
                    <Icon className={`w-[18px] h-[18px] ${c}`} aria-hidden="true" />
                  </span>
                  <p className="mt-4 text-[15px] font-semibold text-fg">{t}</p>
                  <p className="mt-1.5 text-[13px] leading-5 text-muted">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Personas */}
        <section className="mx-auto max-w-[1200px] px-5 sm:px-8 pb-24">
          <div className="grid md:grid-cols-3 gap-4">
            {PERSONAS.map((p) => (
              <div key={p.r} className="card p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">Built for</p>
                <p className="mt-2 text-lg font-semibold text-fg">{p.r}</p>
                <p className="mt-2 text-sm leading-6 text-muted">{p.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust */}
        <section id="trust" className="scroll-mt-20 relative overflow-hidden border-y border-line bg-panel/40">
          <div className="mx-auto max-w-[1200px] px-5 sm:px-8 py-24 grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start">
            <SectionHeading
              eyebrow="Security & privacy"
              title="Software you run,"
              accent="not a service you trust."
              lead="GitDash runs in your cloud and talks to GitHub — and to an AI provider only if you add a key. Security teams can read every line."
            />
            <div className="grid sm:grid-cols-2 gap-4">
              {TRUST.map(({ i: Icon, t, d }) => (
                <div key={t} className="card p-6">
                  <span className="w-9 h-9 rounded-control bg-status-pass-tint text-status-pass-text inline-flex items-center justify-center">
                    <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
                  </span>
                  <p className="mt-4 text-[15px] font-semibold text-fg">{t}</p>
                  <p className="mt-2 text-[13px] leading-5 text-muted">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Deploy */}
        <section id="deploy" className="scroll-mt-20 mx-auto max-w-[1200px] px-5 sm:px-8 py-24 grid gap-12 lg:grid-cols-2 items-center">
          <div>
            <SectionHeading
              eyebrow="Get started"
              title="From zero to dashboard"
              accent="in minutes."
            />
            <ol className="mt-8 space-y-6">
              {[
                { t: "Run it", d: "One container, a Helm release or a Vercel import." },
                { t: "Sign in with GitHub", d: "A personal access token for one person, or GitHub OAuth for the whole team." },
                { t: "See what needs attention", d: "Every repository you can access, measured — no configuration per repo." },
              ].map((s, i) => (
                <li key={s.t} className="flex gap-4">
                  <span className="w-8 h-8 rounded-full border border-control bg-surface inline-flex items-center justify-center font-mono text-[13px] text-link shrink-0">{i + 1}</span>
                  <span>
                    <span className="block text-[15px] font-semibold text-fg">{s.t}</span>
                    <span className="block mt-1 text-sm leading-6 text-muted">{s.d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="min-w-0">
            <DeployTabs />
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto max-w-[1200px] px-5 sm:px-8 py-24">
            <SectionHeading
              center
              eyebrow="Pricing"
              title="Free to run."
              accent="Help when you want it."
              lead="GitDash is open source. Pay only if you want us to set it up and look after it for you."
            />
            <div className="mt-14 grid lg:grid-cols-3 gap-4 items-stretch">
              {PLANS.map((p) => (
                <div
                  key={p.name}
                  className={`relative flex flex-col p-7 ${p.featured ? "float-card !rounded-[16px] border-brand-fg/50 ring-1 ring-brand-fg/30" : "card !rounded-[16px]"}`}
                >
                  {p.featured && (
                    <span className="absolute -top-3 left-7 h-6 px-2.5 inline-flex items-center rounded-full bg-primary text-white text-xs font-semibold">Most teams</span>
                  )}
                  {p.comingSoon && (
                    <span className="absolute -top-3 left-7 h-6 px-2.5 inline-flex items-center gap-1.5 rounded-full border border-status-warn/40 bg-surface text-status-warn-text text-xs font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-status-warn" aria-hidden="true" />
                      Coming soon
                    </span>
                  )}
                  <p className="text-[15px] font-semibold text-fg">{p.name}</p>
                  <p className="mt-4 flex items-baseline gap-2">
                    <span className="text-[36px] font-semibold tracking-tight text-fg">{p.price}</span>
                    <span className="text-[13px] text-faint">{p.unit}</span>
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted">{p.blurb}</p>
                  <ul className="mt-6 space-y-3 flex-1">
                    {p.items.map((it) => (
                      <li key={it} className="flex items-start gap-2.5 text-sm text-fg">
                        <Check className="w-4 h-4 mt-0.5 text-status-pass-text shrink-0" aria-hidden="true" /> {it}
                      </li>
                    ))}
                  </ul>
                  {p.comingSoon ? (
                    <span aria-disabled="true" className={`mt-8 ${SECONDARY_CTA} w-full !text-disabled !bg-transparent cursor-not-allowed`}>
                      Coming soon
                    </span>
                  ) : (
                    <a
                      href={p.cta.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`mt-8 ${p.featured ? PRIMARY_CTA : SECONDARY_CTA} w-full`}
                    >
                      {p.cta.label}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t border-line bg-panel/40">
          <div className="mx-auto max-w-[860px] px-5 sm:px-8 py-24">
            <SectionHeading center eyebrow="FAQ" title="Questions, answered." />
            <div className="mt-12 space-y-3">
              {FAQ.map((f) => (
                <details key={f.q} className="group card px-6 open:pb-5">
                  <summary className="flex items-center justify-between gap-4 h-16 cursor-pointer list-none text-[15px] font-semibold text-fg [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span className="text-xl leading-none text-muted transition-transform duration-100 group-open:rotate-45" aria-hidden="true">+</span>
                  </summary>
                  <p className="text-sm leading-6 text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden border-t border-line">
          <AuthBackdrop />
          <div className="relative mx-auto max-w-[900px] px-5 sm:px-8 py-28 text-center">
            <LogoMark size={56} className="mx-auto" />
            <h2 className="mt-8 text-[40px] sm:text-[60px] leading-[1] font-semibold tracking-[-0.045em] text-fg">
              Stop guessing.<br /><span className="text-link">Start measuring.</span>
            </h2>
            <p className="mt-6 mx-auto max-w-[520px] text-lg leading-7 text-muted">
              Run GitDash on your own infrastructure today and see every repository measured in minutes — free and open source.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a href="#deploy" className={PRIMARY_CTA}>
                Get started free <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </a>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={SECONDARY_CTA}>
                <GitHubMark /> View on GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-[1200px] px-5 sm:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-[13px] text-muted">
          <div className="flex items-center gap-2.5">
            <LogoMark size={22} />
            <span className="font-semibold text-fg">GitDash</span>
            <span className="font-mono text-xs text-faint">v{APP_VERSION}</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link href="/docs" className="hover:text-fg">Docs</Link>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-fg">GitHub</a>
            <a href={`${REPO_URL}/releases`} target="_blank" rel="noopener noreferrer" className="hover:text-fg">Releases</a>
            <Link href="/login" className="hover:text-fg">Sign in</Link>
          </nav>
          <span className="text-faint">Open source · MIT · Self-hosted</span>
        </div>
      </footer>
    </div>
  );
}
