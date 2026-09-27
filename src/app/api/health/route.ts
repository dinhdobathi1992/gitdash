import { NextResponse } from "next/server";
import { assertOrgModeConfig } from "@/lib/identity";

/**
 * Lightweight liveness / readiness probe endpoint. Reports 503 when
 * organization mode is misconfigured (missing DATABASE_URL or
 * GITDASH_ADMIN_GITHUB_IDS) so such a rollout never becomes ready.
 */
export async function GET() {
  try {
    assertOrgModeConfig();
  } catch (err) {
    // Details go to the server log only; this endpoint is public.
    console.error("[health] configuration invalid:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { status: "misconfigured", error: "organization mode configuration is incomplete — see server logs" },
      { status: 503 },
    );
  }
  return NextResponse.json({ status: "ok" });
}
