import { NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { listRepos } from "@/lib/github";
import { safeError } from "@/lib/validation";

const CACHE_TTL = 60;

export async function GET() {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const repos = await listRepos(token);
    return NextResponse.json(repos, {
      headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=120` },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch repositories");
  }
}
