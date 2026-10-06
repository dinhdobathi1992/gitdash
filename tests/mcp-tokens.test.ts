import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { sealData, unsealData } from "iron-session";

const SECRET_A = "a".repeat(24) + "-secret-a-for-mcp-token-tests";
const SECRET_B = "b".repeat(24) + "-secret-b-for-mcp-token-tests";
const SECRET_C = "c".repeat(24) + "-secret-c-for-mcp-token-tests";
const GH = "gho_FAKEtokenForTestsOnly0123456789abcd";

type Tokens = typeof import("@/lib/mcp/oauth/tokens");
type Keys = typeof import("@/lib/mcp/oauth/keys");

/** Fresh module graph with the given secrets (sessionOptions is read at import). */
async function load(current: string, previous?: string): Promise<{ t: Tokens; k: Keys }> {
  vi.resetModules();
  process.env.SESSION_SECRET = current;
  if (previous) process.env.MCP_PREVIOUS_SESSION_SECRET = previous;
  else delete process.env.MCP_PREVIOUS_SESSION_SECRET;
  const t = await import("@/lib/mcp/oauth/tokens");
  const k = await import("@/lib/mcp/oauth/keys");
  return { t, k };
}

const ident = { gh: GH, id: 4242, login: "octo" };
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const samples = {
  "mcp.tx": {
    nonce: "n-1",
    client_id: "https://client.example/meta.json",
    redirect_uri: "http://127.0.0.1:3333/callback",
    code_challenge: challenge,
    state: "xyz",
    resource: "https://gitdash.example/mcp/me",
    ...ident,
  },
  "mcp.code": {
    jti: uuid(1),
    grant_id: uuid(2),
    refresh_jti: uuid(3),
    client_id: "https://client.example/meta.json",
    redirect_uri: "http://127.0.0.1:3333/callback",
    code_challenge: challenge,
    resource: "https://gitdash.example/mcp/me",
    ...ident,
  },
  "mcp.access": {
    grant_id: uuid(2),
    client_id: "https://client.example/meta.json",
    aud: "https://gitdash.example/mcp/me",
    scope: "gitdash:read",
    ...ident,
  },
  "mcp.refresh": {
    jti: uuid(3),
    grant_id: uuid(2),
    client_id: "https://client.example/meta.json",
    aud: "https://gitdash.example/mcp/me",
    ...ident,
  },
  "mcp.client": {
    redirect_uris: ["cursor://anysphere.cursor-retrieval/oauth/callback"],
    client_name: "Cursor",
    application_type: "native" as const,
  },
  "mcp.key": {
    grant_id: uuid(4),
    aud: "https://gitdash.example/mcp/me",
    scope: "gitdash:read",
    source: "pat" as const,
    ...ident,
  },
};

const TYPES = Object.keys(samples) as (keyof typeof samples)[];
/** A grant's code key, as createGrant makes it: 32 random bytes, base64url. */
const CODE_KEY = Buffer.alloc(32, 7).toString("base64url");
const OTHER_CODE_KEY = Buffer.alloc(32, 8).toString("base64url");

let spies: MockInstance[] = [];

beforeEach(() => {
  spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  // No console output may ever carry the GitHub token or a sealed token.
  for (const s of spies) {
    for (const call of s.mock.calls) {
      const text = call.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" ");
      expect(text).not.toContain(GH);
      expect(text).not.toContain("Fe26.");
    }
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete process.env.MCP_PREVIOUS_SESSION_SECRET;
});

describe("seal/open round trip", () => {
  it.each(TYPES)("%s opens with its payload and iat/exp claims", async (typ) => {
    const { t } = await load(SECRET_A);
    const ttl = Math.min(60, t.TOKEN_TTL_SEC[typ]);
    const opts = typ === "mcp.code" ? { codeKey: CODE_KEY } : undefined;
    const token = await t.seal(typ, samples[typ] as never, ttl, opts);
    expect(token.startsWith("Fe26.2*")).toBe(true);
    const p = await t.open(typ, token, opts);
    expect(p).toMatchObject({ ...samples[typ], typ });
    expect(p!.exp - p!.iat).toBe(ttl);
  });

  it("mcp.tx without the GitHub identity is valid; a partial identity is not", async () => {
    const { t } = await load(SECRET_A);
    const pre = { ...samples["mcp.tx"], gh: undefined, id: undefined, login: undefined };
    const opened = await t.open("mcp.tx", await t.seal("mcp.tx", pre, 600));
    expect(opened).toMatchObject({ nonce: pre.nonce, client_id: pre.client_id, state: pre.state });
    expect(opened?.gh).toBeUndefined();
    await expect(t.seal("mcp.tx", { ...pre, gh: GH }, 600)).rejects.toThrow(TypeError);
  });
});

