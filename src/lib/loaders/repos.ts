import { listRepos, type Repo } from "@/lib/github";
import { withCache, hashKey } from "@/lib/cache";
import { applyLabel, loaderOk, type LoaderOptions, type LoaderResult } from "./types";

const CACHE_TTL = 60;

export async function loadRepos(token: string, opts?: LoaderOptions): Promise<LoaderResult<Repo[]>> {
  applyLabel(opts);
  const repos = await withCache(
    `github/repos:${hashKey(token)}`,
    CACHE_TTL,
    () => listRepos(token),
    { shared: true, refresh: opts?.refresh ?? false },
  );
  return loaderOk(repos);
}
