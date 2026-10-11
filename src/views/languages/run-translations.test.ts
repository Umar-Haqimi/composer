import type { TranslationProvider, TranslationRequest } from "@/services/language-provider";
import { runTranslations } from "@/views/languages/run-translations";
import { describe, expect, it } from "vitest";

function request(targetLanguage: string): TranslationRequest {
  return { main: [], background: [], targetLanguage, context: { title: "", artists: [], album: "" } };
}

function trackingProvider() {
  const events: string[] = [];
  const provider: TranslationProvider = {
    id: "fake",
    async translate({ targetLanguage }) {
      events.push(`start ${targetLanguage}`);
      await Promise.resolve();
      events.push(`end ${targetLanguage}`);
      return { detectedLanguage: "ja", main: [], background: [] };
    },
  };
  return { provider, events };
}

describe("runTranslations", () => {
  it("runs targets one after another when sequential", async () => {
    const { provider, events } = trackingProvider();
    await runTranslations(provider, ["en", "es"], request, true);
    expect(events).toEqual(["start en", "end en", "start es", "end es"]);
  });

  it("starts every target before any finishes when parallel", async () => {
    const { provider, events } = trackingProvider();
    await runTranslations(provider, ["en", "es"], request, false);
    expect(events.slice(0, 2)).toEqual(["start en", "start es"]);
  });

  it("returns responses in target order", async () => {
    const provider: TranslationProvider = {
      id: "fake",
      translate: async ({ targetLanguage }) => ({ detectedLanguage: targetLanguage, main: [], background: [] }),
    };
    const { results, error } = await runTranslations(provider, ["en", "es"], request, true);
    expect(results.map((result) => [result.target, result.response.detectedLanguage])).toEqual([
      ["en", "en"],
      ["es", "es"],
    ]);
    expect(error).toBeUndefined();
  });

  it("keeps earlier targets and stops at the first failure when sequential", async () => {
    const failure = new Error("boom");
    const seen: string[] = [];
    const provider: TranslationProvider = {
      id: "fake",
      async translate({ targetLanguage }) {
        seen.push(targetLanguage);
        if (targetLanguage === "es") throw failure;
        return { detectedLanguage: targetLanguage, main: [], background: [] };
      },
    };
    const { results, error } = await runTranslations(provider, ["en", "es", "fr"], request, true);
    expect(results.map((result) => result.target)).toEqual(["en"]);
    expect(error).toBe(failure);
    expect(seen).toEqual(["en", "es"]);
  });

  it("keeps fulfilled targets and reports the first error when parallel", async () => {
    const failure = new Error("boom");
    const provider: TranslationProvider = {
      id: "fake",
      async translate({ targetLanguage }) {
        if (targetLanguage === "es") throw failure;
        return { detectedLanguage: targetLanguage, main: [], background: [] };
      },
    };
    const { results, error } = await runTranslations(provider, ["en", "es", "fr"], request, false);
    expect(results.map((result) => result.target)).toEqual(["en", "fr"]);
    expect(error).toBe(failure);
  });

  it.each([true, false])("still throws an abort (sequential: %s)", async (sequential) => {
    const abort = new DOMException("aborted", "AbortError");
    const provider: TranslationProvider = {
      id: "fake",
      async translate({ targetLanguage }) {
        if (targetLanguage === "es") throw abort;
        return { detectedLanguage: targetLanguage, main: [], background: [] };
      },
    };
    await expect(runTranslations(provider, ["en", "es"], request, sequential)).rejects.toBe(abort);
  });
});
