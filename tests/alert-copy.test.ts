import { describe, it, expect } from "vitest";
import { alertTitle, ruleSentence, channelLabel, firingAlerts, scopeLabel, type AlertRuleLike, type AlertEventLike } from "@/lib/alert-copy";

const NOW = Date.parse("2026-09-27T10:00:00Z");
const rule = (over: Partial<AlertRuleLike> = {}): AlertRuleLike => ({
  id: 1, scope: "repo:adi/tesda-backend", metric: "failure_rate", threshold: 20, window_hours: 24,
  channel: "slack", destination: "https://hooks.slack.com/services/x", enabled: true, muted_until: null, ...over,
});
const ev = (over: Partial<AlertEventLike> = {}): AlertEventLike => ({
  id: 1, rule_id: 1, scope: "repo:adi/tesda-backend", metric: "failure_rate", value: 33,
  fired_at: "2026-09-27T09:42:00Z", ...over,
});

describe("alert copy", () => {
  it("says what is wrong in the title", () => {
    expect(alertTitle(ev())).toBe("Failure rate is 33% on tesda-backend");
    expect(alertTitle(ev({ metric: "duration_p95", value: 14.2 }))).toBe("p95 duration is 14.2 min on tesda-backend");
  });

  it("formats NUMERIC columns that arrive as strings", () => {
    expect(ruleSentence(rule({ threshold: "20.00" as unknown as number }))).toBe("Failure rate above 20% in 24 hours");
    expect(alertTitle(ev({ value: "33.3" as unknown as number }))).toBe("Failure rate is 33.3% on tesda-backend");
    expect(alertTitle(ev({ value: "abc" as unknown as number }))).toBe("Failure rate is — on tesda-backend");
  });

  it("describes rules in sentence case", () => {
    expect(ruleSentence(rule())).toBe("Failure rate above 20% in 24 hours");
  });

  it("never echoes a Slack webhook URL", () => {
    expect(channelLabel(rule())).toBe("Slack · webhook");
    expect(channelLabel(rule({ channel: "email", destination: "team@x.io" }))).toBe("Email · team@x.io");
  });

  it("labels scopes", () => {
    expect(scopeLabel("*")).toBe("All repositories");
    expect(scopeLabel("org:adi")).toBe("adi");
  });
});

describe("firingAlerts", () => {
  it("keeps the newest event per scope+metric inside the window", () => {
    const out = firingAlerts([ev({ id: 2, fired_at: "2026-09-27T08:00:00Z" }), ev({ id: 3 })], [rule()], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].event.id).toBe(3);
    expect(out[0].href).toBe("/repos/adi/tesda-backend");
  });

  it("drops events outside the rule window, muted rules and disabled rules", () => {
    expect(firingAlerts([ev({ fired_at: "2026-09-25T00:00:00Z" })], [rule()], NOW)).toHaveLength(0);
    expect(firingAlerts([ev()], [rule({ muted_until: "2026-09-27T11:00:00Z" })], NOW)).toHaveLength(0);
    expect(firingAlerts([ev()], [rule({ enabled: false })], NOW)).toHaveLength(0);
  });

  it("uses a 24 h window when the rule is gone and skips digests", () => {
    expect(firingAlerts([ev({ rule_id: 99 })], [], NOW)).toHaveLength(1);
    expect(firingAlerts([ev({ metric: "leadership_digest" })], [], NOW)).toHaveLength(0);
  });
});
