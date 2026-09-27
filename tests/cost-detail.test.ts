import { describe, it, expect } from "vitest";
import { foldUsageDetail, runnerOs } from "@/lib/cost-detail";

describe("runnerOs", () => {
  it("maps SKUs to runner OS", () => {
    expect(runnerOs("actions_linux_4_core")).toBe("linux");
    expect(runnerOs("actions_macos_xlarge")).toBe("macos");
    expect(runnerOs("actions_windows")).toBe("windows");
    expect(runnerOs("actions_storage")).toBe("other");
  });
});

describe("foldUsageDetail", () => {
  it("sums spend per day by OS and per repository, ignoring other products", () => {
    const { daily, repos } = foldUsageDetail([
      { date: "2026-09-02T00:00:00Z", product: "Actions", sku: "actions_linux", quantity: 100, netAmount: 0.8, repositoryName: "adi/api" },
      { date: "2026-09-01T00:00:00Z", product: "Actions", sku: "actions_macos", quantity: 10, netAmount: 0.8, repositoryName: "adi/app" },
      { date: "2026-09-01T00:00:00Z", product: "Actions", sku: "actions_linux", quantity: 50, netAmount: 0.4, repositoryName: "adi/api" },
      { date: "2026-09-01T00:00:00Z", product: "Packages", sku: "packages_storage", quantity: 1, netAmount: 9, repositoryName: "adi/api" },
    ]);
    expect(daily.map((d) => d.date)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(daily[0]).toMatchObject({ linux: 0.4, macos: 0.8 });
    expect(repos[0]).toMatchObject({ repo: "adi/api", minutes: 150 });
    expect(repos[0].net_amount).toBeCloseTo(1.2);
  });
});
