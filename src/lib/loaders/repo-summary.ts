import { getRepoSummary, type RepoSummary } from "@/lib/github";
import { validateOwner, validateRepo } from "@/lib/validation";
import { withCache, hashKey } from "@/lib/cache";
import { applyLabel, loaderOk, validationFailure, type LoaderOptions, type LoaderResult } from "./types";

// Short TTL — this is per-repo and called lazily as rows enter viewport
const CACHE_TTL = 300; // 5 min

export async function loadRepoSummary(
  token: string,
  owner: string | null,
  repo: string | null,
  opts?: LoaderOptions,
): Promise<LoaderResult<RepoSummary>> {
  applyLabel(opts);
  const ownerResult = validateOwner(owner);
  if (!ownerResult.ok) return validationFailure(ownerResult);
  const repoResult = validateRepo(repo);
  if (!repoResult.ok) return validationFailure(repoResult);

  const summary = await withCache(
    `github/repo-summary:${hashKey(token)}:${ownerResult.data}:${repoResult.data}`,
    CACHE_TTL,
    () => getRepoSummary(token, ownerResult.data, repoResult.data),
    { shared: true, refresh: opts?.refresh ?? false },
  );
  return loaderOk(summary);
}
