import type { TranslationRequest } from "@/services/language-provider";
import { createLlmProfile } from "@/services/llm/llm-profile";
import { createLlmTranslationProvider } from "@/services/llm/llm-translation-provider";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

const PROFILE = { ...createLlmProfile("ollama", "p1"), model: "test-model" };

function request(overrides: Partial<TranslationRequest> = {}): TranslationRequest {
  return {
    main: [
      { id: "a", text: "line one" },
      { id: "b", text: "line two" },
    ],
    background: [{ id: "a", text: "bg one" }],
    targetLanguage: "en",
    sourceLanguage: "ja",
    context: { title: "", artists: [], album: "" },
    ...overrides,
  };
}

/** Each call pops the next reply; a reply is either an object for `lines`, a raw string, or an HTTP status. */
function stubReplies(...replies: Array<Record<string, string> | string | number>) {
  const prompts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      prompts.push(body.messages[1].content);
      const reply = replies.shift();
      if (reply === undefined) throw new Error("unexpected extra request");
      if (typeof reply === "number") return new Response("err", { status: reply });
      const content = typeof reply === "string" ? reply : JSON.stringify({ detectedLanguage: "ja", lines: reply });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }),
  );
  return prompts;
}

describe("createLlmTranslationProvider", () => {
  it("translates main and background lines in one request and maps keys back to ids", async () => {
    const prompts = stubReplies({ "1": "L1", "1b": "B1", "2": "L2" });
    const result = await createLlmTranslationProvider(PROFILE).translate(request());
    expect(prompts).toHaveLength(1);
    expect(result).toEqual({
      detectedLanguage: "ja",
      main: [
        { id: "a", text: "L1" },
        { id: "b", text: "L2" },
      ],
      background: [{ id: "a", text: "B1" }],
    });
  });

  it("retries only the missing keys once and keeps earlier results", async () => {
    const prompts = stubReplies({ "1": "L1" }, { "1b": "B1", "2": "L2" });
    const result = await createLlmTranslationProvider(PROFILE).translate(request());
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Full song for context only");
    expect(prompts[1]).toContain(JSON.stringify({ "1b": "bg one", "2": "line two" }, null, 2));
    expect(result.main.map((line) => line.text)).toEqual(["L1", "L2"]);
    expect(result.background[0].text).toBe("B1");
  });

  it("marks keys still missing after the retry as failed", async () => {
    stubReplies({ "1": "L1" }, { "1b": "B1" });
    const result = await createLlmTranslationProvider(PROFILE).translate(request());
    expect(result.main[1]).toEqual({ id: "b", text: null, failed: true });
  });

  it("returns null without failing when the translation equals the source", async () => {
    stubReplies({ "1": "LINE ONE", "1b": "B1", "2": "L2" });
    const result = await createLlmTranslationProvider(PROFILE).translate(request());
    expect(result.main[0]).toEqual({ id: "a", text: null });
  });

  it("chunks sequentially without splitting a main line from its background", async () => {
    const prompts = stubReplies({ "1": "L1", "1b": "B1" }, { "2": "L2" });
    const profile = { ...PROFILE, maxLinesPerRequest: 2 };
    const result = await createLlmTranslationProvider(profile).translate(request());
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain(JSON.stringify({ "1": "line one", "1b": "bg one" }, null, 2));
    expect(prompts[1]).toContain(JSON.stringify({ "2": "line two" }, null, 2));
    expect(prompts[1]).toContain("Full song for context only");
    expect(result.main.map((line) => line.text)).toEqual(["L1", "L2"]);
  });

  it("rejects when the first request fails at the HTTP level", async () => {
    stubReplies(401);
    await expect(createLlmTranslationProvider(PROFILE).translate(request())).rejects.toMatchObject({ kind: "auth" });
  });

  it("keeps earlier chunks when a later chunk fails, retrying its keys", async () => {
    stubReplies({ "1": "L1", "1b": "B1" }, 500, 500);
    const profile = { ...PROFILE, maxLinesPerRequest: 2 };
    const result = await createLlmTranslationProvider(profile).translate(request());
    expect(result.main[0].text).toBe("L1");
    expect(result.main[1]).toEqual({ id: "b", text: null, failed: true });
  });

  it("retries an unreadable first reply and throws bad-response if nothing ever parses", async () => {
    stubReplies("no json here", "still none");
    await expect(createLlmTranslationProvider(PROFILE).translate(request())).rejects.toMatchObject({
      kind: "bad-response",
    });
  });

  it("recovers when the retry parses after an unreadable first reply", async () => {
    stubReplies("no json here", { "1": "L1", "1b": "B1", "2": "L2" });
    const result = await createLlmTranslationProvider(PROFILE).translate(request());
    expect(result.main.map((line) => line.text)).toEqual(["L1", "L2"]);
  });

  it("translates a line that only has a background vocal", async () => {
    stubReplies({ "1": "L1", "2b": "B2" });
    const result = await createLlmTranslationProvider(PROFILE).translate(
      request({ main: [{ id: "a", text: "line one" }], background: [{ id: "c", text: "bg two" }] }),
    );
    expect(result.background).toEqual([{ id: "c", text: "B2" }]);
  });

  it("skips a blank main line without sending it or retrying, and still translates its background", async () => {
    const prompts = stubReplies({ "1b": "B2" });
    const result = await createLlmTranslationProvider(PROFILE).translate(
      request({ main: [{ id: "c", text: "" }], background: [{ id: "c", text: "bg two" }] }),
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(JSON.stringify({ "1b": "bg two" }, null, 2));
    expect(result.main).toEqual([{ id: "c", text: null }]);
    expect(result.background).toEqual([{ id: "c", text: "B2" }]);
  });

  it("makes no request and returns null results when every line is blank", async () => {
    const prompts = stubReplies();
    const result = await createLlmTranslationProvider(PROFILE).translate(
      request({ main: [{ id: "c", text: "  " }], background: [] }),
    );
    expect(prompts).toHaveLength(0);
    expect(result).toEqual({ detectedLanguage: "", main: [{ id: "c", text: null }], background: [] });
  });

  it("returns empty results without a request when there is nothing to translate", async () => {
    const prompts = stubReplies();
    const result = await createLlmTranslationProvider(PROFILE).translate(request({ main: [], background: [] }));
    expect(prompts).toHaveLength(0);
    expect(result).toEqual({ detectedLanguage: "", main: [], background: [] });
  });

  it("propagates aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    await expect(createLlmTranslationProvider(PROFILE).translate(request())).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("createLlmProfile", () => {
  it("fills the Ollama preset", () => {
    expect(createLlmProfile("ollama", "x")).toMatchObject({
      id: "x",
      preset: "ollama",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      maxLinesPerRequest: 80,
    });
  });

  it("starts the OpenAI-compatible preset blank", () => {
    expect(createLlmProfile("openai-compatible", "y")).toMatchObject({ baseUrl: "", label: "", model: "" });
  });
});
