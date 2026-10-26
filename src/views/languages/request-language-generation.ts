import type { LyricLine } from "@/domain/line/model";
import { googleLanguageProvider } from "@/services/google-language-provider";
import type { TranslationContext, TranslationProvider } from "@/services/language-provider";
import type { TranslationGeneration, TransliterationGeneration } from "@/views/languages/generated-language-updates";
import { languageGenerationInputs } from "@/views/languages/generation-inputs";
import { runTranslations, translationPairs } from "@/views/languages/run-translations";

// -- Interfaces ---------------------------------------------------------------

interface LanguageGenerationRequest {
  translations: readonly string[];
  transliteration: boolean;
  sourceLanguage: string;
  signal: AbortSignal;
  /** Defaults to Google. */
  provider?: TranslationProvider;
  /** Run one target at a time, for LLM servers that choke on parallel whole-song requests. */
  sequential?: boolean;
  context?: TranslationContext;
}

interface LanguageGenerationResult {
  transliteration?: TransliterationGeneration;
  translations: TranslationGeneration[];
  failedLineIds: ReadonlySet<string>;
  detectedLanguage?: string;
  /** The first request error. Targets that finished before it are still in `translations`. */
  translationError?: unknown;
}

// -- Constants ----------------------------------------------------------------

const EMPTY_CONTEXT: TranslationContext = { title: "", artists: [], album: "" };

// -- Functions ----------------------------------------------------------------

async function requestLanguageGeneration(
  lines: readonly LyricLine[],
  {
    translations,
    transliteration,
    sourceLanguage,
    signal,
    provider = googleLanguageProvider,
    sequential = false,
    context = EMPTY_CONTEXT,
  }: LanguageGenerationRequest,
): Promise<LanguageGenerationResult> {
  const { mainInputs, bgInputs } = languageGenerationInputs(lines);
  const [romanizationResults, translationRun] = await Promise.all([
    transliteration
      ? Promise.all([
          googleLanguageProvider.transliterate(mainInputs, sourceLanguage, signal),
          googleLanguageProvider.transliterate(bgInputs, sourceLanguage, signal),
        ])
      : Promise.resolve(null),
    runTranslations(
      provider,
      [...translations],
      (targetLanguage) => ({
        main: mainInputs,
        background: bgInputs,
        targetLanguage,
        sourceLanguage,
        context,
        lineOrder: lines.map((line) => line.id),
        signal,
      }),
      sequential,
    ),
  ]);
  const [romanMain, romanBg] = romanizationResults ?? [];
  const translationBatches = translationRun.results.flatMap(({ response }) => [response.main, response.background]);
  return {
    transliteration: romanMain
      ? {
          language: romanMain.language,
          backgroundLanguage: romanBg?.language,
          main: new Map(romanMain.lines.map((result) => [result.id, result])),
          background: new Map(romanBg?.lines.map((result) => [result.id, result]) ?? []),
        }
      : undefined,
    translations: translationPairs(translationRun.results),
    failedLineIds: new Set(
      [...(romanizationResults ?? []).map((batch) => batch.lines), ...translationBatches].flatMap((batch) =>
        batch.flatMap((result) => (result.failed ? [result.id] : [])),
      ),
    ),
    detectedLanguage: romanMain?.detectedLanguage || translationRun.results[0]?.response.detectedLanguage,
    translationError: translationRun.error,
  };
}

// -- Exports ------------------------------------------------------------------

export { requestLanguageGeneration };
export type { LanguageGenerationResult };
