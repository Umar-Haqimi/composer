import { googleLanguageProvider } from "@/services/google-language-provider";
import { createLlmProfile } from "@/services/llm/llm-profile";
import { resolveTranslationProvider } from "@/services/resolve-translation-provider";
import { describe, expect, it } from "vitest";

const PROFILE = { ...createLlmProfile("ollama", "p1"), model: "m" };

describe("resolveTranslationProvider", () => {
  it("returns Google for the google id", () => {
    expect(resolveTranslationProvider({ llmProfiles: [PROFILE], translationProvider: "google" })).toEqual({
      provider: googleLanguageProvider,
    });
  });

  it("returns an LLM provider and its profile for a profile id", () => {
    const resolved = resolveTranslationProvider({ llmProfiles: [PROFILE], translationProvider: "p1" });
    expect(resolved.provider.id).toBe("llm:p1");
    expect(resolved.profile).toBe(PROFILE);
  });

  it("falls back to Google for a stale profile id", () => {
    expect(resolveTranslationProvider({ llmProfiles: [], translationProvider: "gone" }).provider).toBe(
      googleLanguageProvider,
    );
  });
});
