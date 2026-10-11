import type { LlmProfile } from "@/services/llm/llm-profile";
import type { LlmRequestError } from "@/services/llm/openai-compatible-client";

function llmErrorMessage(error: LlmRequestError, profile: LlmProfile): string {
  const name = profile.label || "The model server";
  switch (error.kind) {
    case "network": {
      const base = `Couldn't reach ${name}. Is it running and does it allow this site's origin?`;
      return profile.preset === "ollama"
        ? `${base} Set OLLAMA_ORIGINS to include ${window.location.origin} and restart Ollama.`
        : base;
    }
    case "auth":
      return `${name} rejected the API key.`;
    case "not-found":
      return `Model "${profile.model}" not found on ${name}. Check the model and base URL.`;
    case "bad-response":
      return `${name} returned unreadable output. Try Regenerate or another model.`;
    case "http":
      return `${name} returned ${error.status ?? "an error"}.`;
  }
}

export { llmErrorMessage };
