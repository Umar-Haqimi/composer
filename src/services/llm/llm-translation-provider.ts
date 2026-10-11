import type {
  LanguageLineInput,
  TranslationLineResult,
  TranslationProvider,
  TranslationRequest,
  TranslationResponse,
} from "@/services/language-provider";
import type { LlmProfile } from "@/services/llm/llm-profile";
import { LlmRequestError, chatJson } from "@/services/llm/openai-compatible-client";
import { type PromptItem, buildTranslationMessages, parseTranslationResponse } from "@/services/llm/translation-prompt";

// -- Types --------------------------------------------------------------------

interface KeyedItem extends PromptItem {
  id: string;
  slot: "main" | "background";
}

// -- Keys & chunks ------------------------------------------------------------

/**
 * One group per line id, numbered by project position (`lineOrder`), then by first appearance for
 * ids it doesn't list; background keys get a "b" suffix.
 */
function keyedGroups(
  main: LanguageLineInput[],
  background: LanguageLineInput[],
  lineOrder: string[] = [],
): KeyedItem[][] {
  const present = new Set([...main, ...background].map((line) => line.id));
  const ordered = [...new Set([...lineOrder.filter((id) => present.has(id)), ...present])];
  const groups = new Map<string, KeyedItem[]>(ordered.map((id) => [id, []]));
  const groupFor = (id: string) => groups.get(id) as KeyedItem[];
  const numbers = new Map(ordered.map((id, index) => [id, index + 1]));
  for (const line of main) {
    groupFor(line.id).push({ id: line.id, slot: "main", key: `${numbers.get(line.id)}`, text: line.text });
  }
  for (const line of background) {
    groupFor(line.id).push({ id: line.id, slot: "background", key: `${numbers.get(line.id)}b`, text: line.text });
  }
  return [...groups.values()].filter((group) => group.length > 0);
}

function packChunks(groups: KeyedItem[][], maxItems: number): KeyedItem[][] {
  const chunks: KeyedItem[][] = [];
  let current: KeyedItem[] = [];
  for (const group of groups) {
    if (current.length > 0 && current.length + group.length > maxItems) {
      chunks.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Blank source lines have nothing to translate, so they are never sent to the model. */
function isBlank(text: string): boolean {
  return text.trim() === "";
}

function isAbort(error: unknown): boolean {
  return (error as Error)?.name === "AbortError";
}

function sameAsSource(translation: string, source: string): boolean {
  return translation.localeCompare(source, undefined, { sensitivity: "accent" }) === 0;
}

// -- Provider -----------------------------------------------------------------

function createLlmTranslationProvider(profile: LlmProfile): TranslationProvider {
  async function requestItems(items: KeyedItem[], contextItems: KeyedItem[] | undefined, request: TranslationRequest) {
    const messages = buildTranslationMessages({
      items,
      contextItems,
      targetLanguage: request.targetLanguage,
      sourceLanguage: request.sourceLanguage,
      context: request.context,
      instructions: profile.instructions,
    });
    const raw = await chatJson({ ...profile, messages, signal: request.signal });
    return parseTranslationResponse(
      raw,
      items.map((item) => item.key),
    );
  }

  return {
    id: `llm:${profile.id}`,
    async translate(request): Promise<TranslationResponse> {
      const everyGroup = keyedGroups(request.main, request.background, request.lineOrder);
      const groups = everyGroup
        .map((group) => group.filter((item) => !isBlank(item.text)))
        .filter((group) => group.length > 0);
      const allItems = groups.flat();
      const chunks = packChunks(groups, Math.max(1, profile.maxLinesPerRequest));
      const translations = new Map<string, string>();
      let detectedLanguage = "";
      let gaps: KeyedItem[] = [];
      let lastError: unknown;

      const collect = (items: KeyedItem[], parsed: Awaited<ReturnType<typeof requestItems>>) => {
        if (!detectedLanguage && parsed.detectedLanguage) detectedLanguage = parsed.detectedLanguage;
        for (const [key, text] of parsed.translations) translations.set(key, text);
        gaps.push(...items.filter((item) => !parsed.translations.has(item.key)));
      };

      for (const [index, chunk] of chunks.entries()) {
        try {
          collect(chunk, await requestItems(chunk, chunks.length > 1 ? allItems : undefined, request));
        } catch (error) {
          if (isAbort(error)) throw error;
          const unreadable = error instanceof LlmRequestError && error.kind === "bad-response";
          if (index === 0 && !unreadable) throw error;
          lastError = error;
          gaps.push(...chunk);
        }
      }

      if (gaps.length > 0) {
        const retryItems = gaps;
        gaps = [];
        try {
          collect(retryItems, await requestItems(retryItems, allItems, request));
        } catch (error) {
          if (isAbort(error)) throw error;
          lastError = error;
        }
      }

      if (
        allItems.length > 0 &&
        translations.size === 0 &&
        lastError instanceof LlmRequestError &&
        lastError.kind === "bad-response"
      ) {
        throw lastError;
      }

      const resultFor = (item: KeyedItem): TranslationLineResult => {
        if (isBlank(item.text)) return { id: item.id, text: null };
        const text = translations.get(item.key);
        if (text === undefined) return { id: item.id, text: null, failed: true };
        return { id: item.id, text: sameAsSource(text, item.text) ? null : text };
      };
      const everyItem = everyGroup.flat();
      return {
        detectedLanguage,
        main: everyItem.filter((item) => item.slot === "main").map(resultFor),
        background: everyItem.filter((item) => item.slot === "background").map(resultFor),
      };
    },
  };
}

// -- Exports ------------------------------------------------------------------

export { createLlmTranslationProvider };
