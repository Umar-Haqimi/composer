import { GOOGLE_TRANSLATION_PROVIDER, useSettingsStore } from "@/stores/settings";
import { Select } from "@/ui/select";
import { SettingLink } from "@/ui/setting-link";
import { useMemo } from "react";

// -- Hooks --------------------------------------------------------------------

function useSelectedLlmProfile() {
  const profiles = useSettingsStore((state) => state.llmProfiles);
  const selected = useSettingsStore((state) => state.translationProvider);
  return profiles.find((profile) => profile.id === selected);
}

// -- Components ---------------------------------------------------------------

const TranslationProviderSelect: React.FC<{ disabled: boolean }> = ({ disabled }) => {
  const profiles = useSettingsStore((state) => state.llmProfiles);
  const selectTranslationProvider = useSettingsStore((state) => state.selectTranslationProvider);
  const selected = useSelectedLlmProfile();
  const options = useMemo(
    () => [
      { value: GOOGLE_TRANSLATION_PROVIDER, label: "Google Translate" },
      ...profiles.map((profile) => ({ value: profile.id, label: profile.label || profile.model || "Unnamed model" })),
    ],
    [profiles],
  );
  return (
    <>
      <span className="text-sm text-composer-text-muted">Translate with</span>
      <Select
        aria-label="Translation provider"
        value={selected?.id ?? GOOGLE_TRANSLATION_PROVIDER}
        disabled={disabled}
        onChange={selectTranslationProvider}
        options={options}
        className="h-8"
      />
    </>
  );
};

const MissingModelNotice: React.FC = () => {
  const profile = useSelectedLlmProfile();
  if (!profile || profile.model.trim()) return null;
  return (
    <p className="px-6 py-2 text-sm text-composer-text-secondary border-b border-composer-border">
      Choose a model for {profile.label || "this profile"} in <SettingLink setting="llmProfiles" /> to translate.
    </p>
  );
};

// -- Exports ------------------------------------------------------------------

export { MissingModelNotice, TranslationProviderSelect };
