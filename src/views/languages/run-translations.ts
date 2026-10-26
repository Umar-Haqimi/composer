import type { ProjectMetadata } from "@/domain/project/metadata";
import type {
  TranslationContext,
  TranslationProvider,
  TranslationRequest,
  TranslationResponse,
} from "@/services/language-provider";
import { llmErrorMessage } from "@/services/llm/llm-error-message";
import type { LlmProfile } from "@/services/llm/llm-profile";
import { LlmRequestError } from "@/services/llm/openai-compatible-client";

// -- Types --------------------------------------------------------------------

interface TargetResponse {
  target: string;
  response: TranslationResponse;
}

/** Targets that completed, plus the first request error. A failure never discards finished targets. */
interface TranslationRun {
  results: TargetResponse[];
  error?: unknown;
}

// -- Running ------------------------------------------------------------------

function isAbort(error: unknown): boolean {
  return (error as Error)?.name === "AbortError";
}

// LLM servers (especially local ones) choke on parallel whole-song requests,
// so they run one target at a time; Google keeps its parallel fan-out.
async function runTranslations(
  provider: TranslationProvider,
  targets: string[],
  build: (target: string) => TranslationRequest,
  sequential: boolean,
): Promise<TranslationRun> {
  const results: TargetResponse[] = [];
  if (!sequential) {
    const settled = await Promise.allSettled(targets.map((target) => provider.translate(build(target))));
    let error: unknown;
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === "fulfilled") {
        results.push({ target: targets[index], response: outcome.value });
        continue;
      }
      if (isAbort(outcome.reason)) throw outcome.reason;
      error ??= outcome.reason;
    }
    return { results, error };
  }
  for (const target of targets) {
    try {
      results.push({ target, response: await provider.translate(build(target)) });
    } catch (error) {
      if (isAbort(error)) throw error;
      return { results, error };
    }
  }
  return { results };
}

// -- Helpers ------------------------------------------------------------------

function translationContext(metadata: Pick<ProjectMetadata, "title" | "artists" | "album">): TranslationContext {
  return { title: metadata.title, artists: metadata.artists, album: metadata.album };
}

function translationPairs(results: TargetResponse[]) {
  return results.map(({ target, response }) => ({
    language: target,
    main: new Map(response.main.map((result) => [result.id, result])),
    background: new Map(response.background.map((result) => [result.id, result])),
  }));
}

/** The one toast for a run: a request error wins over per-line failures. */
function generationFailureMessage(error: unknown, profile: LlmProfile | undefined, failedLines: boolean) {
  if (error instanceof LlmRequestError && profile) return llmErrorMessage(error, profile);
  return error !== undefined || failedLines ? "Couldn't generate some lines. Try Regenerate." : undefined;
}

export { generationFailureMessage, runTranslations, translationContext, translationPairs };
