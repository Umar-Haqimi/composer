import { DEFAULTS, GOOGLE_TRANSLATION_PROVIDER, migrateSettingsForTest, useSettingsStore } from "@/stores/settings";
import { describe, expect, it } from "vitest";

describe("LLM profile settings", () => {
  it("defaults to Google with no profiles", () => {
    expect(DEFAULTS.translationProvider).toBe(GOOGLE_TRANSLATION_PROVIDER);
    expect(DEFAULTS.llmProfiles).toEqual([]);
  });

  it("adds a profile from a preset with overrides and returns its id", () => {
    const id = useSettingsStore.getState().addLlmProfile("ollama", { model: "test-model" });
    const [profile] = useSettingsStore.getState().llmProfiles;
    expect(profile).toMatchObject({ id, preset: "ollama", model: "test-model", baseUrl: "http://localhost:11434/v1" });
  });

  it("updates a profile in place", () => {
    const id = useSettingsStore.getState().addLlmProfile("openai-compatible");
    useSettingsStore.getState().updateLlmProfile(id, { label: "Hosted", model: "m" });
    expect(useSettingsStore.getState().llmProfiles[0]).toMatchObject({ id, label: "Hosted", model: "m" });
  });

  it("falls back to Google when the selected profile is removed", () => {
    const id = useSettingsStore.getState().addLlmProfile("ollama");
    useSettingsStore.getState().selectTranslationProvider(id);
    useSettingsStore.getState().removeLlmProfile(id);
    expect(useSettingsStore.getState().translationProvider).toBe(GOOGLE_TRANSLATION_PROVIDER);
    expect(useSettingsStore.getState().llmProfiles).toEqual([]);
  });

  it("keeps the selection when a different profile is removed", () => {
    const keep = useSettingsStore.getState().addLlmProfile("ollama");
    const drop = useSettingsStore.getState().addLlmProfile("ollama");
    useSettingsStore.getState().selectTranslationProvider(keep);
    useSettingsStore.getState().removeLlmProfile(drop);
    expect(useSettingsStore.getState().translationProvider).toBe(keep);
  });

  it("keeps profiles and the selection across reset to defaults", () => {
    const id = useSettingsStore.getState().addLlmProfile("ollama");
    useSettingsStore.getState().selectTranslationProvider(id);
    useSettingsStore.getState().resetToDefaults();
    expect(useSettingsStore.getState().llmProfiles.map((profile) => profile.id)).toEqual([id]);
    expect(useSettingsStore.getState().translationProvider).toBe(id);
  });

  it("migration adds the defaults to an older blob", () => {
    const { llmProfiles: _p, translationProvider: _t, ...older } = DEFAULTS;
    const migrated = migrateSettingsForTest(older, 6) as typeof DEFAULTS;
    expect(migrated.llmProfiles).toEqual([]);
    expect(migrated.translationProvider).toBe("google");
  });

  it("migration keeps existing profiles", () => {
    const blob = { ...DEFAULTS, llmProfiles: [{ id: "x" }], translationProvider: "x" };
    const migrated = migrateSettingsForTest(blob, 7) as { translationProvider: string };
    expect(migrated.translationProvider).toBe("x");
  });
});
