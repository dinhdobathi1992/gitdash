/**
 * The SWR keys the Team page requests. One place, so a test can prove no
 * request is made for a section the viewer is not granted (the server would
 * refuse it anyway, but a hidden section must not even ask).
 */

export type TeamWindow = 30 | 90;

export interface TeamDataKeys {
  contributors: string | null;
  workload: string | null;
  habits: string | null;
  /** Admin-only link data (organization mode) for the suggestion card. */
  identity: string | null;
}

export function teamDataKeys(opts: {
  owner: string | null;
  repo: string | null;
  days: TeamWindow;
  flags: { workloadRisk: boolean; workingHabits: boolean };
  /** Admin in organization mode. */
  canManageLinks: boolean;
}): TeamDataKeys {
  const { owner, repo, days, flags } = opts;
  if (!owner || !repo) return { contributors: null, workload: null, habits: null, identity: null };
  const q = new URLSearchParams({ owner, repo, days: String(days) }).toString();
  return {
    contributors: `/api/github/repo-contributors?${q}`,
    workload: flags.workloadRisk ? `/api/github/team-workload-risk?${q}` : null,
    habits: flags.workingHabits ? `/api/db/working-habits?${q}` : null,
    identity: opts.canManageLinks ? "/api/admin/identity-links" : null,
  };
}

/** `?days=` from the URL: 30 unless it says 90. */
export function parseTeamWindow(v: string | null): TeamWindow {
  return v === "90" ? 90 : 30;
}
