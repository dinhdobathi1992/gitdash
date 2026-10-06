import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { safeError } from "@/lib/validation";
import { gatedCacheHeaders } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { loadCostAnalysis, type CostAnalysisError } from "@/lib/loaders/cost-analysis";

export type {
  DailySpend,
  RepoSpend,
  SkuBreakdown,
  CostAnalysisResponse,
  CostAnalysisError,
} from "@/lib/loaders/cost-analysis";

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/billing/cost-analysis");
  const token = await getTokenFromSession();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const org = url.searchParams.get("org") || null;

  // Year/month to query — default current month
  const now = new Date();
  const year = parseInt(url.searchParams.get("year") ?? String(now.getFullYear()), 10);
  const month = parseInt(url.searchParams.get("month") ?? String(now.getMonth() + 1), 10);

  try {
    const result = await loadCostAnalysis(token, org, year, month);
    if (!result.ok) {
      const body: CostAnalysisError = { error: result.error, ...(result.hint ? { hint: result.hint } : {}) };
      return NextResponse.json(body, { status: result.status });
    }
    return NextResponse.json(result.data, {
      headers: {
        ...gatedCacheHeaders(),
      },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch billing data");
  }
}
