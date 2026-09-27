/**
 * Folding GitHub's detailed billing usage (per day, per repository) into
 * the daily-by-OS series and per-repository spend the Cost page draws.
 */

/** Line item from the detailed usage endpoint (per day, per repository). */
export interface BillingUsageDetailItem {
  date: string;
  product: string;
  sku: string;
  quantity: number;
  netAmount: number;
  repositoryName?: string | null;
}

export interface DailySpend {
  date: string; // YYYY-MM-DD
  linux: number;
  macos: number;
  windows: number;
  other: number;
}

export interface RepoSpend {
  repo: string;
  minutes: number;
  net_amount: number;
}

/** actions_linux_4_core → linux, actions_macos_xlarge → macos, … */
export function runnerOs(sku: string): keyof Omit<DailySpend, "date"> {
  const s = sku.toLowerCase();
  if (s.includes("linux") || s.includes("ubuntu")) return "linux";
  if (s.includes("macos")) return "macos";
  if (s.includes("windows")) return "windows";
  return "other";
}

/** Fold detailed usage items into per-day OS spend and per-repo spend. */
export function foldUsageDetail(items: BillingUsageDetailItem[]): { daily: DailySpend[]; repos: RepoSpend[] } {
  const days = new Map<string, DailySpend>();
  const repos = new Map<string, RepoSpend>();
  for (const i of items) {
    if (i.product?.toLowerCase() !== "actions") continue;
    const date = i.date.slice(0, 10);
    const d = days.get(date) ?? { date, linux: 0, macos: 0, windows: 0, other: 0 };
    d[runnerOs(i.sku)] += i.netAmount;
    days.set(date, d);
    if (i.repositoryName) {
      const r = repos.get(i.repositoryName) ?? { repo: i.repositoryName, minutes: 0, net_amount: 0 };
      r.minutes += i.quantity;
      r.net_amount += i.netAmount;
      repos.set(i.repositoryName, r);
    }
  }
  return {
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    repos: [...repos.values()].sort((a, b) => b.net_amount - a.net_amount),
  };
}
