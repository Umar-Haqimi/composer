import {
  DEFAULT_TRANSLATION_INSTRUCTIONS,
  buildTranslationMessages,
  parseTranslationResponse,
} from "@/services/llm/translation-prompt";
import { describe, expect, it } from "vitest";

const ITEMS = [
  { key: "1", text: "line one" },
  { key: "1b", text: "bg one" },
  { key: "2", text: "line two" },
];
const CONTEXT = { title: "Song Title", artists: ["Artist A", "Artist B"], album: "Album X" };

function build(overrides: Partial<Parameters<typeof buildTranslationMessages>[0]> = {}) {
  return buildTranslationMessages({
    items: ITEMS,
    targetLanguage: "en",
    sourceLanguage: "ja",
    context: CONTEXT,
    instructions: "Keep it casual.",
    ...overrides,
  });
}

describe("buildTranslationMessages", () => {
  it("returns a system and a user message", () => {
    expect(build().map((message) => message.role)).toEqual(["system", "user"]);
  });

  it("names the target language and the JSON contract in the system message", () => {
    const [system] = build();
    expect(system.content).toContain("English (en)");
    expect(system.content).toContain('{"detectedLanguage"');
    expect(system.content).toContain("background vocal");
  });

  it("puts custom instructions in their own block after the fixed rules", () => {
    const [system] = build();
    const rulesEnd = system.content.indexOf("Style instructions:");
    expect(rulesEnd).toBeGreaterThan(0);
    expect(system.content.slice(rulesEnd)).toContain("Keep it casual.");
  });

  it("omits the style block when instructions are blank", () => {
    expect(build({ instructions: "  " })[0].content).not.toContain("Style instructions:");
  });

  it("includes metadata, the source language, and the keyed lines in the user message", () => {
    const user = build()[1].content;
    expect(user).toContain("Title: Song Title");
    expect(user).toContain("Artists: Artist A, Artist B");
    expect(user).toContain("Album: Album X");
    expect(user).toContain("Source language: Japanese (ja)");
    expect(user).toContain(JSON.stringify({ "1": "line one", "1b": "bg one", "2": "line two" }, null, 2));
  });

  it("omits empty metadata and an auto source language", () => {
    const user = build({ context: { title: "", artists: [], album: "" }, sourceLanguage: "auto" })[1].content;
    expect(user).not.toContain("Title:");
    expect(user).not.toContain("Artists:");
    expect(user).not.toContain("Source language:");
  });

  it("adds a context-only block when contextItems are given", () => {
    const user = build({ items: [ITEMS[2]], contextItems: ITEMS })[1].content;
    expect(user).toContain("Full song for context only. Do not translate these:");
    expect(user).toContain(JSON.stringify({ "2": "line two" }, null, 2));
  });

  it("ships non-empty default instructions", () => {
    expect(DEFAULT_TRANSLATION_INSTRUCTIONS.trim().length).toBeGreaterThan(0);
  });
});

describe("parseTranslationResponse", () => {
  const KEYS = ["1", "1b", "2"];

  it("parses clean JSON", () => {
    const parsed = parseTranslationResponse('{"detectedLanguage":"ja","lines":{"1":"A","1b":"B","2":"C"}}', KEYS);
    expect(parsed.detectedLanguage).toBe("ja");
    expect(Object.fromEntries(parsed.translations)).toEqual({ "1": "A", "1b": "B", "2": "C" });
  });

  it("parses JSON inside a code fence", () => {
    const parsed = parseTranslationResponse('```json\n{"lines":{"1":"A"}}\n```', KEYS);
    expect(parsed.translations.get("1")).toBe("A");
  });

  it("parses JSON surrounded by prose, including braces inside strings", () => {
    const parsed = parseTranslationResponse('Sure! {"lines":{"1":"A {x}","2":"C"}} Hope that helps.', KEYS);
    expect(Object.fromEntries(parsed.translations)).toEqual({ "1": "A {x}", "2": "C" });
  });

  it("skips a brace in prose before the real JSON", () => {
    const parsed = parseTranslationResponse('Here is the {result}: {"lines":{"1":"A"}}', KEYS);
    expect(Object.fromEntries(parsed.translations)).toEqual({ "1": "A" });
  });

  it("skips an unclosed brace in prose before the real JSON", () => {
    const parsed = parseTranslationResponse('Use { carefully: {"lines":{"1":"A"}}', KEYS);
    expect(parsed.translations.get("1")).toBe("A");
  });

  it("ignores a JSON-looking draft inside a think block", () => {
    const parsed = parseTranslationResponse(
      '<think>Draft: {"lines":{"1":"draft"}} but let me recheck.</think>\n{"lines":{"1":"A"}}',
      KEYS,
    );
    expect(Object.fromEntries(parsed.translations)).toEqual({ "1": "A" });
  });

  it("drops reasoning that only has a closing tag", () => {
    const parsed = parseTranslationResponse('{"lines":{"1":"draft"}} more thinking</THINK>{"lines":{"1":"A"}}', KEYS);
    expect(parsed.translations.get("1")).toBe("A");
  });

  it("throws bad-response when the reply is only an unfinished think block", () => {
    expect(() => parseTranslationResponse('<think>{"lines":{"1":"draft"}}', KEYS)).toThrow(
      expect.objectContaining({ kind: "bad-response" }),
    );
  });

  it("prefers the object with a lines record over an earlier plain object", () => {
    const parsed = parseTranslationResponse('Note {"note":"x"} then {"lines":{"1":"A"}}', KEYS);
    expect(parsed.translations.get("1")).toBe("A");
  });

  it("falls back to the first object that parses when none has lines", () => {
    const parsed = parseTranslationResponse('Oops {nope} {"1":"A"} {"2":"C"}', KEYS);
    expect(Object.fromEntries(parsed.translations)).toEqual({ "1": "A" });
  });

  it("accepts a flat key map without the lines wrapper", () => {
    const parsed = parseTranslationResponse('{"1":"A","2":"C"}', KEYS);
    expect(Object.fromEntries(parsed.translations)).toEqual({ "1": "A", "2": "C" });
    expect(parsed.detectedLanguage).toBe("");
  });

  it("ignores unknown keys, empty strings, and non-string values", () => {
    const parsed = parseTranslationResponse('{"lines":{"1":"A","1b":"  ","2":3,"9":"Z"}}', KEYS);
    expect(Object.fromEntries(parsed.translations)).toEqual({ "1": "A" });
  });

  it("trims translations", () => {
    expect(parseTranslationResponse('{"lines":{"1":"  A  "}}', KEYS).translations.get("1")).toBe("A");
  });

  it("throws bad-response when no JSON object is present", () => {
    expect(() => parseTranslationResponse("I cannot help with that.", KEYS)).toThrow(
      expect.objectContaining({ kind: "bad-response" }),
    );
  });

  it("throws bad-response for truncated JSON", () => {
    expect(() => parseTranslationResponse('{"lines":{"1":"A"', KEYS)).toThrow(
      expect.objectContaining({ kind: "bad-response" }),
    );
  });
});
