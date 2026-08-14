import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Provider resolution: database settings first, environment variables second.
 *
 * The critical property under test is the fallback guarantee — an instance
 * that already had RESEND_API_KEY set must keep working after v4.1.3 without
 * anyone touching Settings.
 */

const getEmailSettings = vi.fn();

vi.mock("@/lib/db", () => ({
  getEmailSettings: () => getEmailSettings(),
}));

const ENV = ["SESSION_SECRET", "RESEND_API_KEY", "RESEND_FROM", "SMTP_HOST", "SMTP_PASS", "SMTP_FROM", "SMTP_USER", "SENDGRID_API_KEY"];

function clearEnv() {
  for (const k of ENV) delete process.env[k];
}

beforeEach(async () => {
  clearEnv();
  process.env.SESSION_SECRET = "a".repeat(64);
  getEmailSettings.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  // The resolver memoises for 30s — clear between cases.
  const { cacheDelete } = await import("@/lib/cache");
  cacheDelete("email-provider:settings");
});

afterEach(() => {
  clearEnv();
  vi.restoreAllMocks();
});

async function resolve() {
  const { resolveEmailProvider } = await import("@/lib/notifier");
  return resolveEmailProvider();
}

async function sealed(value: string) {
  const { seal } = await import("@/lib/secret-box");
  return seal(value);
}

describe("resolveEmailProvider — nothing configured", () => {
  it("returns null when neither database nor env has config", async () => {
    getEmailSettings.mockResolvedValue(null);
    expect(await resolve()).toBeNull();
  });

  it("returns null when the database row exists but is disabled", async () => {
    getEmailSettings.mockResolvedValue({
      enabled: false, provider: "resend",
      api_key_sealed: await sealed("re_key"), from_address: "a@b.com",
    });
    expect(await resolve()).toBeNull();
  });

  it("returns null when enabled but no key is stored", async () => {
    getEmailSettings.mockResolvedValue({
      enabled: true, provider: "resend", api_key_sealed: null, from_address: "a@b.com",
    });
    expect(await resolve()).toBeNull();
  });
});

describe("resolveEmailProvider — database config", () => {
  it("uses stored settings and decrypts the key", async () => {
    getEmailSettings.mockResolvedValue({
      enabled: true, provider: "resend",
      api_key_sealed: await sealed("re_from_db"), from_address: "alerts@corp.com",
    });

    const cfg = await resolve();
    expect(cfg).toEqual({
      provider: "resend",
      apiKey: "re_from_db",
      from: "alerts@corp.com",
      source: "settings",
    });
  });

  it("supports sendgrid as the stored provider", async () => {
    getEmailSettings.mockResolvedValue({
      enabled: true, provider: "sendgrid",
      api_key_sealed: await sealed("SG.key"), from_address: "a@b.com",
    });
    expect((await resolve())?.provider).toBe("sendgrid");
  });

  it("takes precedence over environment variables", async () => {
    process.env.RESEND_API_KEY = "re_from_env";
    getEmailSettings.mockResolvedValue({
      enabled: true, provider: "resend",
      api_key_sealed: await sealed("re_from_db"), from_address: "a@b.com",
    });

    const cfg = await resolve();
    expect(cfg?.apiKey).toBe("re_from_db");
    expect(cfg?.source).toBe("settings");
  });
});

describe("resolveEmailProvider — environment fallback", () => {
  it("uses RESEND_API_KEY when the database has no config", async () => {
    getEmailSettings.mockResolvedValue(null);
    process.env.RESEND_API_KEY = "re_env";
    process.env.RESEND_FROM = "env@corp.com";

    expect(await resolve()).toEqual({
      provider: "resend", apiKey: "re_env", from: "env@corp.com", source: "env",
    });
  });

  it("keeps a pre-v4.1.3 env-only instance working when the database is unreachable", async () => {
    // This is the upgrade-safety guarantee: no DATABASE_URL, env still wins.
    getEmailSettings.mockRejectedValue(new Error("DATABASE_URL is not set"));
    process.env.RESEND_API_KEY = "re_env";

    const cfg = await resolve();
    expect(cfg?.apiKey).toBe("re_env");
    expect(cfg?.source).toBe("env");
  });

  it("falls back to the SendGrid env pair", async () => {
    getEmailSettings.mockResolvedValue(null);
    process.env.SMTP_HOST = "https://api.sendgrid.com";
    process.env.SMTP_PASS = "SG.env";
    process.env.SMTP_FROM = "sg@corp.com";

    expect(await resolve()).toEqual({
      provider: "sendgrid", apiKey: "SG.env", from: "sg@corp.com", source: "env",
    });
  });

  it("does not treat SMTP_HOST alone as configured — a host without a key cannot send", async () => {
    getEmailSettings.mockResolvedValue(null);
    process.env.SMTP_HOST = "https://api.sendgrid.com";
    expect(await resolve()).toBeNull();
  });
});

describe("resolveEmailProvider — undecryptable stored key", () => {
  it("falls back to env instead of failing outright", async () => {
    const good = await sealed("re_from_db");
    // Simulate SESSION_SECRET having been rotated since the key was stored.
    process.env.SESSION_SECRET = "c".repeat(64);
    process.env.RESEND_API_KEY = "re_env";
    getEmailSettings.mockResolvedValue({
      enabled: true, provider: "resend", api_key_sealed: good, from_address: "a@b.com",
    });

    const cfg = await resolve();
    expect(cfg?.apiKey).toBe("re_env");
    expect(cfg?.source).toBe("env");
  });

  it("logs an actionable message so the operator can re-enter it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = await sealed("re_from_db");
    process.env.SESSION_SECRET = "c".repeat(64);
    getEmailSettings.mockResolvedValue({
      enabled: true, provider: "resend", api_key_sealed: good, from_address: "a@b.com",
    });

    await resolve();
    expect(spy.mock.calls.flat().join(" ")).toMatch(/could not be decrypted/i);
  });

  it("never logs the sealed value itself", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = await sealed("re_SENSITIVE");
    process.env.SESSION_SECRET = "c".repeat(64);
    getEmailSettings.mockResolvedValue({
      enabled: true, provider: "resend", api_key_sealed: good, from_address: "a@b.com",
    });

    await resolve();
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain(good);
    expect(logged).not.toContain("re_SENSITIVE");
  });
});
