import { getRepoOverview } from "@/lib/github";
import { validateOwner, validateRepo } from "@/lib/validation";
import { withCache, hashKey } from "@/lib/cache";
import { applyLabel, loaderOk, validationFailure, type LoaderOptions, type LoaderResult } from "./types";

const CACHE_TTL = 300; // 5 min

export type RepoOverview = Awaited<ReturnType<typeof getRepoOverview>>;

export async function loadRepoOverview(
  token: string,
  owner: string | null,
  repo: string | null,
  opts?: LoaderOptions,
): Promise<LoaderResult<RepoOverview>> {
  applyLabel(opts);
  const ownerResult = validateOwner(owner);
  if (!ownerResult.ok) return validationFailure(ownerResult);
  const repoResult = validateRepo(repo);
  if (!repoResult.ok) return validationFailure(repoResult);

  const overview = await withCache(
    `github/repo-overview:${hashKey(token)}:${ownerResult.data}:${repoResult.data}`,
    CACHE_TTL,
    () => getRepoOverview(token, ownerResult.data, repoResult.data),
    { shared: true, refresh: opts?.refresh ?? false },
  );
  return loaderOk(overview);
}