describe("open rejects", () => {
  it("a token 6 s past exp, though iron alone still accepts it", async () => {
    const { t, k } = await load(SECRET_A);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
    const token = await t.seal("mcp.access", samples["mcp.access"], 60);

    vi.setSystemTime(new Date("2026-10-06T00:01:04Z")); // exp + 4 s: inside tolerance
    expect(await t.open("mcp.access", token)).not.toBeNull();

    vi.setSystemTime(new Date("2026-10-06T00:01:06Z")); // exp + 6 s
    const raw = await unsealData<Record<string, unknown>>(token, { password: k.unsealPasswords("mcp.access") });
    expect(raw.grant_id).toBe(samples["mcp.access"].grant_id); // iron's 60 s skew would let it through
    expect(await t.open("mcp.access", token)).toBeNull();
  });

  it("a token issued more than 5 s in the future", async () => {
    const { t, k } = await load(SECRET_A);
    const now = Math.floor(Date.now() / 1000);
    const body = { ...samples["mcp.access"], typ: "mcp.access", iat: now + 30, exp: now + 90 };
    const token = await sealData(body, { password: k.sealPasswords("mcp.access"), ttl: 120 });
    expect(await t.open("mcp.access", token)).toBeNull();
  });

  it("the wrong type", async () => {
    const { t } = await load(SECRET_A);
    const access = await t.seal("mcp.access", samples["mcp.access"], 60);
    for (const other of TYPES.filter((x) => x !== "mcp.access")) {
      expect(await t.open(other, access)).toBeNull();
    }
  });

  it("a personal key as an access token, and an access token as a key", async () => {
    const { t, k } = await load(SECRET_A);
    const key = await t.seal("mcp.key", samples["mcp.key"], 60);
    const access = await t.seal("mcp.access", samples["mcp.access"], 60);
    expect(await t.open("mcp.access", key)).toBeNull();
    expect(await t.open("mcp.key", access)).toBeNull();
    // Neither opens as a refresh token or a code either.
    for (const typ of ["mcp.refresh", "mcp.code"] as const) {
      expect(await t.open(typ, key)).toBeNull();
    }
    // A key payload relabelled as an access token under the access key still fails the schema (no client_id).
    const now = Math.floor(Date.now() / 1000);
    const forged = await sealData({ ...samples["mcp.key"], typ: "mcp.access", iat: now, exp: now + 60 }, { password: k.sealPasswords("mcp.access"), ttl: 60 });
    expect(await t.open("mcp.access", forged)).toBeNull();
  });

  it("a key with an unknown source", async () => {
    const { t } = await load(SECRET_A);
    await expect(t.seal("mcp.key", { ...samples["mcp.key"], source: "cookie" as never }, 60)).rejects.toThrow(TypeError);
  });

  it("a typ claim that does not match, even under the right key", async () => {
    const { t, k } = await load(SECRET_A);
    const now = Math.floor(Date.now() / 1000);
    const body = { ...samples["mcp.refresh"], scope: "gitdash:read", typ: "mcp.refresh", iat: now, exp: now + 60 };
    const token = await sealData(body, { password: k.sealPasswords("mcp.access"), ttl: 60 });
    expect(await t.open("mcp.access", token)).toBeNull();
  });

  it("a token sealed with another type's key (access payload, refresh key)", async () => {
    const { t, k } = await load(SECRET_A);
    const now = Math.floor(Date.now() / 1000);
    const body = { ...samples["mcp.access"], typ: "mcp.access", iat: now, exp: now + 60 };
    const token = await sealData(body, { password: k.sealPasswords("mcp.refresh"), ttl: 60 });
    expect(await t.open("mcp.access", token)).toBeNull();
    expect(await t.open("mcp.refresh", token)).toBeNull();
  });

  it("a single flipped character anywhere that matters", async () => {
    const { t } = await load(SECRET_A);
    const token = await t.seal("mcp.access", samples["mcp.access"], 60);
    const parts = token.split("*");
    // salt, iv, ciphertext, expiry, hmac salt, hmac
    for (const idx of [2, 3, 4, 5, 6, 7]) {
      const p = [...parts];
      const s = p[idx];
      const i = Math.floor(s.length / 2);
      const swap = s[i] === "A" ? "B" : s[i] === "0" ? "1" : "A";
      p[idx] = s.slice(0, i) + swap + s.slice(i + 1);
      expect(await t.open("mcp.access", p.join("*"))).toBeNull();
    }
  });

  it("a session-cookie blob sealed with the raw session secret", async () => {
    const { t } = await load(SECRET_A);
    const { sessionOptions } = await import("@/lib/session");
    const cookie = await sealData({ accessToken: GH, user: { login: "octo" } }, { password: sessionOptions.password });
    for (const typ of TYPES) expect(await t.open(typ, cookie)).toBeNull();
  });

  it("an empty {} payload under the right key", async () => {
    const { t, k } = await load(SECRET_A);
    for (const typ of TYPES) {
      const token = await sealData({}, { password: k.sealPasswords(typ), ttl: 60 });
      expect(await t.open(typ, token)).toBeNull();
    }
  });

  it("a payload that breaks the schema (state over 512, redirect_uri over 1024)", async () => {
    const { t, k } = await load(SECRET_A);
    const now = Math.floor(Date.now() / 1000);
    for (const bad of [{ state: "s".repeat(513) }, { redirect_uri: "https://x/" + "r".repeat(1020) }]) {
      const body = { ...samples["mcp.tx"], ...bad, typ: "mcp.tx", iat: now, exp: now + 60 };
      const token = await sealData(body, { password: k.sealPasswords("mcp.tx"), ttl: 60 });
      expect(await t.open("mcp.tx", token)).toBeNull();
      await expect(t.seal("mcp.tx", { ...samples["mcp.tx"], ...bad }, 60)).rejects.toThrow(TypeError);
    }
  });

  it("garbage input, without throwing", async () => {
    const { t } = await load(SECRET_A);
    for (const junk of [undefined, null, 42, {}, "", "Fe26.2**", "x".repeat(20_000), "a*b*c*d*e*f*g*h", "Fe26.2*constructor*a*b*c**d*e~2"]) {
      await expect(t.open("mcp.access", junk)).resolves.toBeNull();
    }
  });
});

