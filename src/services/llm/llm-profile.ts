import { DEFAULT_TRANSLATION_INSTRUCTIONS } from "@/services/llm/translation-prompt";

// -- Types --------------------------------------------------------------------

type LlmPreset = "ollama" | "openai-compatible";

interface LlmProfile {
  id: string;
  label: string;
  preset: LlmPreset;
  baseUrl: string;
  apiKey: string;
  model: string;
  instructions: string;
  maxLinesPerRequest: number;
}

// -- Constants ----------------------------------------------------------------

const OLLAMA_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_MAX_LINES_PER_REQUEST = 80;

// -- Factory ------------------------------------------------------------------

function createLlmProfile(preset: LlmPreset, id: string = crypto.randomUUID()): LlmProfile {
  return {
    id,
    label: preset === "ollama" ? "Ollama" : "",
    preset,
    baseUrl: preset === "ollama" ? OLLAMA_BASE_URL : "",
    apiKey: "",
    model: "",
    instructions: DEFAULT_TRANSLATION_INSTRUCTIONS,
    maxLinesPerRequest: DEFAULT_MAX_LINES_PER_REQUEST,
  };
}

// -- Exports ------------------------------------------------------------------

export { createLlmProfile, DEFAULT_MAX_LINES_PER_REQUEST, OLLAMA_BASE_URL };
export type { LlmPreset, LlmProfile };
