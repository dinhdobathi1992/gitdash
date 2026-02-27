import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { listOrgRepos } from "@/lib/github";
import { validateOrg, safeError } from "@/lib/validation";

const CACHE_TTL = 60;

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgResult = validateOrg(new URL(req.url).searchParams.get("org"));
  if (!orgResult.ok) return orgResult.response;

  try {
    const repos = await listOrgRepos(token, orgResult.data);
    return NextResponse.json(repos, {
      headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=120` },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch organization repositories");
  }
}
