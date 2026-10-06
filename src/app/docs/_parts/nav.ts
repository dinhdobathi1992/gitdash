/**
 * Docs navigation: one entry per page. "getting-started" is served at /docs;
 * every other id at /docs/<id>. The sitemap, llms.txt and the markdown twins
 * are generated from this list, so a new page only needs an entry here and a
 * component in ./registry.tsx.
 */

import { Rocket, Server, Settings2, GitBranch, Layers, Shield, HelpCircle, Tag, Code2, Users, GitPullRequest, Cpu, Activity, FileText, ShieldAlert, User, DollarSign, TrendingUp, Bell, Building2, List, BarChart3, Trophy, Sliders, Sparkles, CircleDot, Terminal, UsersRound, Gauge, LockKeyhole, Plug } from "lucide-react";

export type NavItem = { id: string; label: string; icon: React.ElementType; sub?: boolean };
export type NavSection = { title: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    title: "Getting Started",
    items: [
      { id: "getting-started", label: "Introduction", icon: Rocket },
      { id: "quick-start", label: "Quick start", icon: Terminal },
      { id: "deployment", label: "Deployment", icon: Server },
      { id: "configuration", label: "Configuration", icon: Settings2 },
    ],
  },
  {
    title: "Core Concepts",
    items: [
      { id: "modes", label: "Auth modes", icon: GitBranch },
      { id: "access-control", label: "Access control", icon: UsersRound },
      { id: "caching", label: "Caching & rate limits", icon: Gauge },
      { id: "security", label: "Security model", icon: Shield },
      { id: "core-concepts", label: "Data sources", icon: Cpu },
    ],
  },
  {
    title: "Features",
    items: [
      { id: "features", label: "Feature overview", icon: Layers },
      { id: "feat-repositories", label: "Repositories", icon: List, sub: true },
      { id: "feat-repo-overview", label: "Repository · Overview", icon: BarChart3, sub: true },
      { id: "feat-repo-workflows", label: "Repository · Workflows", icon: Activity, sub: true },
      { id: "feat-repo-pulls", label: "Repository · Pull requests", icon: GitPullRequest, sub: true },
      { id: "feat-repo-team", label: "Repository · Team", icon: Trophy, sub: true },
      { id: "feat-issues", label: "Repository · Issues", icon: CircleDot, sub: true },
      { id: "feat-security", label: "Repository · Security", icon: ShieldAlert, sub: true },
      { id: "feat-audit", label: "Repository · Audit trail", icon: FileText, sub: true },
      { id: "feat-workflow", label: "Workflow detail", icon: Activity, sub: true },
      { id: "feat-alerts", label: "Alerts", icon: Bell, sub: true },
      { id: "feat-team", label: "Team insights", icon: Users, sub: true },
      { id: "feat-contributor", label: "Contributor & 1:1 prep", icon: User, sub: true },
      { id: "feat-cost", label: "Cost", icon: DollarSign, sub: true },
      { id: "feat-reports", label: "Reports", icon: TrendingUp, sub: true },
      { id: "feat-org", label: "Org overview & health", icon: Building2, sub: true },
      { id: "feat-settings", label: "Settings", icon: Sliders, sub: true },
      { id: "feat-ai-insights", label: "AI insights", icon: Sparkles, sub: true },
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
      { id: "mcp",                    label: "MCP server",          icon: Plug },
    ],
  },
  {
    title: "Support",
    items: [
      { id: "faq", label: "FAQ & Troubleshooting", icon: HelpCircle },
      { id: "contributing", label: "Contributing", icon: GitPullRequest },
      { id: "release-notes", label: "Release Notes", icon: Tag },
      { id: "privacy", label: "Data & privacy", icon: LockKeyhole },
    ],
  },
];

export const ALL_SECTIONS = NAV.flatMap((s) => s.items);

export const HOME_SECTION = "getting-started";

/** Site-relative URL of a docs page. */
export function docHref(id: string): string {
  return id === HOME_SECTION ? "/docs" : `/docs/${id}`;
}

export function findSection(id: string): NavItem | undefined {
  return ALL_SECTIONS.find((s) => s.id === id);
}
