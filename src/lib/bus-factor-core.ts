/**
 * Bus factor math — knowledge concentration per module and repo-wide, from
 * raw GitHub REST commits. Pure (no I/O, no cache, no server-only imports):
 * src/lib/bus-factor.ts fetches commits and calls this, and the public API
 * playground runs the same code in the browser.
 *
 * Inputs: `GET /repos/{o}/{r}/commits` items (author) and
 * `GET /repos/{o}/{r}/commits/{sha}` (`files[].filename`).
 */

export interface ModuleOwnership {
  /** Directory path prefix (e.g. "src/lib", "src/components") */
  module: string;
  /** Contributors and their commit share */
  contributors: { login: string; commits: number; pct: number }[];
  /** Number of unique contributors */
  unique_contributors: number;
  /** Bus factor (contributors needed for >=80% of commits) */
  bus_factor: number;
  /** Total commits in this module */
  total_commits: number;
  /** Risk level */
  risk: "critical" | "warning" | "healthy";
}

export interface BusFactorResponse {
  modules: ModuleOwnership[];
  /** Overall repo bus factor */
  overall_bus_factor: number;
  /** Total commits analysed */
  total_commits: number;
  /** Modules with bus factor = 1 (critical risk) */
  critical_modules: number;
  /** Total unique contributors across all modules */
  total_contributors: number;
  /** True if some commit detail fetches were rate-limited or failed */
  partial: boolean;
  /** Commits successfully resolved to a file list */
  fetched_commits: number;
  /** Commits listed (fetched_commits <= total_commits_listed when partial) */
  total_commits_listed: number;
}

/** The fetch-status fields the fetch layer adds; everything else comes from calculateBusFactor. */
export type BusFactorMetrics = Omit<BusFactorResponse, "partial" | "fetched_commits" | "total_commits_listed">;

/** One commit as the bus factor sees it: who, and which files it touched. */
export interface AuthoredCommit {
  author: string;
  files: string[];
}

/** Share of a module's commits the top contributors must cover (bus factor threshold). */
export const BUS_FACTOR_COVERAGE = 0.8;

/** Commit author key from a `GET /commits` item: linked GitHub login, else the git author name. */
export function commitAuthor(c: {
  // GitHub returns `{}` (not null) for some unlinked authors, hence the optional login.
  author?: { login?: string } | null;
  commit?: { author?: { name?: string } | null } | null;
}): string {
  return c.author?.login ?? c.commit?.author?.name ?? "unknown";
}

/** File paths from a `GET /commits/{sha}` response. */
export function commitFiles(detail: { files?: { filename: string }[] | null }): string[] {
  return (detail.files ?? []).map((f) => f.filename);
}

/**
 * Module = top-2 directory level.
 * e.g. "src/lib/dora.ts" → "src/lib"; ".github/workflows/ci.yml" → ".github/workflows";
 * "README.md" → "(root)"; "docs/x.md" → "docs".
 */
export function moduleOf(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) return "(root)";
  if (parts.length === 2) return parts[0];
  return `${parts[0]}/${parts[1]}`;
}

/** Contributors (by commit count, descending) needed to reach BUS_FACTOR_COVERAGE of `total`. */
function contributorsToCoverage(countsDesc: number[], total: number): number {
  let cumulative = 0;
  let busFactor = 0;
  for (const c of countsDesc) {
    cumulative += c;
    busFactor++;
    if (cumulative >= total * BUS_FACTOR_COVERAGE) break;
  }
  return busFactor;
}

/** Per-module and overall bus factor from resolved commits. */
export function calculateBusFactor(commits: AuthoredCommit[]): BusFactorMetrics {
  const moduleMap = new Map<string, Map<string, number>>();
  const allContributors = new Set<string>();

  for (const commit of commits) {
    allContributors.add(commit.author);
    const seenModules = new Set<string>();
    for (const file of commit.files) {
      const mod = moduleOf(file);
      if (seenModules.has(mod)) continue; // count each module once per commit
      seenModules.add(mod);

      if (!moduleMap.has(mod)) moduleMap.set(mod, new Map());
      const authorMap = moduleMap.get(mod)!;
      authorMap.set(commit.author, (authorMap.get(commit.author) ?? 0) + 1);
    }
  }

  // ── Per-module bus factor ───────────────────────────────────────────────
  const modules: ModuleOwnership[] = [];

  for (const [mod, authorMap] of moduleMap) {
    const totalCommits = Array.from(authorMap.values()).reduce((s, c) => s + c, 0);
    const contributors = Array.from(authorMap.entries())
      .map(([login, commitCount]) => ({
        login,
        commits: commitCount,
        pct: Math.round((commitCount / totalCommits) * 100),
      }))
      .sort((a, b) => b.commits - a.commits);

    const busFactor = contributorsToCoverage(contributors.map((c) => c.commits), totalCommits);
    const risk: ModuleOwnership["risk"] =
      busFactor <= 1 ? "critical" : busFactor <= 2 ? "warning" : "healthy";

    modules.push({
      module: mod,
      contributors: contributors.slice(0, 5), // top 5 per module
      unique_contributors: contributors.length,
      bus_factor: busFactor,
      total_commits: totalCommits,
      risk,
    });
  }

  // Sort: critical first, then by total commits descending
  const riskOrder = { critical: 0, warning: 1, healthy: 2 };
  modules.sort((a, b) => {
    if (riskOrder[a.risk] !== riskOrder[b.risk]) {
      return riskOrder[a.risk] - riskOrder[b.risk];
    }
    return b.total_commits - a.total_commits;
  });

  // Overall bus factor (across all commits, by author)
  const overallAuthorMap = new Map<string, number>();
  for (const commit of commits) {
    overallAuthorMap.set(commit.author, (overallAuthorMap.get(commit.author) ?? 0) + 1);
  }
  const overallCounts = Array.from(overallAuthorMap.values()).sort((a, b) => b - a);

  return {
    modules: modules.slice(0, 30), // cap at 30 modules
    overall_bus_factor: contributorsToCoverage(overallCounts, commits.length),
    total_commits: commits.length,
    critical_modules: modules.filter((m) => m.risk === "critical").length,
    total_contributors: allContributors.size,
  };
}
