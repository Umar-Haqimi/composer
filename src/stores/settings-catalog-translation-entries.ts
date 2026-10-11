import type { SettingEntry } from "@/stores/settings-catalog";

// Catalog entries for the Translation section. Kept in their own module so
// settings-catalog-entries.ts stays under the 300-line budget. Spread into
// SETTINGS_CATALOG right after the last sync entry.

const TRANSLATION_ENTRIES = {
  llmProfiles: {
    section: "translation",
    label: "LLM translation profiles",
    description:
      "Translate lyrics with a local Ollama model or any OpenAI-compatible API instead of Google Translate. Pick the profile in the Languages tab. API keys are stored only in this browser.",
    keywords: ["llm", "ollama", "openai", "ai", "model", "translate", "api key", "lm studio", "openrouter"],
  },
} as const satisfies Record<string, SettingEntry>;

export { TRANSLATION_ENTRIES };
