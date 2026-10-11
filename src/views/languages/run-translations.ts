import type { TranslationProvider, TranslationRequest, TranslationResponse } from "@/services/language-provider";

// LLM servers (especially local ones) choke on parallel whole-song requests,
// so they run one target at a time; Google keeps its parallel fan-out.
async function runTranslations(
  provider: TranslationProvider,
  targets: string[],
  build: (target: string) => TranslationRequest,
  sequential: boolean,
): Promise<TranslationResponse[]> {
  if (!sequential) return Promise.all(targets.map((target) => provider.translate(build(target))));
  const results: TranslationResponse[] = [];
  for (const target of targets) results.push(await provider.translate(build(target)));
  return results;
}

export { runTranslations };
