import { NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { listUserOrgs } from "@/lib/github";
import { safeError } from "@/lib/validation";
import { privateCacheHeaders } from "@/lib/http-cache";
import { labelGitHubRoute } from "@/lib/github-telemetry";
import { withCache, hashKey } from "@/lib/cache";

const CACHE_TTL = 120;

export async function GET() {
  labelGitHubRoute("github/orgs");
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const orgs = await withCache(
      `github/orgs:${hashKey(token)}`,
      CACHE_TTL,
      () => listUserOrgs(token),
      { shared: true },
    );
    return NextResponse.json(orgs, {
      headers: privateCacheHeaders(0),
    });
  } catch (e) {
    return safeError(e, "Failed to fetch organizations");
  }
}
