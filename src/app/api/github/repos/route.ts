import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { safeError } from "@/lib/validation";
import { privateCacheHeaders, wantsFresh } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { loadRepos } from "@/lib/loaders/repos";

export async function GET(req: NextRequest) {
  labelGitHubRoute("github/repos");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await loadRepos(token, { refresh: wantsFresh(req) });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, {
      headers: privateCacheHeaders(0),
    });
  } catch (e) {
    return safeError(e, "Failed to fetch repositories");
  }
}
