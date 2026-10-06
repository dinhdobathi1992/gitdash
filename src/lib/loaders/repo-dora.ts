import { getRepoDoraSummary } from "@/lib/github-dora";
import { validateOwner, validateRepo } from "@/lib/validation";
import { withCache, hashKey, partialAwareTtl } from "@/lib/cache";
import { applyLabel, loaderOk, validationFailure, type LoaderOptions, type LoaderResult } from "./types";

const CACHE_TTL = 300; // 5 minutes — PR data changes infrequently

export type RepoDora = Awaited<ReturnType<typeof getRepoDoraSummary>>;

export function repoDoraCacheKey(token: string, owner: string, repo: string): string {
  return `github/repo-dora:${hashKey(token)}:${owner}:${repo}`;
}

export async function loadRepoDora(
  token: string,
  owner: string | null,
  repo: string | null,
  opts?: LoaderOptions,
): Promise<LoaderResult<RepoDora>> {
  applyLabel(opts);
  const ownerResult = validateOwner(owner);
  if (!ownerResult.ok) return validationFailure(ownerResult);
  const repoResult = validateRepo(repo);
  if (!repoResult.ok) return validationFailure(repoResult);

  const summary = await withCache(
    repoDoraCacheKey(token, ownerResult.data, repoResult.data),
    CACHE_TTL,
    () => getRepoDoraSummary(token, ownerResult.data, repoResult.data),
    { shared: true, ttlFor: partialAwareTtl(CACHE_TTL) },
  );
  return loaderOk(summary);
}
