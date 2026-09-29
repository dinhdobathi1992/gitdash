import { describe, it, expect } from "vitest";
import { parseTeamWindow, teamDataKeys } from "@/lib/team-data-keys";

const all = { workloadRisk: true, workingHabits: true };

describe("teamDataKeys", () => {
  it("requests every section with the page-wide window", () => {
    expect(teamDataKeys({ owner: "acme", repo: "api", days: 90, flags: all, canManageLinks: true })).toEqual({
      contributors: "/api/github/repo-contributors?owner=acme&repo=api&days=90",
      workload: "/api/github/team-workload-risk?owner=acme&repo=api&days=90",
      habits: "/api/db/working-habits?owner=acme&repo=api&days=90",
      identity: "/api/admin/identity-links",
    });
  });

  it("no request for a section without its grant, nor link data for non-admins", () => {
    const k = teamDataKeys({ owner: "acme", repo: "api", days: 30, flags: { workloadRisk: false, workingHabits: false }, canManageLinks: false });
    expect(k.contributors).toMatch(/days=30$/);
    expect(k.workload).toBeNull();
    expect(k.habits).toBeNull();
    expect(k.identity).toBeNull();
  });

  it("nothing without a repository", () => {
    expect(teamDataKeys({ owner: null, repo: null, days: 30, flags: all, canManageLinks: true })).toEqual({
      contributors: null, workload: null, habits: null, identity: null,
    });
  });

  it("parses ?days", () => {
    expect(parseTeamWindow("90")).toBe(90);
    expect(parseTeamWindow("30")).toBe(30);
    expect(parseTeamWindow(null)).toBe(30);
    expect(parseTeamWindow("7")).toBe(30);
  });
});
