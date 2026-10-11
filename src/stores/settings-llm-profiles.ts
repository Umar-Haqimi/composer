import { type LlmPreset, type LlmProfile, createLlmProfile } from "@/services/llm/llm-profile";

// LLM profile state and actions for the settings store. Kept in their own
// module so settings.ts stays under the 300-line budget.

// -- Types --------------------------------------------------------------------

const GOOGLE_TRANSLATION_PROVIDER = "google";

interface LlmProfilesState {
  llmProfiles: LlmProfile[];
  /** "google" or the id of an entry in llmProfiles. */
  translationProvider: string;
}

interface LlmProfilesActions {
  addLlmProfile: (preset: LlmPreset, fields?: Partial<Omit<LlmProfile, "id" | "preset">>) => string;
  updateLlmProfile: (id: string, updates: Partial<Omit<LlmProfile, "id">>) => void;
  removeLlmProfile: (id: string) => void;
  selectTranslationProvider: (id: string) => void;
}

type SetLlmProfiles = (
  partial: Partial<LlmProfilesState> | ((state: LlmProfilesState) => Partial<LlmProfilesState>),
) => void;

// -- Defaults -----------------------------------------------------------------

const LLM_PROFILES_DEFAULTS: LlmProfilesState = {
  llmProfiles: [],
  translationProvider: GOOGLE_TRANSLATION_PROVIDER,
};

// -- Actions ------------------------------------------------------------------

function llmProfilesActions(set: SetLlmProfiles): LlmProfilesActions {
  return {
    addLlmProfile: (preset, fields = {}) => {
      const profile = { ...createLlmProfile(preset), ...fields };
      set((state) => ({ llmProfiles: [...state.llmProfiles, profile] }));
      return profile.id;
    },
    updateLlmProfile: (id, updates) =>
      set((state) => ({
        llmProfiles: state.llmProfiles.map((profile) => (profile.id === id ? { ...profile, ...updates, id } : profile)),
      })),
    removeLlmProfile: (id) =>
      set((state) => ({
        llmProfiles: state.llmProfiles.filter((profile) => profile.id !== id),
        translationProvider: state.translationProvider === id ? GOOGLE_TRANSLATION_PROVIDER : state.translationProvider,
      })),
    selectTranslationProvider: (id) => set({ translationProvider: id }),
  };
}

function migrateLlmProfiles(state: Partial<LlmProfilesState>): void {
  if (!Array.isArray(state.llmProfiles)) state.llmProfiles = [];
  if (typeof state.translationProvider !== "string") state.translationProvider = GOOGLE_TRANSLATION_PROVIDER;
}

// -- Exports ------------------------------------------------------------------

export { GOOGLE_TRANSLATION_PROVIDER, LLM_PROFILES_DEFAULTS, llmProfilesActions, migrateLlmProfiles };
export type { LlmProfilesActions, LlmProfilesState };
