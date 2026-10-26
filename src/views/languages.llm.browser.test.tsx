import { googleLanguageProvider } from "@/services/google-language-provider";
import { useProjectStore } from "@/stores/project";
import { useSettingsStore } from "@/stores/settings";
import { render } from "@/test/render";
import { LanguagesPanel } from "@/views/languages";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function mockGoogle() {
  vi.spyOn(googleLanguageProvider, "transliterate").mockImplementation(async (lines) => ({
    detectedLanguage: "ja",
    language: "ja-Latn",
    lines: lines.map((line) => ({ id: line.id, text: "romaji", segments: [] })),
  }));
  return vi.spyOn(googleLanguageProvider, "translate").mockImplementation(async (request) => ({
    detectedLanguage: "ja",
    main: request.main.map((line) => ({ id: line.id, text: "Google text" })),
    background: request.background.map((line) => ({ id: line.id, text: "Google bg" })),
  }));
}

beforeEach(() => {
  useProjectStore.getState().setMetadata({ language: "ja" });
  useProjectStore.getState().setLines([{ id: "line", text: "line one", backgroundText: "(bg one)", agentId: "v1" }]);
  useProjectStore.getState().setActiveTab("languages");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Opening the tab never generates, so each test asks for it.
async function renderAndGenerate(ui: React.ReactElement) {
  const screen = await render(ui);
  await screen.getByRole("button", { name: /^(Generate|Regenerate) all$/ }).click();
  return screen;
}

describe("Languages translation provider", () => {
  it("sends one Google request per target with main and background together", async () => {
    const translate = mockGoogle();
    const screen = await renderAndGenerate(<LanguagesPanel />);
    await expect.element(screen.getByRole("textbox", { name: "English", exact: true })).toHaveValue("Google text");
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate.mock.calls[0][0]).toMatchObject({
      targetLanguage: "en",
      main: [{ id: "line" }],
      background: [{ id: "line" }],
    });
  });

  it("lists profiles in the picker and stores the choice", async () => {
    mockGoogle();
    const id = useSettingsStore.getState().addLlmProfile("ollama", { label: "Local model", model: "m" });
    const screen = await render(<LanguagesPanel />);
    await screen.getByRole("button", { name: "Translation provider" }).click();
    await screen.getByRole("option", { name: "Local model" }).click();
    expect(useSettingsStore.getState().translationProvider).toBe(id);
  });

  it("translates through the selected LLM profile", async () => {
    mockGoogle();
    const id = useSettingsStore.getState().addLlmProfile("ollama", { label: "Local model", model: "m" });
    useSettingsStore.getState().selectTranslationProvider(id);
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ detectedLanguage: "ja", lines: { "1": "LLM text", "1b": "LLM bg" } }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const screen = await renderAndGenerate(<LanguagesPanel />);
    await expect.element(screen.getByRole("textbox", { name: "English", exact: true })).toHaveValue("LLM text");
    expect(googleLanguageProvider.translate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("skips translation and shows a notice when the selected profile has no model", async () => {
    const translate = mockGoogle();
    const id = useSettingsStore.getState().addLlmProfile("ollama", { label: "Local model" });
    useSettingsStore.getState().selectTranslationProvider(id);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const screen = await renderAndGenerate(<LanguagesPanel />);
    await expect.element(screen.getByText(/Choose a model for Local model/)).toBeInTheDocument();
    await expect.element(screen.getByRole("textbox", { name: "Transliteration", exact: true })).toHaveValue("romaji");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
  });

  it("keeps the transliteration and shows a toast when the LLM request fails", async () => {
    mockGoogle();
    const id = useSettingsStore.getState().addLlmProfile("ollama", { label: "Local model", model: "m" });
    useSettingsStore.getState().selectTranslationProvider(id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const screen = await renderAndGenerate(
      <>
        <Toaster />
        <LanguagesPanel />
      </>,
    );
    await expect.element(screen.getByRole("textbox", { name: "Transliteration", exact: true })).toHaveValue("romaji");
    await expect.poll(() => document.body.textContent).toMatch(/Couldn't reach Local model/);
    expect(document.body.textContent).not.toMatch(/Couldn't generate some lines/);
  });

  it("numbers a background-only line in project order in the LLM request", async () => {
    mockGoogle();
    useProjectStore.getState().setLines([
      { id: "a", text: "line one", agentId: "v1" },
      { id: "b", text: "", backgroundText: "(bg one)", agentId: "v1" },
      { id: "c", text: "line two", agentId: "v1" },
    ]);
    const id = useSettingsStore.getState().addLlmProfile("ollama", { label: "Local model", model: "m" });
    useSettingsStore.getState().selectTranslationProvider(id);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        choices: [{ message: { content: JSON.stringify({ lines: { "1": "L1", "2b": "B2", "3": "L3" } }) } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderAndGenerate(<LanguagesPanel />);
    await expect.poll(() => fetchMock.mock.calls.length).toBeGreaterThan(0);
    const prompt = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).messages[1].content;
    expect(prompt).toContain(JSON.stringify({ "1": "line one", "3": "line two", "2b": "(bg one)" }, null, 2));
  });
});
