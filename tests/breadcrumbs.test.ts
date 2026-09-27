import { describe, it, expect } from "vitest";
import { crumbsFor } from "@/lib/breadcrumbs";

describe("crumbsFor", () => {
  it("roots top-level pages at the org", () => {
    expect(crumbsFor("/", "adi").map((c) => c.label)).toEqual(["adi", "Repositories"]);
    expect(crumbsFor("/team", null).map((c) => c.label)).toEqual(["Personal", "Team insights"]);
  });

  it("builds repository trails with the leaf unlinked", () => {
    const c = crumbsFor("/repos/adi/tesda-backend", "adi");
    expect(c.map((x) => x.label)).toEqual(["adi", "Repositories", "tesda-backend"]);
    expect(c[2].href).toBeUndefined();
    expect(crumbsFor("/repos/adi/tesda-backend/security", null).at(-1)?.label).toBe("Security");
  });

  it("falls back to the workflow id until a label is published", () => {
    expect(crumbsFor("/repos/adi/x/workflows/42", null).at(-1)?.label).toBe("Workflow 42");
  });

  it("names settings sub-sections", () => {
    expect(crumbsFor("/settings", "adi", "Access by group").map((c) => c.label)).toEqual(["adi", "Settings", "Access by group"]);
  });
});
