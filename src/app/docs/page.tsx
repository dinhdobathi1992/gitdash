"use client";

import { APP_VERSION } from "@/components/shell/Logo";
import { useState, useEffect } from "react";
import { BookOpen, Rocket, Server, Settings2, GitBranch, Layers, Shield, HelpCircle, ChevronRight, Tag, Search, Menu, X, Code2, Users, ChevronDown, ExternalLink, GitPullRequest, Cpu, Activity, FileText, ShieldAlert, User, DollarSign, TrendingUp, Bell, Building2, List, BarChart3, Trophy, Sliders, Sparkles, CircleDot, Terminal, UsersRound, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { DocSearch } from "@/components/docs/DocSearch";
import { GettingStarted, QuickStart, Deployment, Configuration } from "./_parts/getting-started";
import { Modes, AccessControl, Caching, Security, CoreConcepts } from "./_parts/concepts";
import { Features, FeatureRepositories, FeatureRepoOverview, FeatureRepoWorkflows, FeatureRepoPulls, FeatureWorkflowDetail, FeatureAudit, FeatureSecurity, FeatureRepoTeam, FeatureTeamInsights, FeatureContributor, FeatureCost, FeatureReports, FeatureAlerts, FeatureSettings, FeatureOrg, FeatureAiInsights, FeatureIssues } from "./_parts/features";
import { MetricsReference, MetricsDora, MetricsPrCycle, MetricsPrHealth, MetricsWorkflow, MetricsPerformance, MetricsReliability, MetricsTeam, MetricsCiAlerts } from "./_parts/metrics";
import { APIReference } from "./_parts/api-reference";
import { FAQ, Contributing } from "./_parts/help";
import { ReleaseNotes } from "./_parts/release-notes";

// ── Navigation structure ──────────────────────────────────────────────────────

type NavItem = { id: string; label: string; icon: React.ElementType; sub?: boolean };
type NavSection = { title: string; items: NavItem[] };

const NAV: NavSection[] = [
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
            v{APP_VERSION}
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
                className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-300 transition-colors"
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
    "quick-start": <QuickStart />,
    "deployment": <Deployment />,
    "configuration": <Configuration />,
    "modes": <Modes />,
    "access-control": <AccessControl />,
    "caching": <Caching />,
    "security": <Security />,
    "core-concepts": <CoreConcepts />,
    "features": <Features onNavigate={setActive} />,
    "feat-repositories": <FeatureRepositories />,
    "feat-repo-overview": <FeatureRepoOverview />,
    "feat-repo-workflows": <FeatureRepoWorkflows />,
    "feat-repo-pulls": <FeatureRepoPulls />,
    "feat-workflow": <FeatureWorkflowDetail />,
    "feat-audit": <FeatureAudit />,
    "feat-security": <FeatureSecurity />,
    "feat-repo-team": <FeatureRepoTeam />,
    "feat-issues":     <FeatureIssues />,
    "feat-team": <FeatureTeamInsights />,
    "feat-contributor": <FeatureContributor />,
    "feat-cost": <FeatureCost />,
    "feat-reports": <FeatureReports />,
    "feat-alerts": <FeatureAlerts />,
    "feat-settings": <FeatureSettings />,
    "feat-org":           <FeatureOrg />,
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
                  <p className="text-xs text-slate-600">Previous</p>
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
                  <p className="text-xs text-slate-600">Next</p>
                  <p className="font-medium">{nextSection.label}</p>
                </div>
                <ChevronRight className="w-4 h-4 shrink-0 text-slate-600 group-hover:text-violet-400 transition-colors" />
              </button>
            ) : <div />}
          </div>

          {/* Footer */}
          <footer className="mt-8 pb-4 text-center text-xs text-slate-600 space-y-1">
            <p>GitDash v{APP_VERSION} — GitHub Actions Dashboard</p>
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