describe("authorization codes need the grant's code key", () => {
  it("a code does not open with SESSION_SECRET alone: the per-type key without the code key fails", async () => {
    const { t, k } = await load(SECRET_A);
    const code = await t.seal("mcp.code", samples["mcp.code"], 60, { codeKey: CODE_KEY });
    // Everything an attacker holding only SESSION_SECRET can derive: the per-type key map.
    const leaked = await unsealData<Record<string, unknown>>(code, { password: k.unsealPasswords("mcp.code"), ttl: 60 });
    expect(leaked).toEqual({});
    expect(JSON.stringify(leaked)).not.toContain(GH);
    // open() without a code key, or with another grant's, fails too.
    expect(await t.open("mcp.code", code)).toBeNull();
    expect(await t.open("mcp.code", code, { codeKey: OTHER_CODE_KEY })).toBeNull();
    expect(await t.open("mcp.code", code, { codeKey: CODE_KEY })).toMatchObject({ gh: GH });
  });

  it("a code sealed with only the per-type key (no code-key layer) does not open", async () => {
    const { t, k } = await load(SECRET_A);
    const now = Math.floor(Date.now() / 1000);
    const forged = await sealData({ ...samples["mcp.code"], typ: "mcp.code", iat: now, exp: now + 60 }, { password: k.sealPasswords("mcp.code"), ttl: 60 });
    expect(await t.open("mcp.code", forged, { codeKey: CODE_KEY })).toBeNull();
  });

  it("the code key layer survives secret rotation", async () => {
    const a = await load(SECRET_A);
    const code = await a.t.seal("mcp.code", samples["mcp.code"], 60, { codeKey: CODE_KEY });
    const b = await load(SECRET_B, SECRET_A);
    expect(await b.t.open("mcp.code", code, { codeKey: CODE_KEY })).toMatchObject({ jti: samples["mcp.code"].jti });
  });

  it("seal refuses a code without a valid code key, and a code key on any other type", async () => {
    const { t } = await load(SECRET_A);
    await expect(t.seal("mcp.code", samples["mcp.code"], 60)).rejects.toThrow(TypeError);
    await expect(t.seal("mcp.code", samples["mcp.code"], 60, { codeKey: "short" })).rejects.toThrow(TypeError);
    await expect(t.seal("mcp.access", samples["mcp.access"], 60, { codeKey: CODE_KEY })).rejects.toThrow(TypeError);
    const access = await t.seal("mcp.access", samples["mcp.access"], 60);
    expect(await t.open("mcp.access", access, { codeKey: CODE_KEY })).toBeNull();
  });

  it("the wire format is <grant_id>.<sealed>, and parseCode refuses anything else", async () => {
    const { t } = await load(SECRET_A);
    const sealed = await t.seal("mcp.code", samples["mcp.code"], 60, { codeKey: CODE_KEY });
    const code = t.formatCode(samples["mcp.code"].grant_id, sealed);
    expect(code).toBe(`${samples["mcp.code"].grant_id}.${sealed}`);
    expect(t.parseCode(code)).toEqual({ grantId: samples["mcp.code"].grant_id, sealed });
    for (const bad of [sealed, `not-a-uuid.${sealed}`, `${samples["mcp.code"].grant_id}.`, `${samples["mcp.code"].grant_id}${sealed}`, 42, null]) {
      expect(t.parseCode(bad)).toBeNull();
    }
    expect(() => t.formatCode("nope", sealed)).toThrow(TypeError);
  });
});

