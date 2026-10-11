import { llmErrorMessage } from "@/services/llm/llm-error-message";
import type { LlmProfile } from "@/services/llm/llm-profile";
import { LlmRequestError, listModels } from "@/services/llm/openai-compatible-client";
import { DEFAULT_TRANSLATION_INSTRUCTIONS } from "@/services/llm/translation-prompt";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { pluralize } from "@/utils/pluralize";
import { ensureHttpScheme, isValidHttpUrl } from "@/utils/url";
import { useState } from "react";

// -- Styles -------------------------------------------------------------------

const INPUT =
  "h-7 px-2 text-xs rounded-md bg-composer-input border border-composer-border focus:outline-none focus:border-composer-accent text-composer-text placeholder:text-composer-text-muted";

type ConnectionState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; models: string[] }
  | { status: "error"; message: string };

// -- Component ----------------------------------------------------------------

const LlmProfileForm: React.FC<{
  initial: LlmProfile;
  submitLabel: string;
  onSave: (profile: LlmProfile) => void;
  onCancel: () => void;
}> = ({ initial, submitLabel, onSave, onCancel }) => {
  const [draft, setDraft] = useState(initial);
  const [connection, setConnection] = useState<ConnectionState>({ status: "idle" });
  const update = (fields: Partial<LlmProfile>) => setDraft((current) => ({ ...current, ...fields }));

  const urlValid = isValidHttpUrl(draft.baseUrl.trim());
  const canSave = urlValid && draft.label.trim().length > 0 && draft.model.trim().length > 0;

  const testConnection = async () => {
    setConnection({ status: "testing" });
    try {
      const models = await listModels({ baseUrl: ensureHttpScheme(draft.baseUrl), apiKey: draft.apiKey });
      setConnection({ status: "ok", models });
    } catch (error) {
      const message = error instanceof LlmRequestError ? llmErrorMessage(error, draft) : "Connection test failed.";
      setConnection({ status: "error", message });
    }
  };

  const save = () => {
    if (!canSave) return;
    onSave({
      ...draft,
      label: draft.label.trim(),
      baseUrl: ensureHttpScheme(draft.baseUrl),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      maxLinesPerRequest: Math.max(1, Math.round(draft.maxLinesPerRequest) || 1),
    });
  };

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-composer-accent/50 bg-composer-accent/10">
      <div className="grid grid-cols-[7rem_1fr] items-center gap-2 text-xs text-composer-text-secondary">
        <label htmlFor={`${draft.id}-label`}>Name</label>
        <input
          id={`${draft.id}-label`}
          className={INPUT}
          value={draft.label}
          onChange={(e) => update({ label: e.target.value })}
        />
        <label htmlFor={`${draft.id}-url`}>Base URL</label>
        <input
          id={`${draft.id}-url`}
          type="url"
          inputMode="url"
          placeholder="https://api.example.com/v1"
          className={cn(INPUT, "font-mono", draft.baseUrl && !urlValid && "border-composer-error")}
          value={draft.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value.replace(/\s+/g, "") })}
        />
        <label htmlFor={`${draft.id}-key`}>API key</label>
        <input
          id={`${draft.id}-key`}
          type="password"
          autoComplete="off"
          placeholder={draft.preset === "ollama" ? "Not needed for Ollama" : "sk-..."}
          className={cn(INPUT, "font-mono")}
          value={draft.apiKey}
          onChange={(e) => update({ apiKey: e.target.value })}
        />
        <label htmlFor={`${draft.id}-model`}>Model</label>
        <input
          id={`${draft.id}-model`}
          className={cn(INPUT, "font-mono")}
          value={draft.model}
          onChange={(e) => update({ model: e.target.value })}
        />
        <label htmlFor={`${draft.id}-chunk`}>Lines per request</label>
        <input
          id={`${draft.id}-chunk`}
          type="number"
          min={1}
          className={cn(INPUT, "w-24")}
          value={draft.maxLinesPerRequest}
          onChange={(e) => update({ maxLinesPerRequest: Number(e.target.value) })}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void testConnection()}
          disabled={!urlValid || connection.status === "testing"}
        >
          Test connection
        </Button>
        {connection.status === "ok" && (
          <span className="text-[11px] text-composer-text-muted">
            Connected. {pluralize(connection.models.length, "model")} found.
          </span>
        )}
        {connection.status === "error" && (
          <span className="text-[11px] text-composer-error-text">{connection.message}</span>
        )}
      </div>
      {connection.status === "ok" && connection.models.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {connection.models.map((model) => (
            <Button
              key={model}
              size="sm"
              variant={model === draft.model ? "primary" : "secondary"}
              onClick={() => update({ model })}
            >
              {model}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label htmlFor={`${draft.id}-instructions`} className="text-xs text-composer-text-secondary">
            Instructions
          </label>
          <Button size="sm" variant="ghost" onClick={() => update({ instructions: DEFAULT_TRANSLATION_INSTRUCTIONS })}>
            Reset to default
          </Button>
        </div>
        <textarea
          id={`${draft.id}-instructions`}
          rows={4}
          className="px-2 py-1.5 text-xs rounded-md bg-composer-input border border-composer-border focus:outline-none focus:border-composer-accent text-composer-text"
          value={draft.instructions}
          onChange={(e) => update({ instructions: e.target.value })}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={save} disabled={!canSave}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
};

export { LlmProfileForm };
