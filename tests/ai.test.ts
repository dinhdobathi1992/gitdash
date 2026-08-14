import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The AI layer reads process.env inside its functions, so each test can set
 * env directly. `fetch` is stubbed globally — no test in this file touches
 * the network.
 */

const AI_ENV = [
  "AI_DISABLED",
  "BAILIAN_API_KEY",
  "BAILIAN_BASE_URL",
  "BAILIAN_MODEL",
  "AI_TIMEOUT_MS",
  "AI_TOTAL_BUDGET_MS",
  "AI_DAILY_TOKEN_BUDGET",
  "GEMINI_API_KEY",
  "GEMINI_BASE_URL",
  "GEMINI_MODEL",
  "QWEN_API_KEY",
  "QWEN_BASE_URL",
  "QWEN_MODEL",
];

function clearAiEnv() {
  for (const k of AI_ENV) delete process.env[k];
}

/** Minimal OpenAI-compatible success body. */
function okBody(content = '{"summary":"ok"}', usage = { prompt_tokens: 100, completion_tokens: 20 }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }], usage }),
  } as unknown as Response;
}

function errBody(status: number) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  clearAiEnv();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Silence the layer's structured logging during tests.
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { __resetBudgetForTests } = await import("@/lib/ai");
  __resetBudgetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearAiEnv();
});

describe("aiEnabled", () => {
  it("is false when no provider key is set", async () => {
    const { aiEnabled } = await import("@/lib/ai");
    expect(aiEnabled()).toBe(false);
  });

  it("is true when GEMINI_API_KEY is set", async () => {
    process.env.GEMINI_API_KEY = "k";
    const { aiEnabled } = await import("@/lib/ai");
    expect(aiEnabled()).toBe(true);
  });

  it("is true when only QWEN_API_KEY is set", async () => {
    process.env.QWEN_API_KEY = "k";
    const { aiEnabled } = await import("@/lib/ai");
    expect(aiEnabled()).toBe(true);
  });

  it("is false when AI_DISABLED=true even with keys present", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.QWEN_API_KEY = "k";
    process.env.AI_DISABLED = "true";
    const { aiEnabled } = await import("@/lib/ai");
    expect(aiEnabled()).toBe(false);
  });
});

describe("configuredProviders", () => {
  it("returns an empty list with no keys", async () => {
    const { configuredProviders } = await import("@/lib/ai");
    expect(configuredProviders()).toEqual([]);
  });

  it("returns gemini before qwen when both are configured", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.QWEN_API_KEY = "k";
    const { configuredProviders } = await import("@/lib/ai");
    expect(configuredProviders()).toEqual(["gemini", "qwen"]);
  });

  it("never leaks key material", async () => {
    process.env.GEMINI_API_KEY = "super-secret-value";
    const { configuredProviders } = await import("@/lib/ai");
    expect(JSON.stringify(configuredProviders())).not.toContain("super-secret-value");
  });
});

describe("generateJson — gating", () => {
  it("returns no_keys and does not call fetch when unconfigured", async () => {
    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", { a: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_keys");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns disabled when AI_DISABLED=true", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.AI_DISABLED = "true";
    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("generateJson — request shape", () => {
  it("posts to <base>/chat/completions with json_object mode and temperature 0.2", async () => {
    process.env.GEMINI_API_KEY = "secret-key";
    process.env.GEMINI_BASE_URL = "https://example.test/v1";
    process.env.GEMINI_MODEL = "test-model";
    fetchMock.mockResolvedValueOnce(okBody());

    const { generateJson } = await import("@/lib/ai");
    await generateJson("SYSTEM PROMPT", { scope: "o/r" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("test-model");
    expect(body.temperature).toBe(0.2);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]).toEqual({ role: "system", content: "SYSTEM PROMPT" });
    expect(body.messages[1].role).toBe("user");
    expect(JSON.parse(body.messages[1].content)).toEqual({ scope: "o/r" });
  });

  it("strips a trailing slash from the configured base URL", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.GEMINI_BASE_URL = "https://example.test/v1/";
    fetchMock.mockResolvedValueOnce(okBody());

    const { generateJson } = await import("@/lib/ai");
    await generateJson("sys", {});
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/v1/chat/completions");
  });

  it("returns ok with provider and content on a 200", async () => {
    process.env.GEMINI_API_KEY = "k";
    fetchMock.mockResolvedValueOnce(okBody('{"summary":"hello"}'));

    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provider).toBe("gemini");
      expect(r.content).toBe('{"summary":"hello"}');
      expect(r.usage).toEqual({ prompt_tokens: 100, completion_tokens: 20 });
    }
  });
});

