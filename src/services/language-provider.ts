import type { TransliterationSegment } from "@/domain/language/model";

interface LanguageLineInput {
  id: string;
  text: string;
}

interface TranslationLineResult {
  id: string;
  text: string | null;
  /** A request failure, distinct from a successful result with no alternate text. */
  failed?: boolean;
}

interface TransliterationLineResult {
  id: string;
  text: string | null;
  segments: TransliterationSegment[];
  failed?: boolean;
}

interface TransliterationBatchResult {
  detectedLanguage: string;
  language: string;
  lines: TransliterationLineResult[];
}

interface TranslationContext {
  title: string;
  artists: string[];
  album: string;
}

/** One target language for the whole song, so context-aware providers see main and background lines together. */
interface TranslationRequest {
  main: LanguageLineInput[];
  background: LanguageLineInput[];
  targetLanguage: string;
  sourceLanguage?: string;
  context: TranslationContext;
  signal?: AbortSignal;
}

interface TranslationResponse {
  detectedLanguage: string;
  main: TranslationLineResult[];
  background: TranslationLineResult[];
}

interface TranslationProvider {
  id: string;
  translate(request: TranslationRequest): Promise<TranslationResponse>;
}

interface TransliterationProvider {
  id: string;
  transliterate(
    lines: LanguageLineInput[],
    sourceLanguage?: string,
    signal?: AbortSignal,
  ): Promise<TransliterationBatchResult>;
}

export type {
  LanguageLineInput,
  TranslationContext,
  TranslationLineResult,
  TranslationProvider,
  TranslationRequest,
  TranslationResponse,
  TransliterationBatchResult,
  TransliterationLineResult,
  TransliterationProvider,
};
