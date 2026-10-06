import { describe, it, expect } from "vitest";
import { redirectsOn401 } from "@/lib/swr";

/** A background 401 must not bounce a signed-out reader off a public page. */
describe("redirectsOn401", () => {
  it("keeps visitors on public pages and their sub-pages", () => {
    for (const p of ["/welcome", "/login", "/setup", "/docs", "/docs/playground", "/docs/quick-start"]) {
      expect(redirectsOn401(p)).toBe(false);
    }
  });

  it("still sends signed-out visitors on app pages to sign-in", () => {
    for (const p of ["/", "/team", "/repos/a/b", "/docsx", "/settings"]) {
      expect(redirectsOn401(p)).toBe(true);
    }
  });
});
