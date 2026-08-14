import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { seal, unseal, maskHint } from "@/lib/secret-box";

const GOOD_SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);

beforeEach(() => {
  process.env.SESSION_SECRET = GOOD_SECRET;
});
afterEach(() => {
  delete process.env.SESSION_SECRET;
});

describe("seal / unseal", () => {
  it("round-trips a secret", () => {
    const key = "re_live_abcdef123456";
    expect(unseal(seal(key))).toBe(key);
  });

  it("round-trips unicode and long values", () => {
    const v = "sk-ünïcøde-🔑-" + "x".repeat(500);
    expect(unseal(seal(v))).toBe(v);
  });

  it("never emits the plaintext in the sealed form", () => {
    const key = "re_live_SUPERSECRETVALUE";
    expect(seal(key)).not.toContain("SUPERSECRETVALUE");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = seal("same-input");
    const b = seal("same-input");
    expect(a).not.toBe(b);
    // …but both still decrypt correctly.
    expect(unseal(a)).toBe("same-input");
    expect(unseal(b)).toBe("same-input");
  });

  it("carries a version prefix so the algorithm can be rotated later", () => {
    expect(seal("x").startsWith("v1.")).toBe(true);
  });
});

describe("unseal — failure modes all return null rather than throwing", () => {
  it("returns null for a value sealed under a different SESSION_SECRET", () => {
    const sealed = seal("secret");
    process.env.SESSION_SECRET = OTHER_SECRET;
    expect(unseal(sealed)).toBeNull();
  });

  it("returns null when the ciphertext has been tampered with", () => {
    const sealed = seal("secret");
    const parts = sealed.split(".");
    // Flip the payload; the GCM auth tag must reject it.
    parts[3] = Buffer.from("tampered-payload").toString("base64");
    expect(unseal(parts.join("."))).toBeNull();
  });

  it("returns null when the auth tag has been swapped", () => {
    const sealed = seal("secret");
    const parts = sealed.split(".");
    parts[2] = Buffer.from("0123456789abcdef").toString("base64");
    expect(unseal(parts.join("."))).toBeNull();
  });

  it("returns null on a malformed or empty string", () => {
    for (const bad of ["", "garbage", "v1.only.three", "v9.a.b.c"]) {
      expect(unseal(bad)).toBeNull();
    }
  });

  it("does not throw when SESSION_SECRET is missing", () => {
    const sealed = seal("secret");
    delete process.env.SESSION_SECRET;
    expect(() => unseal(sealed)).not.toThrow();
    expect(unseal(sealed)).toBeNull();
  });
});

describe("seal — refuses a weak root secret", () => {
  it("throws when SESSION_SECRET is too short to derive a key from", () => {
    process.env.SESSION_SECRET = "short";
    expect(() => seal("x")).toThrow(/SESSION_SECRET/);
  });

  it("throws when SESSION_SECRET is missing entirely", () => {
    delete process.env.SESSION_SECRET;
    expect(() => seal("x")).toThrow(/SESSION_SECRET/);
  });
});

describe("maskHint", () => {
  it("shows only the last four characters", () => {
    expect(maskHint("re_live_abcdef4f2a")).toBe("••••4f2a");
  });

  it("reveals nothing at all for a short value", () => {
    expect(maskHint("abc")).toBe("••••");
    expect(maskHint("1234567")).toBe("••••");
  });

  it("never contains the leading part of the secret", () => {
    expect(maskHint("re_live_SECRETHEAD_9999")).not.toContain("SECRETHEAD");
  });
});
