/**
 * Runs once when a server instance starts. Organization mode cannot work
 * without its database and at least one bootstrap admin, so validate that at
 * boot and fail loudly in the logs, instead of first discovering it as a 500
 * on every page. /api/health reports the same check as 503 so a rollout with
 * a bad config never passes readiness.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertOrgModeConfig } = await import("@/lib/identity");
  try {
    assertOrgModeConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    throw err;
  }
}
