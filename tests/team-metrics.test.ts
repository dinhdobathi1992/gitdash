import { describe, it, expect } from "vitest";
import { reviewBusFactor, medianPositive } from "@/lib/team-metrics";

describe("reviewBusFactor", () => {
  it("counts the fewest reviewers covering half the reviews", () => {
    expect(reviewBusFactor([40, 30, 20, 10])).toEqual({ people: 2, share: 70 });
    expect(reviewBusFactor([90, 5, 5])).toEqual({ people: 1, share: 90 });
  });
  it("is null with no reviews", () => {
    expect(reviewBusFactor([0, 0])).toBeNull();
  });
});

describe("medianPositive", () => {
  it("ignores zeros and averages the middle pair", () => {
    expect(medianPositive([0, 4, 2, 8, 6])).toBe(5);
    expect(medianPositive([0])).toBeNull();
  });
});
