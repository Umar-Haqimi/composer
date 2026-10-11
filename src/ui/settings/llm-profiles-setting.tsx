import { type LlmPreset, type LlmProfile, createLlmProfile } from "@/services/llm/llm-profile";
import { useSettingsStore } from "@/stores/settings";
import { Button } from "@/ui/button";
import { IconButton } from "@/ui/icon-button";
import { LlmProfileForm } from "@/ui/settings/llm-profile-form";
import { SettingText } from "@/ui/settings/setting-text";
import { displayHostFromUrl } from "@/utils/url";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { useState } from "react";

type Editing = { kind: "new"; draft: LlmProfile } | { kind: "edit"; id: string } | null;

const LlmProfilesSetting: React.FC = () => {
  const profiles = useSettingsStore((s) => s.llmProfiles);
  const addLlmProfile = useSettingsStore((s) => s.addLlmProfile);
  const updateLlmProfile = useSettingsStore((s) => s.updateLlmProfile);
  const removeLlmProfile = useSettingsStore((s) => s.removeLlmProfile);
  const [editing, setEditing] = useState<Editing>(null);

  const startNew = (preset: LlmPreset) => setEditing({ kind: "new", draft: createLlmProfile(preset) });

  return (
    <div className="py-3">
      <div className="mb-3">
        <SettingText id="llmProfiles" />
      </div>

      <div className="flex flex-col gap-1">
        {profiles.map((profile) =>
          editing?.kind === "edit" && editing.id === profile.id ? (
            <LlmProfileForm
              key={profile.id}
              initial={profile}
              submitLabel="Save profile"
              onSave={(next) => {
                const { id: _id, ...fields } = next;
                updateLlmProfile(profile.id, fields);
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div key={profile.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-composer-input min-w-0">
              <span className="text-sm font-medium text-composer-text truncate">{profile.label}</span>
              <span className="text-[11px] text-composer-text-muted font-mono truncate">{profile.model}</span>
              <span className="text-[11px] text-composer-text-muted font-mono truncate ml-auto">
                {displayHostFromUrl(profile.baseUrl)}
              </span>
              <IconButton
                label={`Edit ${profile.label}`}
                icon={<IconPencil size={14} />}
                variant="ghost"
                onClick={() => setEditing({ kind: "edit", id: profile.id })}
                className="size-6 rounded shrink-0"
              />
              <IconButton
                label={`Remove ${profile.label}`}
                icon={<IconTrash size={14} />}
                variant="ghost"
                onClick={() => removeLlmProfile(profile.id)}
                className="size-6 rounded text-composer-text-faint hover:text-composer-error hover:bg-transparent shrink-0"
              />
            </div>
          ),
        )}
      </div>

      {editing?.kind === "new" ? (
        <div className="mt-3">
          <LlmProfileForm
            initial={editing.draft}
            submitLabel="Save profile"
            onSave={(draft) => {
              const { id: _id, preset, ...fields } = draft;
              addLlmProfile(preset, fields);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      ) : (
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="secondary" onClick={() => startNew("ollama")} aria-label="Add Ollama profile">
            Add Ollama
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => startNew("openai-compatible")}
            aria-label="Add OpenAI-compatible profile"
          >
            Add OpenAI-compatible
          </Button>
        </div>
      )}
    </div>
  );
};

export { LlmProfilesSetting };