describe("seal validation", () => {
  it("refuses a ttl above the type's lifetime or a non-integer ttl", async () => {
    const { t } = await load(SECRET_A);
    await expect(t.seal("mcp.code", samples["mcp.code"], 61)).rejects.toThrow(RangeError);
    await expect(t.seal("mcp.access", samples["mcp.access"], 0)).rejects.toThrow(RangeError);
    await expect(t.seal("mcp.access", samples["mcp.access"], 1.5)).rejects.toThrow(RangeError);
    // A key lives 30 days at most.
    expect(t.TOKEN_TTL_SEC["mcp.key"]).toBe(30 * 24 * 3600);
    await expect(t.seal("mcp.key", samples["mcp.key"], 30 * 24 * 3600 + 1)).rejects.toThrow(RangeError);
  });

  it("does not echo payload values (the GitHub token) in its error", async () => {
    const { t } = await load(SECRET_A);
    const err = await t.seal("mcp.access", { ...samples["mcp.access"], grant_id: "nope" }, 60).catch((e: Error) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toContain("grant_id");
    expect((err as Error).message).not.toContain(GH);
  });
});

describe("key derivation and rotation", () => {
  it("derives a distinct 43-char key per type under one key id", async () => {
    const { k } = await load(SECRET_A);
    const maps = k.TOKEN_TYPES.map((typ) => k.sealPasswords(typ));
    const ids = new Set(maps.flatMap((m) => Object.keys(m)));
    const keys = new Set(maps.flatMap((m) => Object.values(m)));
    expect(ids.size).toBe(1);
    expect(keys.size).toBe(k.TOKEN_TYPES.length);
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([...keys]).not.toContain(SECRET_A);
  });

  it("a token sealed under the previous secret opens; once that secret is removed it does not", async () => {
    const a = await load(SECRET_A);
    const old = await a.t.seal("mcp.refresh", samples["mcp.refresh"], 3600);

    const b = await load(SECRET_B, SECRET_A);
    expect(Object.keys(b.k.unsealPasswords("mcp.refresh"))).toHaveLength(2);
    expect(await b.t.open("mcp.refresh", old)).toMatchObject({ jti: samples["mcp.refresh"].jti });
    const fresh = await b.t.seal("mcp.refresh", samples["mcp.refresh"], 3600);
    // New tokens are sealed with the current secret only.
    expect(Object.keys(b.k.sealPasswords("mcp.refresh"))).toEqual(fresh.split("*").slice(1, 2));

    const removed = await load(SECRET_B);
    expect(await removed.t.open("mcp.refresh", old)).toBeNull();
    expect(await removed.t.open("mcp.refresh", fresh)).not.toBeNull();

    // A second rotation keeps working: ids follow the secret, not its position.
    const c = await load(SECRET_C, SECRET_B);
    expect(await c.t.open("mcp.refresh", fresh)).not.toBeNull();
    expect(await c.t.open("mcp.refresh", old)).toBeNull();
  });

  it("trims surrounding whitespace from the previous secret", async () => {
    const a = await load(SECRET_A);
    const old = await a.t.seal("mcp.refresh", samples["mcp.refresh"], 3600);
    const b = await load(SECRET_B, `${SECRET_A}\n`);
    expect(await b.t.open("mcp.refresh", old)).not.toBeNull();
  });

  it("refuses the public dev fallback secret outside development and test", async () => {
    vi.resetModules();
    delete process.env.SESSION_SECRET;
    delete process.env.MCP_PREVIOUS_SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "staging");
    try {
      const t = await import("@/lib/mcp/oauth/tokens");
      await expect(t.seal("mcp.access", samples["mcp.access"], 60)).rejects.toThrow(/SESSION_SECRET/);
      // open() fails closed and reports the configuration fault once.
      expect(await t.open("mcp.access", "Fe26.2**x")).toBeNull();
      expect(await t.open("mcp.access", "Fe26.2**y")).toBeNull();
      const errors = (console.error as unknown as MockInstance).mock.calls.filter((c) => String(c[0]).includes("token keys unavailable"));
      expect(errors).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("ignores a previous secret shorter than 32 characters", async () => {
    const { k } = await load(SECRET_B, "too-short");
    expect(Object.keys(k.unsealPasswords("mcp.access"))).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
