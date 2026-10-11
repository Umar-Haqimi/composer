import { llmErrorMessage } from "@/services/llm/llm-error-message";
import { createLlmProfile } from "@/services/llm/llm-profile";
import { LlmRequestError } from "@/services/llm/openai-compatible-client";
import { describe, expect, it } from "vitest";

const OLLAMA = { ...createLlmProfile("ollama", "o"), label: "Local", model: "m1" };
const HOSTED = { ...createLlmProfile("openai-compatible", "h"), label: "Hosted", model: "m2" };

describe("llmErrorMessage", () => {
  it("mentions OLLAMA_ORIGINS for unreachable Ollama profiles", () => {
    const message = llmErrorMessage(new LlmRequestError("network", "x"), OLLAMA);
    expect(message).toContain("Couldn't reach Local");
    expect(message).toContain("OLLAMA_ORIGINS");
  });

  it("omits the Ollama hint for other presets", () => {
    expect(llmErrorMessage(new LlmRequestError("network", "x"), HOSTED)).not.toContain("OLLAMA_ORIGINS");
  });

  it.each([
    ["auth", 401, "Hosted rejected the API key."],
    ["not-found", 404, 'Model "m2" not found on Hosted. Check the model and base URL.'],
    ["bad-response", undefined, "Hosted returned unreadable output. Try Regenerate or another model."],
    ["http", 502, "Hosted returned 502."],
  ] as const)("describes %s", (kind, status, expected) => {
    expect(llmErrorMessage(new LlmRequestError(kind, "x", status), HOSTED)).toBe(expected);
  });
});
