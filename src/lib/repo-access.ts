/**
 * Visibility checks for data GitDash serves from its own database.
 *
 * Runs and trends in Postgres were synced with the service token
 * (GITHUB_TOKEN), which can see more than any individual user. Before serving
 * them, confirm the requesting user's own token can see the repo/org — the
 * same answer GitHub would give. Cached per token (in-process only).
 */

import { getOctokit } from "./github";
import { withCache, hashKey } from "./cache";

const VISIBILITY_TTL_SECONDS = 300;

/**
 * 404, or a 403 that is not a rate limit, means "cannot see it". A rate-limit
 * 403/429 is rethrown so it is never cached as "not visible".
 */
const notVisible = (err: unknown) => {
  const e = err as { status?: number; response?: { headers?: Record<string, string> } };
  const h = e.response?.headers ?? {};
  const rateLimited = e.status === 429 || h["x-ratelimit-remaining"] === "0" || h["retry-after"] !== undefined;
  return e.status === 404 || (e.status === 403 && !rateLimited);
};

/** True if `token` can read `owner/repo` on GitHub. */
export function canSeeRepo(token: string, owner: string, repo: string): Promise<boolean> {
  return withCache(`repo-access:${hashKey(token)}:${owner}/${repo}`, VISIBILITY_TTL_SECONDS, async () => {
    try {
      await getOctokit(token).rest.repos.get({ owner, repo });
      return true;
    } catch (err) {
      if (notVisible(err)) return false;
      throw err;
    }
  });
}

/** True if `token` belongs to `owner` itself or to an active member of org `owner`. */
export function canSeeOwner(token: string, owner: string): Promise<boolean> {
  return withCache(`owner-access:${hashKey(token)}:${owner}`, VISIBILITY_TTL_SECONDS, async () => {
    const octokit = getOctokit(token);
    const { data: me } = await octokit.rest.users.getAuthenticated();
    if (me.login.toLowerCase() === owner.toLowerCase()) return true;
    try {
      const { data } = await octokit.rest.orgs.getMembershipForAuthenticatedUser({ org: owner });
      return data.state === "active";
    } catch (err) {
      if (notVisible(err)) return false;
      throw err;
    }
  });
}
