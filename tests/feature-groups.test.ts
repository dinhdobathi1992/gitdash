import { describe, it, expect } from "vitest";
import { FEATURE_GROUPS } from "@/components/settings/feature-groups";
import { DEFAULT_FLAGS } from "@/lib/feature-flags";

describe("settings feature groups", () => {
  it("list every permission flag exactly once", () => {
    const keys = FEATURE_GROUPS.flatMap((g) => g.rows.map((r) => r.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(Object.keys(DEFAULT_FLAGS).sort());
  });
});
