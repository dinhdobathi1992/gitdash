/**
 * App mode — set explicitly via the MODE environment variable.
 *
 * standalone   : Individual use. No OAuth required. Each user enters their own
 *                GitHub PAT on the /setup page. The token is stored in an
 *                encrypted session cookie (never in env).
 *
 * organization : Shared/org use. Requires GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET.
 *                Users sign in via GitHub OAuth. Each user gets their own session.
 *
 * Defaults to "standalone" when MODE is unset so the app works out of the box.
 */
export type AppMode = "standalone" | "organization";

export function getAppMode(): AppMode {
  const raw = (process.env.MODE ?? "standalone").toLowerCase().trim();
  if (raw === "organization" || raw === "org" || raw === "team") return "organization";
  return "standalone";
}

export function isStandaloneMode(): boolean {
  return getAppMode() === "standalone";
}
