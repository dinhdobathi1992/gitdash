import { describe, it, expect } from "vitest";
import { isBot, normalizeBotLogin } from "@/lib/bots";
import { isBot as reexported } from "@/lib/working-habits";

describe("isBot", () => {
  it.each(["dependabot[bot]", "renovate", "github-actions", "Dependabot", "github-advanced-security[bot]"])("%s is a bot", (l) =>
    expect(isBot(l)).toBe(true));
  it.each(["alice", "botanist", null])("%s is not", (l) => expect(isBot(l)).toBe(false));
  it("trusts the API's type", () => {
    expect(isBot("copilot-swe-agent", "Bot")).toBe(true);
    expect(isBot("alice", "User")).toBe(false);
  });
  it("working-habits re-exports the same rule", () => expect(reexported).toBe(isBot));
});

describe("normalizeBotLogin", () => {
  it("appends [bot] to GraphQL bot logins so REST and GraphQL agree", () => {
    expect(normalizeBotLogin("github-advanced-security", "Bot")).toBe("github-advanced-security[bot]");
    expect(normalizeBotLogin("dependabot[bot]", "Bot")).toBe("dependabot[bot]");
    expect(normalizeBotLogin("alice", "User")).toBe("alice");
    expect(normalizeBotLogin("alice")).toBe("alice");
  });
});
