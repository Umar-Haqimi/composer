import { useSettingsStore } from "@/stores/settings";
import { allowConsole } from "@/test/console-guard";
import { render } from "@/test/render";
import { LlmProfilesSetting } from "@/ui/settings/llm-profiles-setting";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  allowConsole(/cannot be a descendant of/);
  allowConsole(/cannot contain a nested/);
});

afterEach(() => vi.unstubAllGlobals());

describe("LlmProfilesSetting", () => {
  it("adds an Ollama profile from the preset", async () => {
    const screen = await render(<LlmProfilesSetting />);
    await screen.getByRole("button", { name: "Add Ollama profile" }).click();
    await expect.element(screen.getByLabelText("Base URL")).toHaveValue("http://localhost:11434/v1");
    await screen.getByLabelText("Model").fill("test-model");
    await screen.getByRole("button", { name: "Save profile" }).click();
    await expect
      .poll(() => useSettingsStore.getState().llmProfiles[0])
      .toMatchObject({ preset: "ollama", model: "test-model", label: "Ollama" });
  });

  it("fills the model list from Test connection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ id: "alpha" }, { id: "beta" }] })),
    );
    const screen = await render(<LlmProfilesSetting />);
    await screen.getByRole("button", { name: "Add Ollama profile" }).click();
    await screen.getByRole("button", { name: "Test connection" }).click();
    await expect.element(screen.getByText("Connected. 2 models found.")).toBeInTheDocument();
    await screen.getByRole("button", { name: "beta" }).click();
    await expect.element(screen.getByLabelText("Model")).toHaveValue("beta");
  });

  it("shows the Ollama origin hint when the server is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const screen = await render(<LlmProfilesSetting />);
    await screen.getByRole("button", { name: "Add Ollama profile" }).click();
    await screen.getByRole("button", { name: "Test connection" }).click();
    await expect.element(screen.getByText(/OLLAMA_ORIGINS/)).toBeInTheDocument();
  });

  it("removes a profile and falls back to Google", async () => {
    const id = useSettingsStore.getState().addLlmProfile("ollama", { label: "Local", model: "m" });
    useSettingsStore.getState().selectTranslationProvider(id);
    const screen = await render(<LlmProfilesSetting />);
    await screen.getByRole("button", { name: "Remove Local" }).click();
    expect(useSettingsStore.getState().llmProfiles).toEqual([]);
    expect(useSettingsStore.getState().translationProvider).toBe("google");
  });

  it("resets instructions to the default", async () => {
    const screen = await render(<LlmProfilesSetting />);
    await screen.getByRole("button", { name: "Add Ollama profile" }).click();
    const instructions = screen.getByLabelText("Instructions");
    await instructions.fill("custom");
    await screen.getByRole("button", { name: "Reset to default" }).click();
    await expect.element(instructions).not.toHaveValue("custom");
  });
});