describe("generateJson — fallback behaviour", () => {
  it("falls back to qwen on a 401 without retrying gemini", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.QWEN_API_KEY = "k";
    fetchMock.mockResolvedValueOnce(errBody(401)).mockResolvedValueOnce(okBody());

    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", {});

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toBe("qwen");
    expect(fetchMock).toHaveBeenCalledTimes(2); // no retry of the 401
  });

  it("retries once after a 429 before falling back", async () => {
    process.env.GEMINI_API_KEY = "k";
    fetchMock.mockResolvedValueOnce(errBody(429)).mockResolvedValueOnce(okBody());

    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", {});

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toBe("gemini");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to qwen when gemini 500s twice", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.QWEN_API_KEY = "k";
    fetchMock
      .mockResolvedValueOnce(errBody(500))
      .mockResolvedValueOnce(errBody(500))
      .mockResolvedValueOnce(okBody());

    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", {});

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toBe("qwen");
  });

  it("treats an empty completion as retryable", async () => {
    process.env.GEMINI_API_KEY = "k";
    fetchMock.mockResolvedValueOnce(okBody("   ")).mockResolvedValueOnce(okBody('{"a":1}'));

    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", {});
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns provider_error when every provider fails", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.QWEN_API_KEY = "k";
    fetchMock.mockResolvedValue(errBody(403)); // fatal for both, no retries

    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", {});

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("provider_error");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never throws when fetch itself rejects", async () => {
    process.env.GEMINI_API_KEY = "k";
    fetchMock.mockRejectedValue(new Error("network down"));

    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", {});
    expect(r.ok).toBe(false);
  });
});

describe("generateJson — time budget", () => {
  it("returns timeout when a provider exceeds the per-attempt timeout", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.AI_TIMEOUT_MS = "10";
    process.env.AI_TOTAL_BUDGET_MS = "40";

    // Reject with an AbortError once the signal fires, like real fetch does.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["timeout", "provider_error"]).toContain(r.reason);
  });

  it("does not attempt the fallback provider once the total budget is spent", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.QWEN_API_KEY = "k";
    // The primary alone can consume the whole wall-clock budget: its attempt is
    // capped at min(30, remaining) = 25ms, leaving nothing for qwen.
    process.env.AI_TIMEOUT_MS = "30";
    process.env.AI_TOTAL_BUDGET_MS = "25";

    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", {});

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("timeout");
    // Only the primary was tried — the deadline check skipped qwen entirely.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("generateJson — daily token budget", () => {
  it("short-circuits without calling fetch once the budget is spent", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.AI_DAILY_TOKEN_BUDGET = "100";
    fetchMock.mockResolvedValueOnce(okBody('{"a":1}', { prompt_tokens: 90, completion_tokens: 30 }));

    const { generateJson } = await import("@/lib/ai");

    const first = await generateJson("sys", {});
    expect(first.ok).toBe(true); // 120 tokens recorded, over the 100 limit
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await generateJson("sys", {});
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("budget_exceeded");
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second network call
  });

  it("treats a budget of 0 as unlimited", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.AI_DAILY_TOKEN_BUDGET = "0";
    fetchMock.mockResolvedValue(okBody('{"a":1}', { prompt_tokens: 10_000, completion_tokens: 10_000 }));

    const { generateJson } = await import("@/lib/ai");
    await generateJson("sys", {});
    const second = await generateJson("sys", {});
    expect(second.ok).toBe(true);
  });

  it("budgetSnapshot reports usage without exposing keys", async () => {
    process.env.GEMINI_API_KEY = "super-secret-value";
    process.env.AI_DAILY_TOKEN_BUDGET = "5000";
    fetchMock.mockResolvedValueOnce(okBody('{"a":1}', { prompt_tokens: 7, completion_tokens: 3 }));

    const { generateJson, budgetSnapshot } = await import("@/lib/ai");
    await generateJson("sys", {});

    const snap = budgetSnapshot();
    expect(snap.tokens).toBe(10);
    expect(snap.limit).toBe(5000);
    expect(JSON.stringify(snap)).not.toContain("super-secret-value");
  });
});

