/**
 * The one bot rule for team metrics: contributors, reviews, workload and
 * working habits all ask here, so a bot is excluded (or shown dimmed) the
 * same way everywhere.
 *
 * GitHub names the same bot differently per API: REST says
 * `dependabot[bot]` with `type: "Bot"`, GraphQL says `dependabot` with
 * `__typename: "Bot"`. normalizeBotLogin() appends `[bot]` on GraphQL ingest
 * so one bot is one key whichever API the numbers came from.
 */

export const BOT_LOGINS = new Set(["dependabot", "renovate", "github-actions"]);

/** True for a bot account: `[bot]` suffix, a known bot login, or the API says so (`type`/`__typename` "Bot"). */
export function isBot(login: string | null, type?: string | null): boolean {
  if (type === "Bot") return true;
  if (!login) return false;
  const l = login.toLowerCase();
  return l.endsWith("[bot]") || BOT_LOGINS.has(l);
}

/** GraphQL bot logins lack the `[bot]` suffix REST uses; add it so both sources agree. */
export function normalizeBotLogin(login: string, typename?: string | null): string {
  return typename === "Bot" && !login.toLowerCase().endsWith("[bot]") ? `${login}[bot]` : login;
}
