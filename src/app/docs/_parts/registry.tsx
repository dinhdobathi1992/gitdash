/** Docs page id → its content. Ids and order come from ./nav.ts. */

import { GettingStarted, QuickStart, Deployment, Configuration } from "./getting-started";
import { Modes, AccessControl, Caching, Security, CoreConcepts } from "./concepts";
import { Features, FeatureRepositories, FeatureRepoOverview, FeatureRepoWorkflows, FeatureRepoPulls, FeatureWorkflowDetail, FeatureAudit, FeatureSecurity, FeatureRepoTeam, FeatureTeamInsights, FeatureContributor, FeatureCost, FeatureReports, FeatureAlerts, FeatureSettings, FeatureOrg, FeatureAiInsights, FeatureIssues } from "./features";
import { MetricsReference, MetricsDora, MetricsPrCycle, MetricsPrHealth, MetricsWorkflow, MetricsPerformance, MetricsReliability, MetricsTeam, MetricsCiAlerts } from "./metrics";
import { APIReference } from "./api-reference";
import { FAQ, Contributing, Privacy } from "./help";
import { ReleaseNotes } from "./release-notes";
import { McpServer } from "./mcp";

export const SECTION_COMPONENTS: Record<string, React.ComponentType> = {
  "getting-started": GettingStarted,
  "quick-start": QuickStart,
  "deployment": Deployment,
  "configuration": Configuration,
  "modes": Modes,
  "access-control": AccessControl,
  "caching": Caching,
  "security": Security,
  "core-concepts": CoreConcepts,
  "features": Features,
  "feat-repositories": FeatureRepositories,
  "feat-repo-overview": FeatureRepoOverview,
  "feat-repo-workflows": FeatureRepoWorkflows,
  "feat-repo-pulls": FeatureRepoPulls,
  "feat-workflow": FeatureWorkflowDetail,
  "feat-audit": FeatureAudit,
  "feat-security": FeatureSecurity,
  "feat-repo-team": FeatureRepoTeam,
  "feat-issues": FeatureIssues,
  "feat-team": FeatureTeamInsights,
  "feat-contributor": FeatureContributor,
  "feat-cost": FeatureCost,
  "feat-reports": FeatureReports,
  "feat-alerts": FeatureAlerts,
  "feat-settings": FeatureSettings,
  "feat-org": FeatureOrg,
  "feat-ai-insights": FeatureAiInsights,
  "metrics-reference": MetricsReference,
  "metrics-dora": MetricsDora,
  "metrics-pr-cycle": MetricsPrCycle,
  "metrics-pr-health": MetricsPrHealth,
  "metrics-workflow": MetricsWorkflow,
  "metrics-performance": MetricsPerformance,
  "metrics-reliability": MetricsReliability,
  "metrics-team": MetricsTeam,
  "metrics-ci-alerts": MetricsCiAlerts,
  "api-reference": APIReference,
  "mcp": McpServer,
  "faq": FAQ,
  "contributing": Contributing,
  "release-notes": ReleaseNotes,
  "privacy": Privacy,
};
