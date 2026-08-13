/**
 * POST /api/db/sync
 *
 * Syncs recent workflow runs for a given repo from GitHub API into Neon DB.
 * Supports incremental sync — only fetches runs newer than the last stored run.
 *
 * Body: { owner: string; repo: string; pages?: number }
 * Returns: { synced: number; total_in_db: number; latest_run_id: number | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getOctokit } from "@/lib/github";
import { syncRepo } from "@/lib/sync";
import { safeError } from "@/lib/validation";

export async function POST(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { owner?: string; repo?: string; pages?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { owner, repo: repoName, pages = 3 } = body;
  if (!owner || !repoName) {
    return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
  }

  try {
    const octokit = getOctokit(token);
    const result = await syncRepo(octokit, owner, repoName, pages);
    return NextResponse.json(result);
  } catch (e) {
    return safeError(e, "Sync failed");
  }
}
