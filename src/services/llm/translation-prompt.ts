import type { TranslationContext } from "@/services/language-provider";
import { type ChatMessage, LlmRequestError } from "@/services/llm/openai-compatible-client";

// -- Types --------------------------------------------------------------------

interface PromptItem {
  key: string;
  text: string;
}

interface TranslationPromptInput {
  items: PromptItem[];
  /** The whole song, sent read-only when items is only a chunk or a retry. */
  contextItems?: PromptItem[];
  targetLanguage: string;
  sourceLanguage?: string;
  context: TranslationContext;
  instructions: string;
}

// -- Constants ----------------------------------------------------------------

const DEFAULT_TRANSLATION_INSTRUCTIONS = [
  "Write natural, idiomatic lines that keep the meaning, tone and imagery of the song rather than a word-for-word translation.",
  "Leave proper names untranslated.",
  'Keep interjections and vocalisations such as "oh", "yeah" or "la la" as they are.',
].join("\n");

// -- Helpers ------------------------------------------------------------------

function languageLabel(tag: string): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(tag);
    return name && name !== tag ? `${name} (${tag})` : tag;
  } catch {
    return tag;
  }
}

function keyedObject(items: PromptItem[]): string {
  return JSON.stringify(Object.fromEntries(items.map((item) => [item.key, item.text])), null, 2);
}

function systemMessage(targetLanguage: string, instructions: string): string {
  const rules = [
    `You translate song lyrics into ${languageLabel(targetLanguage)}.`,
    "Rules:",
    "- Translate every key you are given. Keep a strict one-to-one key correspondence: never merge, split, reorder or skip lines.",
    "- Lines may mix several languages. Translate every part into the target language.",
    '- Keys ending in "b" are a background vocal sung alongside the main line with the same number. Translate them in that context.',
    "- Use the whole song to resolve meaning, but translate each line on its own key.",
    '- Respond with only this JSON object and nothing else: {"detectedLanguage": "<BCP 47 tag of the main source language>", "lines": {"<key>": "<translation>"}}',
  ].join("\n");
  const style = instructions.trim();
  return style ? `${rules}\n\nStyle instructions:\n${style}` : rules;
}

function userMessage(input: TranslationPromptInput): string {
  const { context, sourceLanguage, items, contextItems } = input;
  const header = [
    context.title && `Title: ${context.title}`,
    context.artists.length > 0 && `Artists: ${context.artists.join(", ")}`,
    context.album && `Album: ${context.album}`,
    sourceLanguage && sourceLanguage !== "auto" && `Source language: ${languageLabel(sourceLanguage)}`,
  ].filter(Boolean);
  const sections = [header.join("\n")];
  if (contextItems) sections.push(`Full song for context only. Do not translate these:\n${keyedObject(contextItems)}`);
  sections.push(`Translate these lines:\n${keyedObject(items)}`);
  return sections.filter(Boolean).join("\n\n");
}

const CLOSE_THINK = "</think>";

/** Reasoning models inline their thinking, often with draft JSON; only the text after it is the answer. */
function withoutReasoning(raw: string): string {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const close = text.toLowerCase().lastIndexOf(CLOSE_THINK);
  if (close !== -1) return text.slice(close + CLOSE_THINK.length);
  return text.trimStart().toLowerCase().startsWith("<think>") ? "" : text;
}

/** End index (exclusive) of the balanced `{...}` span starting at start, or -1 when it never closes. */
function balancedEnd(raw: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index++) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) return index + 1;
  }
  return -1;
}

/**
 * Returns the best JSON object in raw, skipping fences, prose and reasoning blocks: the first
 * one that has a `lines` record, otherwise the first one that parses.
 */
function extractJsonObject(raw: string): unknown {
  const text = withoutReasoning(raw);
  let first: unknown;
  let start = text.indexOf("{");
  while (start !== -1) {
    const end = balancedEnd(text, start);
    let parsed: unknown;
    try {
      if (end === -1) throw new SyntaxError("Unbalanced");
      parsed = JSON.parse(text.slice(start, end));
    } catch {
      start = text.indexOf("{", start + 1);
      continue;
    }
    if (isRecord(parsed) && isRecord(parsed.lines)) return parsed;
    first ??= parsed;
    start = text.indexOf("{", end);
  }
  return first;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// -- Prompt -------------------------------------------------------------------

function buildTranslationMessages(input: TranslationPromptInput): ChatMessage[] {
  return [
    { role: "system", content: systemMessage(input.targetLanguage, input.instructions) },
    { role: "user", content: userMessage(input) },
  ];
}

function parseTranslationResponse(
  raw: string,
  expectedKeys: readonly string[],
): { detectedLanguage: string; translations: Map<string, string> } {
  const parsed = extractJsonObject(raw);
  if (!isRecord(parsed)) throw new LlmRequestError("bad-response", "Response contained no JSON object");
  const lines = isRecord(parsed.lines) ? parsed.lines : parsed;
  const translations = new Map<string, string>();
  for (const key of expectedKeys) {
    const value = lines[key];
    if (typeof value === "string" && value.trim()) translations.set(key, value.trim());
  }
  return {
    detectedLanguage: typeof parsed.detectedLanguage === "string" ? parsed.detectedLanguage : "",
    translations,
  };
}

// -- Exports ------------------------------------------------------------------

export { buildTranslationMessages, DEFAULT_TRANSLATION_INSTRUCTIONS, parseTranslationResponse };
export type { PromptItem };
