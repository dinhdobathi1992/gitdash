import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { safeError } from "@/lib/validation";
import { gatedCacheHeaders } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { loadOpenPrHealth } from "@/lib/loaders/open-pr-health";

// Response types and the metric math live in src/lib/pr-health.ts (pure,
// shared with the public API playground). Re-exported for existing importers.
export type { OpenPrInfo, OpenPrHealthResponse } from "@/lib/pr-health";

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/open-pr-health");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  try {
    const result = await loadOpenPrHealth(token, searchParams.get("owner"), searchParams.get("repo"));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, {
      headers: {
        ...gatedCacheHeaders(),
      },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch open PR health");
  }
}