// ── Anthropic-protocol provider (Bailian, v4.1.1) ─────────────────────────────

/** Anthropic Messages API success body. */
function anthropicBody(text = '{"summary":"ok"}', blocks?: { type: string; text?: string }[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: blocks ?? [{ type: "text", text }],
      usage: { input_tokens: 42, output_tokens: 85 },
    }),
  } as unknown as Response;
}

describe("generateJson — Anthropic protocol (bailian)", () => {
  it("posts to /messages with x-api-key and the system prompt as a top-level field", async () => {
    process.env.BAILIAN_API_KEY = "sk-test";
    process.env.BAILIAN_BASE_URL = "https://bailian.test/apps/anthropic/v1";
    process.env.BAILIAN_MODEL = "qwen3.6-flash";
    fetchMock.mockResolvedValueOnce(anthropicBody());

    const { generateJson } = await import("@/lib/ai");
    await generateJson("SYSTEM", { a: 1 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://bailian.test/apps/anthropic/v1/messages");

    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.Authorization).toBeUndefined(); // not the OpenAI scheme

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("qwen3.6-flash");
    expect(body.system).toBe("SYSTEM"); // top-level, not a message role
    expect(body.messages).toEqual([{ role: "user", content: '{"a":1}' }]);
    expect(body.response_format).toBeUndefined(); // not an Anthropic concept
  });

  it("disables extended thinking to avoid ~10x output-token cost", async () => {
    process.env.BAILIAN_API_KEY = "k";
    fetchMock.mockResolvedValueOnce(anthropicBody());

    const { generateJson } = await import("@/lib/ai");
    await generateJson("sys", {});

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("extracts the text block, not content[0], when a thinking block is present", async () => {
    process.env.BAILIAN_API_KEY = "k";
    // A model may ignore thinking:disabled — content[0].text would be undefined.
    fetchMock.mockResolvedValueOnce(
      anthropicBody(undefined, [
        { type: "thinking", text: undefined },
        { type: "text", text: '{"summary":"real answer"}' },
      ]),
    );

    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", {});

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe('{"summary":"real answer"}');
  });

  it("maps input_tokens/output_tokens onto the shared usage shape", async () => {
    process.env.BAILIAN_API_KEY = "k";
    process.env.AI_DAILY_TOKEN_BUDGET = "1000";
    fetchMock.mockResolvedValueOnce(anthropicBody());

    const { generateJson, budgetSnapshot } = await import("@/lib/ai");
    const r = await generateJson("sys", {});

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.usage).toEqual({ prompt_tokens: 42, completion_tokens: 85 });
    expect(budgetSnapshot().tokens).toBe(127);
  });

  it("treats a response with no text block as retryable", async () => {
    process.env.BAILIAN_API_KEY = "k";
    fetchMock
      .mockResolvedValueOnce(anthropicBody(undefined, [{ type: "thinking" }]))
      .mockResolvedValueOnce(anthropicBody());

    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", {});

    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is tried before gemini when both are configured", async () => {
    process.env.BAILIAN_API_KEY = "k";
    process.env.GEMINI_API_KEY = "k";
    fetchMock.mockResolvedValueOnce(anthropicBody());

    const { generateJson, configuredProviders } = await import("@/lib/ai");
    expect(configuredProviders()).toEqual(["bailian", "gemini"]);

    const r = await generateJson("sys", {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toBe("bailian");
  });

  it("falls back from bailian to gemini across protocols", async () => {
    process.env.BAILIAN_API_KEY = "k";
    process.env.GEMINI_API_KEY = "k";
    fetchMock.mockResolvedValueOnce(errBody(401)).mockResolvedValueOnce(okBody());

    const { generateJson } = await import("@/lib/ai");
    const r = await generateJson("sys", {});

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toBe("gemini");
    // Second call used the OpenAI shape, proving the protocol switched.
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody.messages[0].role).toBe("system");
  });
});
