import { describe, it, expect } from "vitest";
import { savingsSuggestions } from "@/lib/cost-savings";

const linux = { sku: "actions_linux", label: "Ubuntu", minutes: 10_000, price_per_unit: 0.008, net_amount: 80 };
const mac = { sku: "actions_macos", label: "macOS", minutes: 2_000, price_per_unit: 0.08, net_amount: 160 };

describe("savingsSuggestions", () => {
  it("estimates the macOS→Linux saving from real SKU prices, scaled to a month", () => {
    const [s] = savingsSuggestions([linux, mac], undefined, 1.5);
    expect(s.key).toBe("macos");
    // 2000 min × (0.08 − 0.008) × 1.0 billed × 1.5
    expect(s.monthly).toBeCloseTo(216);
    expect(s.detail).toContain("10×");
  });

  it("scales by the billed share when included minutes covered part of the usage", () => {
    const [s] = savingsSuggestions([linux, { ...mac, net_amount: 80 }], undefined, 1);
    expect(s.monthly).toBeCloseTo(72);
  });

  it("flags spend concentration without inventing an amount", () => {
    const out = savingsSuggestions([linux], [
      { repo: "adi/big", minutes: 1, net_amount: 60 },
      { repo: "adi/small", minutes: 1, net_amount: 40 },
    ], 1);
    expect(out.find((s) => s.key === "concentration")).toMatchObject({ title: "Start with big", monthly: null });
  });

  it("suggests nothing for a Linux-only, evenly spread bill", () => {
    expect(savingsSuggestions([linux], [{ repo: "a/x", minutes: 1, net_amount: 1 }, { repo: "a/y", minutes: 1, net_amount: 1 }, { repo: "a/z", minutes: 1, net_amount: 1 }], 1)).toEqual([]);
  });
});
