import { googleLanguageProvider } from "@/services/google-language-provider";
import type { TranslationProvider } from "@/services/language-provider";
import type { LlmProfile } from "@/services/llm/llm-profile";
import { createLlmTranslationProvider } from "@/services/llm/llm-translation-provider";
import type { SettingsState } from "@/stores/settings";

function resolveTranslationProvider(settings: Pick<SettingsState, "llmProfiles" | "translationProvider">): {
  provider: TranslationProvider;
  profile?: LlmProfile;
} {
  const profile = settings.llmProfiles.find((candidate) => candidate.id === settings.translationProvider);
  if (!profile) return { provider: googleLanguageProvider };
  return { provider: createLlmTranslationProvider(profile), profile };
}

export { resolveTranslationProvider };
