# LLM Lyrics Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate lyrics with a saved Ollama / OpenAI-compatible LLM profile (whole-song context, validated per-line output, gap retry), keeping Google Translate as the default option.

**Architecture:** Split `LanguageProvider` into `TranslationProvider` and `TransliterationProvider`. Translation takes one request object per target (main + background lines + song metadata). A new `src/services/llm/` module has a fetch-based OpenAI-compatible client, a pure prompt builder/parser, and a provider that chunks, validates and retries. Profiles live in the persisted settings store (Cobalt-instance pattern). A new "Translation" settings section edits them, and a picker in the Languages tab selects the provider. Transliteration stays on Google.

**Tech Stack:** React 19, TypeScript, zustand (`persist`), Vitest (unit project `*.test.ts`, browser project `*.browser.test.tsx` via `vitest/browser`), Biome, sonner toasts, @tabler/icons-react.

**Spec:** `docs/superpowers/specs/2026-10-11-llm-lyrics-translation-design.md`

## Global Constraints

- Transliteration is unchanged and always uses `googleLanguageProvider.transliterate`.
- Default `translationProvider` is `"google"`; existing users see no behaviour change.
- Ollama preset base URL: `http://localhost:11434/v1`, empty API key.
- `maxLinesPerRequest` default: `80`.
- Chat request: `POST {baseUrl}/chat/completions`, `response_format: { type: "json_object" }`, `temperature: 0.3`; `Authorization: Bearer <key>` only when the key is non-empty.
- Model list: `GET {baseUrl}/models`, reading `data[].id`.
- LLM response contract: `{"detectedLanguage": "<BCP 47>", "lines": {"<key>": "<translation>"}}`. Keys: main line n → `"n"`, its background → `"nb"` (1-based).
- No LLM result caching. No automatic fallback to Google on LLM failure.
- With an LLM provider, target languages and chunks run sequentially. Google targets stay parallel.
- Test fixtures use placeholder text (`"line one"`, `"line two"`, `"bg one"`), never real lyrics.
- Settings catalog copy: labels/descriptions trimmed, descriptions end in a period, no en/em dashes or curly quotes.
- Product copy must never say "in Settings", "Settings →", "from Settings" or "Settings, under". Point at settings with `<SettingLink setting=... />` (enforced by `src/test/no-raw-settings-references.test.ts`).
- No non-test file over 300 lines (`src/test/file-size-budget.test.ts`). `settings.ts` (281), `settings-catalog-entries.ts` (290) and `languages.tsx` (269) are already close, so new logic goes into new files as laid out below.
- Generated translations keep `origin: "google"`. In the domain model that value means "generated, safe to replace". Renaming it is out of scope.
- No settings export/import path exists (settings persist only to `localStorage` under `composer-settings`), so there is no export to strip `apiKey` from. `resetToDefaults` must keep `llmProfiles` and `translationProvider`, as it keeps the Cobalt instances.
- Commands: unit `pnpm test:unit`, browser `pnpm test:component`, single file `pnpm vitest run --project unit <path>` / `pnpm vitest run --project browser <path>`, types `pnpm typecheck`, lint `pnpm lint:fix`, unused exports `pnpm knip`. After code changes run `graphify update .`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Model wraps JSON in prose or code fences** (common with small local models and servers that ignore `response_format`). Expected: still parsed. Pinned in Task 3 (`parseTranslationResponse` fenced/prose tests).
2. **Model returns a flat `{key: text}` object without the `lines` wrapper.** Expected: accepted as lines. Pinned in Task 3.
3. **Base URL typed with a trailing slash, or without `/v1`.** Expected: a trailing slash is normalised. A missing `/v1` gives a 404 that maps to the "Model not found / check base URL" message rather than a crash. Pinned in Task 2 (URL join) and Task 6 (error message).
4. **Selected profile deleted while it is the active provider, or a stale id in storage.** Expected: falls back to Google in both the store and the resolver. Pinned in Task 5 (`removeLlmProfile`) and Task 7 (`resolveTranslationProvider` stale id).
5. **Line that has only a background vocal (empty main text).** Expected: still translated, and its `b` key still maps back to the right line id. Pinned in Task 4.

---

## File Structure

New:
- `src/services/llm/openai-compatible-client.ts`: HTTP to OpenAI-compatible servers; `LlmRequestError`.
- `src/services/llm/translation-prompt.ts`: pure prompt building and response parsing; default instructions.
- `src/services/llm/llm-profile.ts`: `LlmProfile` type, preset constants, `createLlmProfile`.
- `src/services/llm/llm-translation-provider.ts`: `createLlmTranslationProvider(profile)`: keys, chunking, retry, mapping.
- `src/services/llm/llm-error-message.ts`: user-facing message for an `LlmRequestError`.
- `src/services/resolve-translation-provider.ts`: picks Google or an LLM provider from settings.
- `src/stores/settings-llm-profiles.ts`: profile actions creator for the settings store.
- `src/stores/settings-catalog-translation-entries.ts`: catalog entry for the Translation section.
- `src/views/languages/translation-provider-select.tsx`: "Translate with" picker plus missing-model notice.
- `src/views/languages/run-translations.ts`: runs `translate()` over targets (sequential or parallel).
- `src/ui/settings/llm-profiles-setting.tsx`: profile list in the Translation settings section.
- `src/ui/settings/llm-profile-form.tsx`: add/edit form with Test connection.
- Tests next to each.

Modified:
- `src/services/language-provider.ts`, `src/services/google-language-provider.ts` (+ test)
- `src/views/languages.tsx`, `src/views/languages.lifecycle.browser.test.tsx`
- `src/stores/settings.ts` (+ migration test)
- `src/stores/settings-catalog.ts`, `src/stores/settings-catalog-entries.ts`
- `src/ui/settings/settings-section-icons.ts`, `src/ui/settings/setting-controls-registry.tsx`

---

### Task 1: Split the provider interface and move the view to one translate call per target

**Files:**
- Modify: `src/services/language-provider.ts`
- Modify: `src/services/google-language-provider.ts`
- Modify: `src/services/google-language-provider.test.ts`
- Create: `src/views/languages/run-translations.ts`
- Create: `src/views/languages/run-translations.test.ts`
- Modify: `src/views/languages.tsx:59-118`
- Modify: `src/views/languages.lifecycle.browser.test.tsx:62-70`

**Interfaces:**
- Produces:
  ```ts
  interface TranslationContext { title: string; artists: string[]; album: string }
  interface TranslationRequest {
    main: LanguageLineInput[]; background: LanguageLineInput[];
    targetLanguage: string; sourceLanguage?: string;
    context: TranslationContext; signal?: AbortSignal;
  }
  interface TranslationResponse { detectedLanguage: string; main: TranslationLineResult[]; background: TranslationLineResult[] }
  interface TranslationProvider { id: string; translate(request: TranslationRequest): Promise<TranslationResponse> }
  interface TransliterationProvider { id: string; transliterate(lines: LanguageLineInput[], sourceLanguage?: string, signal?: AbortSignal): Promise<TransliterationBatchResult> }
  // run-translations.ts
  function runTranslations(provider: TranslationProvider, targets: string[], build: (target: string) => TranslationRequest, sequential: boolean): Promise<TranslationResponse[]>
  ```
- `LanguageProvider` and `TranslationBatchResult` are removed (knip flags unused exports).

- [ ] **Step 1: Write the failing test for `runTranslations`**

`src/views/languages/run-translations.test.ts`:
```ts
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
    const results = await runTranslations(provider, ["en", "es"], request, true);
    expect(results.map((result) => result.detectedLanguage)).toEqual(["en", "es"]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run --project unit src/views/languages/run-translations.test.ts`
Expected: FAIL. The module `run-translations` and the types do not exist.

- [ ] **Step 3: Replace the interface in `src/services/language-provider.ts`**

Replace the whole file with:
```ts
import type { TransliterationSegment } from "@/domain/language/model";

interface LanguageLineInput {
  id: string;
  text: string;
}

interface TranslationLineResult {
  id: string;
  text: string | null;
  /** A request failure, distinct from a successful result with no alternate text. */
  failed?: boolean;
}

interface TransliterationLineResult {
  id: string;
  text: string | null;
  segments: TransliterationSegment[];
  failed?: boolean;
}

interface TransliterationBatchResult {
  detectedLanguage: string;
  language: string;
  lines: TransliterationLineResult[];
}

interface TranslationContext {
  title: string;
  artists: string[];
  album: string;
}

/** One target language for the whole song, so context-aware providers see main and background lines together. */
interface TranslationRequest {
  main: LanguageLineInput[];
  background: LanguageLineInput[];
  targetLanguage: string;
  sourceLanguage?: string;
  context: TranslationContext;
  signal?: AbortSignal;
}

interface TranslationResponse {
  detectedLanguage: string;
  main: TranslationLineResult[];
  background: TranslationLineResult[];
}

interface TranslationProvider {
  id: string;
  translate(request: TranslationRequest): Promise<TranslationResponse>;
}

interface TransliterationProvider {
  id: string;
  transliterate(
    lines: LanguageLineInput[],
    sourceLanguage?: string,
    signal?: AbortSignal,
  ): Promise<TransliterationBatchResult>;
}

export type {
  LanguageLineInput,
  TranslationContext,
  TranslationLineResult,
  TranslationProvider,
  TranslationRequest,
  TranslationResponse,
  TransliterationBatchResult,
  TransliterationLineResult,
  TransliterationProvider,
};
```

- [ ] **Step 4: Adapt the Google provider**

In `src/services/google-language-provider.ts`:

Change the type import to:
```ts
import type {
  LanguageLineInput,
  TranslationLineResult,
  TranslationProvider,
  TranslationResponse,
  TransliterationBatchResult,
  TransliterationProvider,
} from "@/services/language-provider";
```

Add above `const googleLanguageProvider`:
```ts
async function translateBatch(
  lines: LanguageLineInput[],
  targetLanguage: string,
  sourceLanguage: string | undefined,
  signal?: AbortSignal,
): Promise<{ detectedLanguage: string; lines: TranslationLineResult[] }> {
  const source = googleLanguageCode(sourceLanguage || "auto");
  const target = googleLanguageCode(targetLanguage);
  const results = await settleWithLimit(lines, (line) => translateOne(line.text, target, source, signal));
  return {
    detectedLanguage: results.find((result) => result?.detectedLanguage)?.detectedLanguage ?? "",
    lines: lines.map((line, index) => ({
      id: line.id,
      text: results[index]?.text ?? null,
      ...(results[index] === null ? { failed: true } : {}),
    })),
  };
}
```

Replace the provider declaration line and its `translate` method with:
```ts
const googleLanguageProvider: TranslationProvider & TransliterationProvider = {
  id: "google-gtx",
  async translate({ main, background, targetLanguage, sourceLanguage, signal }): Promise<TranslationResponse> {
    const [mainBatch, backgroundBatch] = await Promise.all([
      translateBatch(main, targetLanguage, sourceLanguage, signal),
      translateBatch(background, targetLanguage, sourceLanguage, signal),
    ]);
    return {
      detectedLanguage: mainBatch.detectedLanguage || backgroundBatch.detectedLanguage,
      main: mainBatch.lines,
      background: backgroundBatch.lines,
    };
  },
```
Leave `transliterate` as it is.

- [ ] **Step 5: Create `src/views/languages/run-translations.ts`**

```ts
import type { TranslationProvider, TranslationRequest, TranslationResponse } from "@/services/language-provider";

// LLM servers (especially local ones) choke on parallel whole-song requests,
// so they run one target at a time; Google keeps its parallel fan-out.
async function runTranslations(
  provider: TranslationProvider,
  targets: string[],
  build: (target: string) => TranslationRequest,
  sequential: boolean,
): Promise<TranslationResponse[]> {
  if (!sequential) return Promise.all(targets.map((target) => provider.translate(build(target))));
  const results: TranslationResponse[] = [];
  for (const target of targets) results.push(await provider.translate(build(target)));
  return results;
}

export { runTranslations };
```

- [ ] **Step 6: Run the new test and confirm it passes**

Run: `pnpm vitest run --project unit src/views/languages/run-translations.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Update the Google provider tests to the new call shape**

In `src/services/google-language-provider.test.ts`, add this helper below the imports:
```ts
import type { LanguageLineInput } from "@/services/language-provider";

function translateRequest(main: LanguageLineInput[], targetLanguage: string, sourceLanguage?: string) {
  return { main, background: [], targetLanguage, sourceLanguage, context: { title: "", artists: [], album: "" } };
}
```
Then make these mechanical edits. Leave the transliteration assertions on `result.lines` (lines 57, 58, 71) alone:
- Line 83: `googleLanguageProvider.translate(X, "zh-Hant", "zh-Hans")` → `googleLanguageProvider.translate(translateRequest(X, "zh-Hant", "zh-Hans"))`; line 84 `result.lines[0]` → `result.main[0]`.
- Line 98: same wrap with `"en", "ko"`; line 100 `result.lines[0]` → `result.main[0]`.
- Lines 110-140 (the `it.each(["translate", "transliterate"])` block): the translate branch at line 114 becomes `googleLanguageProvider.translate(translateRequest([{ id: "line", text: source }], "en", "en"))`. Because the two branches now return different shapes, change `const result = await run();` and the later `result.lines[0]` reads to use
  ```ts
  const outcome = await run();
  const first = "main" in outcome ? outcome.main[0] : outcome.lines[0];
  ```
  and replace every `result.lines[0]` in that block with `first`.
- Lines 170-181: apply the same pattern. `googleLanguageProvider.translate(inputs, "en", "en")` → `googleLanguageProvider.translate(translateRequest(inputs, "en", "en"))`, and read lines through `const resultLines = "main" in outcome ? outcome.main : outcome.lines;`.

Add one new test at the end of the `"Google translation source language"` describe:
```ts
  it("translates background lines in the same call and reports them separately", async () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return new Response(JSON.stringify([[[`T:${url.searchParams.get("q")}`]], null, "ja"]));
    });
    const result = await googleLanguageProvider.translate({
      ...translateRequest([{ id: "a", text: "line one" }], "en", "ja"),
      background: [{ id: "a", text: "bg one" }],
    });
    expect(result.main).toEqual([{ id: "a", text: "T:line one" }]);
    expect(result.background).toEqual([{ id: "a", text: "T:bg one" }]);
    expect(result.detectedLanguage).toBe("ja");
  });
```

Run: `pnpm vitest run --project unit src/services/google-language-provider.test.ts`
Expected: PASS.

- [ ] **Step 8: Move `languages.tsx` to one call per target**

In `src/views/languages.tsx`, add the import:
```ts
import { runTranslations } from "@/views/languages/run-translations";
```
Replace the second element of the `Promise.all([...])` at lines 67-72 (the `Promise.all(requestedTargets.flatMap(...))`) with:
```ts
          runTranslations(
            googleLanguageProvider,
            requestedTargets,
            (targetLanguage) => ({
              main: mainInputs,
              background: bgInputs,
              targetLanguage,
              sourceLanguage: requestedSource,
              context: {
                title: startingState.metadata.title,
                artists: startingState.metadata.artists,
                album: startingState.metadata.album,
              },
              signal: controller.signal,
            }),
            false,
          ),
```
Replace the failure check (lines 84-91) with:
```ts
        if (
          [
            ...(romanizationResults ?? []).map((batch) => batch.lines),
            ...translationResults.flatMap((batch) => [batch.main, batch.background]),
          ].some((results) => results.some((result) => result.failed))
        ) {
          toast.error("Couldn't generate some lines. Try Regenerate.");
        }
```
Replace `translationPairs` (lines 102-106) with:
```ts
        const translationPairs = requestedTargets.map((language, index) => ({
          language,
          main: new Map(translationResults[index].main.map((result) => [result.id, result])),
          background: new Map(translationResults[index].background.map((result) => [result.id, result])),
        }));
```
`detected` (line 114) keeps reading `translationResults[0]?.detectedLanguage`, which still exists.

- [ ] **Step 9: Update the lifecycle browser test mock**

In `src/views/languages.lifecycle.browser.test.tsx`, replace the `vi.spyOn(googleLanguageProvider, "translate")` block (lines 62-70) with:
```ts
    vi.spyOn(googleLanguageProvider, "translate").mockImplementation((request) => {
      if (request.main.length > 0) requestedTargets.push(request.targetLanguage);
      const result = {
        detectedLanguage: "ja",
        main: request.main.map((line) => ({ id: line.id, text: "Generated translation" })),
        background: request.background.map((line) => ({ id: line.id, text: "Generated translation" })),
      };
      return defer && request.main.length > 0
        ? new Promise((resolve) => pending.push(() => resolve(result)))
        : Promise.resolve(result);
    });
```
The pending counts in this file (`toBe(2)`: one transliteration plus one translation) stay correct. Previously the background translate call had no lines and resolved immediately, so it never counted.

- [ ] **Step 10: Verify everything that touches languages**

Run: `pnpm typecheck && pnpm vitest run --project unit src/services src/views/languages && pnpm vitest run --project browser src/views/languages`
Expected: no type errors; all PASS.

- [ ] **Step 11: Commit**

```bash
git add src/services/language-provider.ts src/services/google-language-provider.ts src/services/google-language-provider.test.ts src/views/languages/run-translations.ts src/views/languages/run-translations.test.ts src/views/languages.tsx src/views/languages.lifecycle.browser.test.tsx
git commit -m "refactor(languages): split translation provider and translate main+background per target

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: OpenAI-compatible client

**Files:**
- Create: `src/services/llm/openai-compatible-client.ts`
- Test: `src/services/llm/openai-compatible-client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type LlmErrorKind = "network" | "auth" | "not-found" | "http" | "bad-response";
  class LlmRequestError extends Error { readonly kind: LlmErrorKind; readonly status?: number }
  interface ChatMessage { role: "system" | "user"; content: string }
  interface LlmEndpoint { baseUrl: string; apiKey: string }
  function chatJson(request: LlmEndpoint & { model: string; messages: ChatMessage[]; signal?: AbortSignal }): Promise<string>
  function listModels(request: LlmEndpoint & { signal?: AbortSignal }): Promise<string[]>
  ```
  An `AbortError` from `fetch` is re-thrown unchanged.

- [ ] **Step 1: Write the failing tests**

`src/services/llm/openai-compatible-client.test.ts`:
```ts
import { chatJson, listModels, LlmRequestError } from "@/services/llm/openai-compatible-client";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

const ENDPOINT = { baseUrl: "http://localhost:11434/v1/", apiKey: "" };
const MESSAGES = [{ role: "user" as const, content: "hi" }];

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function chatBody(content: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("chatJson", () => {
  it("posts JSON-mode chat to a normalised URL without auth when no key is set", async () => {
    const fetchMock = stubFetch(chatBody("{}"));
    await chatJson({ ...ENDPOINT, model: "m", messages: MESSAGES });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "m",
      messages: MESSAGES,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });
  });

  it("sends a bearer token when a key is set", async () => {
    const fetchMock = stubFetch(chatBody("{}"));
    await chatJson({ baseUrl: "https://api.example.com/v1", apiKey: "sk-test", model: "m", messages: MESSAGES });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer sk-test");
  });

  it("returns the first choice's content", async () => {
    stubFetch(chatBody('{"lines":{}}'));
    await expect(chatJson({ ...ENDPOINT, model: "m", messages: MESSAGES })).resolves.toBe('{"lines":{}}');
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [404, "not-found"],
    [500, "http"],
  ] as const)("classifies HTTP %i as %s", async (status, kind) => {
    stubFetch(new Response("nope", { status }));
    const error = await chatJson({ ...ENDPOINT, model: "m", messages: MESSAGES }).catch((e) => e);
    expect(error).toBeInstanceOf(LlmRequestError);
    expect(error).toMatchObject({ kind, status });
  });

  it("classifies a rejected fetch (offline or CORS) as network", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    await expect(chatJson({ ...ENDPOINT, model: "m", messages: MESSAGES })).rejects.toMatchObject({ kind: "network" });
  });

  it("classifies a body without string content as bad-response", async () => {
    stubFetch(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expect(chatJson({ ...ENDPOINT, model: "m", messages: MESSAGES })).rejects.toMatchObject({
      kind: "bad-response",
    });
  });

  it("re-throws aborts unchanged", async () => {
    stubFetch(new DOMException("aborted", "AbortError"));
    await expect(chatJson({ ...ENDPOINT, model: "m", messages: MESSAGES })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("listModels", () => {
  it("returns model ids from GET /models", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), { status: 200 }));
    await expect(listModels(ENDPOINT)).resolves.toEqual(["a", "b"]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/v1/models");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });

  it("classifies a body without a data array as bad-response", async () => {
    stubFetch(new Response(JSON.stringify({}), { status: 200 }));
    await expect(listModels(ENDPOINT)).rejects.toMatchObject({ kind: "bad-response" });
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm vitest run --project unit src/services/llm/openai-compatible-client.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement the client**

`src/services/llm/openai-compatible-client.ts`:
```ts
// -- Types --------------------------------------------------------------------

type LlmErrorKind = "network" | "auth" | "not-found" | "http" | "bad-response";

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface LlmEndpoint {
  baseUrl: string;
  apiKey: string;
}

class LlmRequestError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.name = "LlmRequestError";
    this.kind = kind;
    this.status = status;
  }
}

// -- Helpers ------------------------------------------------------------------

function endpointUrl(baseUrl: string, path: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/${path}`;
}

function requestHeaders(apiKey: string): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  if (apiKey.trim()) headers.set("authorization", `Bearer ${apiKey.trim()}`);
  return headers;
}

function classifyStatus(status: number): LlmErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not-found";
  return "http";
}

async function send(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new LlmRequestError("network", `Request to ${url} failed`);
  }
  if (!response.ok) {
    throw new LlmRequestError(classifyStatus(response.status), `${url} returned ${response.status}`, response.status);
  }
  try {
    return await response.json();
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new LlmRequestError("bad-response", `${url} returned non-JSON`);
  }
}

// -- Requests -----------------------------------------------------------------

async function chatJson(
  request: LlmEndpoint & { model: string; messages: ChatMessage[]; signal?: AbortSignal },
): Promise<string> {
  const data = await send(endpointUrl(request.baseUrl, "chat/completions"), {
    method: "POST",
    headers: requestHeaders(request.apiKey),
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
    signal: request.signal,
  });
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new LlmRequestError("bad-response", "Response had no message content");
  return content;
}

async function listModels(request: LlmEndpoint & { signal?: AbortSignal }): Promise<string[]> {
  const data = await send(endpointUrl(request.baseUrl, "models"), {
    method: "GET",
    headers: requestHeaders(request.apiKey),
    signal: request.signal,
  });
  const models = (data as { data?: unknown })?.data;
  if (!Array.isArray(models)) throw new LlmRequestError("bad-response", "Response had no model list");
  return models.flatMap((model) => (typeof model?.id === "string" ? [model.id] : []));
}

// -- Exports ------------------------------------------------------------------

export { chatJson, listModels, LlmRequestError };
export type { ChatMessage, LlmEndpoint, LlmErrorKind };
```

- [ ] **Step 4: Run and confirm it passes**

Run: `pnpm vitest run --project unit src/services/llm/openai-compatible-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/llm/openai-compatible-client.ts src/services/llm/openai-compatible-client.test.ts
git commit -m "feat(llm): add OpenAI-compatible chat and model-list client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Translation prompt builder and response parser

**Files:**
- Create: `src/services/llm/translation-prompt.ts`
- Test: `src/services/llm/translation-prompt.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `LlmRequestError` (Task 2); `TranslationContext` (Task 1).
- Produces:
  ```ts
  interface PromptItem { key: string; text: string }
  interface TranslationPromptInput {
    items: PromptItem[]; contextItems?: PromptItem[];
    targetLanguage: string; sourceLanguage?: string;
    context: TranslationContext; instructions: string;
  }
  function buildTranslationMessages(input: TranslationPromptInput): ChatMessage[] // [system, user]
  function parseTranslationResponse(raw: string, expectedKeys: readonly string[]): { detectedLanguage: string; translations: Map<string, string> }
  const DEFAULT_TRANSLATION_INSTRUCTIONS: string
  ```

- [ ] **Step 1: Write the failing tests**

`src/services/llm/translation-prompt.test.ts`:
```ts
import {
  buildTranslationMessages,
  DEFAULT_TRANSLATION_INSTRUCTIONS,
  parseTranslationResponse,
} from "@/services/llm/translation-prompt";
import { describe, expect, it } from "vitest";

const ITEMS = [
  { key: "1", text: "line one" },
  { key: "1b", text: "bg one" },
  { key: "2", text: "line two" },
];
const CONTEXT = { title: "Song Title", artists: ["Artist A", "Artist B"], album: "Album X" };

function build(overrides: Partial<Parameters<typeof buildTranslationMessages>[0]> = {}) {
  return buildTranslationMessages({
    items: ITEMS,
    targetLanguage: "en",
    sourceLanguage: "ja",
    context: CONTEXT,
    instructions: "Keep it casual.",
    ...overrides,
  });
}

describe("buildTranslationMessages", () => {
  it("returns a system and a user message", () => {
    expect(build().map((message) => message.role)).toEqual(["system", "user"]);
  });

  it("names the target language and the JSON contract in the system message", () => {
    const [system] = build();
    expect(system.content).toContain("English (en)");
    expect(system.content).toContain('{"detectedLanguage"');
    expect(system.content).toContain("background vocal");
  });

  it("puts custom instructions in their own block after the fixed rules", () => {
    const [system] = build();
    const rulesEnd = system.content.indexOf("Style instructions:");
    expect(rulesEnd).toBeGreaterThan(0);
    expect(system.content.slice(rulesEnd)).toContain("Keep it casual.");
  });

  it("omits the style block when instructions are blank", () => {
    expect(build({ instructions: "  " })[0].content).not.toContain("Style instructions:");
  });

  it("includes metadata, the source language, and the keyed lines in the user message", () => {
    const user = build()[1].content;
    expect(user).toContain("Title: Song Title");
    expect(user).toContain("Artists: Artist A, Artist B");
    expect(user).toContain("Album: Album X");
    expect(user).toContain("Source language: Japanese (ja)");
    expect(user).toContain(JSON.stringify({ "1": "line one", "1b": "bg one", "2": "line two" }, null, 2));
  });

  it("omits empty metadata and an auto source language", () => {
    const user = build({ context: { title: "", artists: [], album: "" }, sourceLanguage: "auto" })[1].content;
    expect(user).not.toContain("Title:");
    expect(user).not.toContain("Artists:");
    expect(user).not.toContain("Source language:");
  });

  it("adds a context-only block when contextItems are given", () => {
    const user = build({ items: [ITEMS[2]], contextItems: ITEMS })[1].content;
    expect(user).toContain("Full song for context only. Do not translate these:");
    expect(user).toContain(JSON.stringify({ "2": "line two" }, null, 2));
  });

  it("ships non-empty default instructions", () => {
    expect(DEFAULT_TRANSLATION_INSTRUCTIONS.trim().length).toBeGreaterThan(0);
  });
});

describe("parseTranslationResponse", () => {
  const KEYS = ["1", "1b", "2"];

  it("parses clean JSON", () => {
    const parsed = parseTranslationResponse('{"detectedLanguage":"ja","lines":{"1":"A","1b":"B","2":"C"}}', KEYS);
    expect(parsed.detectedLanguage).toBe("ja");
    expect(Object.fromEntries(parsed.translations)).toEqual({ "1": "A", "1b": "B", "2": "C" });
  });

  it("parses JSON inside a code fence", () => {
    const parsed = parseTranslationResponse('```json\n{"lines":{"1":"A"}}\n```', KEYS);
    expect(parsed.translations.get("1")).toBe("A");
  });

  it("parses JSON surrounded by prose, including braces inside strings", () => {
    const parsed = parseTranslationResponse('Sure! {"lines":{"1":"A {x}","2":"C"}} Hope that helps.', KEYS);
    expect(Object.fromEntries(parsed.translations)).toEqual({ "1": "A {x}", "2": "C" });
  });

  it("accepts a flat key map without the lines wrapper", () => {
    const parsed = parseTranslationResponse('{"1":"A","2":"C"}', KEYS);
    expect(Object.fromEntries(parsed.translations)).toEqual({ "1": "A", "2": "C" });
    expect(parsed.detectedLanguage).toBe("");
  });

  it("ignores unknown keys, empty strings, and non-string values", () => {
    const parsed = parseTranslationResponse('{"lines":{"1":"A","1b":"  ","2":3,"9":"Z"}}', KEYS);
    expect(Object.fromEntries(parsed.translations)).toEqual({ "1": "A" });
  });

  it("trims translations", () => {
    expect(parseTranslationResponse('{"lines":{"1":"  A  "}}', KEYS).translations.get("1")).toBe("A");
  });

  it("throws bad-response when no JSON object is present", () => {
    expect(() => parseTranslationResponse("I cannot help with that.", KEYS)).toThrow(
      expect.objectContaining({ kind: "bad-response" }),
    );
  });

  it("throws bad-response for truncated JSON", () => {
    expect(() => parseTranslationResponse('{"lines":{"1":"A"', KEYS)).toThrow(
      expect.objectContaining({ kind: "bad-response" }),
    );
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm vitest run --project unit src/services/llm/translation-prompt.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

`src/services/llm/translation-prompt.ts`:
```ts
import type { TranslationContext } from "@/services/language-provider";
import { type ChatMessage, LlmRequestError } from "@/services/llm/openai-compatible-client";

// -- Types --------------------------------------------------------------------

interface PromptItem {
  key: string;
  text: string;
}

interface TranslationPromptInput {
  items: PromptItem[];
  /** The whole song, sent read-only when items is only a chunk or a retry. */
  contextItems?: PromptItem[];
  targetLanguage: string;
  sourceLanguage?: string;
  context: TranslationContext;
  instructions: string;
}

// -- Constants ----------------------------------------------------------------

const DEFAULT_TRANSLATION_INSTRUCTIONS = [
  "Write natural, idiomatic lines that keep the meaning, tone and imagery of the song rather than a word-for-word translation.",
  "Leave proper names untranslated.",
  'Keep interjections and vocalisations such as "oh", "yeah" or "la la" as they are.',
].join("\n");

// -- Helpers ------------------------------------------------------------------

function languageLabel(tag: string): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(tag);
    return name && name !== tag ? `${name} (${tag})` : tag;
  } catch {
    return tag;
  }
}

function keyedObject(items: PromptItem[]): string {
  return JSON.stringify(Object.fromEntries(items.map((item) => [item.key, item.text])), null, 2);
}

function systemMessage(targetLanguage: string, instructions: string): string {
  const rules = [
    `You translate song lyrics into ${languageLabel(targetLanguage)}.`,
    "Rules:",
    "- Translate every key you are given. Keep a strict one-to-one key correspondence: never merge, split, reorder or skip lines.",
    "- Lines may mix several languages. Translate every part into the target language.",
    '- Keys ending in "b" are a background vocal sung alongside the main line with the same number. Translate them in that context.',
    "- Use the whole song to resolve meaning, but translate each line on its own key.",
    '- Respond with only this JSON object and nothing else: {"detectedLanguage": "<BCP 47 tag of the main source language>", "lines": {"<key>": "<translation>"}}',
  ].join("\n");
  const style = instructions.trim();
  return style ? `${rules}\n\nStyle instructions:\n${style}` : rules;
}

function userMessage(input: TranslationPromptInput): string {
  const { context, sourceLanguage, items, contextItems } = input;
  const header = [
    context.title && `Title: ${context.title}`,
    context.artists.length > 0 && `Artists: ${context.artists.join(", ")}`,
    context.album && `Album: ${context.album}`,
    sourceLanguage && sourceLanguage !== "auto" && `Source language: ${languageLabel(sourceLanguage)}`,
  ].filter(Boolean);
  const sections = [header.join("\n")];
  if (contextItems) sections.push(`Full song for context only. Do not translate these:\n${keyedObject(contextItems)}`);
  sections.push(`Translate these lines:\n${keyedObject(items)}`);
  return sections.filter(Boolean).join("\n\n");
}

/** Returns the first balanced top-level JSON object in raw, skipping fences and prose. */
function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index++) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      try {
        return JSON.parse(raw.slice(start, index + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// -- Prompt -------------------------------------------------------------------

function buildTranslationMessages(input: TranslationPromptInput): ChatMessage[] {
  return [
    { role: "system", content: systemMessage(input.targetLanguage, input.instructions) },
    { role: "user", content: userMessage(input) },
  ];
}

function parseTranslationResponse(
  raw: string,
  expectedKeys: readonly string[],
): { detectedLanguage: string; translations: Map<string, string> } {
  const parsed = extractJsonObject(raw);
  if (!isRecord(parsed)) throw new LlmRequestError("bad-response", "Response contained no JSON object");
  const lines = isRecord(parsed.lines) ? parsed.lines : parsed;
  const translations = new Map<string, string>();
  for (const key of expectedKeys) {
    const value = lines[key];
    if (typeof value === "string" && value.trim()) translations.set(key, value.trim());
  }
  return {
    detectedLanguage: typeof parsed.detectedLanguage === "string" ? parsed.detectedLanguage : "",
    translations,
  };
}

// -- Exports ------------------------------------------------------------------

export { buildTranslationMessages, DEFAULT_TRANSLATION_INSTRUCTIONS, parseTranslationResponse };
export type { PromptItem, TranslationPromptInput };
```

- [ ] **Step 4: Run and confirm it passes**

Run: `pnpm vitest run --project unit src/services/llm/translation-prompt.test.ts`
Expected: PASS. If the `Intl.DisplayNames` label assertions fail on this Node build, check `new Intl.DisplayNames(["en"], {type: "language"}).of("ja")` in a Node REPL and match the test strings to its output. Do not remove the label.

- [ ] **Step 5: Commit**

```bash
git add src/services/llm/translation-prompt.ts src/services/llm/translation-prompt.test.ts
git commit -m "feat(llm): build whole-song translation prompts and parse keyed JSON replies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: LLM profile type and the LLM translation provider

**Files:**
- Create: `src/services/llm/llm-profile.ts`
- Create: `src/services/llm/llm-translation-provider.ts`
- Test: `src/services/llm/llm-translation-provider.test.ts`

**Interfaces:**
- Consumes: `chatJson`, `LlmRequestError` (Task 2); `buildTranslationMessages`, `parseTranslationResponse`, `PromptItem`, `DEFAULT_TRANSLATION_INSTRUCTIONS` (Task 3); `TranslationProvider`, `TranslationRequest`, `TranslationResponse` (Task 1).
- Produces:
  ```ts
  // llm-profile.ts
  type LlmPreset = "ollama" | "openai-compatible";
  interface LlmProfile { id: string; label: string; preset: LlmPreset; baseUrl: string; apiKey: string; model: string; instructions: string; maxLinesPerRequest: number }
  const OLLAMA_BASE_URL = "http://localhost:11434/v1";
  const DEFAULT_MAX_LINES_PER_REQUEST = 80;
  function createLlmProfile(preset: LlmPreset, id?: string): LlmProfile
  // llm-translation-provider.ts
  function createLlmTranslationProvider(profile: LlmProfile): TranslationProvider // id `llm:${profile.id}`
  ```
  `preset` is an addition to the spec's field list. It records which preset created the profile, so error messages can show the `OLLAMA_ORIGINS` hint.

Behaviour (from spec §5, plus two refinements noted inline):
1. Keys come from unique line ids in first-appearance order across `[...main, ...background]`. Main → `"n"`, background → `"nb"`.
2. Groups (one per line id) are packed into chunks of at most `maxLinesPerRequest` items. A group is never split. A chunk holds at least one group.
3. Chunks run sequentially. When there is more than one chunk, `contextItems` is the full song.
4. On the first chunk, `network`/`auth`/`not-found`/`http` errors reject immediately. *Refinement:* a `bad-response` on any chunk, or any error on a later chunk, puts that chunk's keys into the gap list. They then go through the single retry, which is what the spec means by "after the retry".
5. One retry for all gaps, with the full song as context. If the retry fails at the request level, the gaps stay missing. *Refinement:* if no key was translated at all and the last error was `bad-response`, throw that error so the view shows "unreadable output".
6. A missing key gives `{ id, text: null, failed: true }`. A translation equal to the source text (accent-insensitive) gives `text: null`.
7. Aborts always propagate.

- [ ] **Step 1: Write the failing tests**

`src/services/llm/llm-translation-provider.test.ts`:
```ts
import type { TranslationRequest } from "@/services/language-provider";
import { createLlmProfile } from "@/services/llm/llm-profile";
import { createLlmTranslationProvider } from "@/services/llm/llm-translation-provider";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

const PROFILE = { ...createLlmProfile("ollama", "p1"), model: "test-model" };

function request(overrides: Partial<TranslationRequest> = {}): TranslationRequest {
  return {
    main: [
      { id: "a", text: "line one" },
      { id: "b", text: "line two" },
    ],
    background: [{ id: "a", text: "bg one" }],
    targetLanguage: "en",
    sourceLanguage: "ja",
    context: { title: "", artists: [], album: "" },
    ...overrides,
  };
}

/** Each call pops the next reply; a reply is either an object for `lines`, a raw string, or an HTTP status. */
function stubReplies(...replies: Array<Record<string, string> | string | number>) {
  const prompts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      prompts.push(body.messages[1].content);
      const reply = replies.shift();
      if (reply === undefined) throw new Error("unexpected extra request");
      if (typeof reply === "number") return new Response("err", { status: reply });
      const content = typeof reply === "string" ? reply : JSON.stringify({ detectedLanguage: "ja", lines: reply });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }),
  );
  return prompts;
}

describe("createLlmTranslationProvider", () => {
  it("translates main and background lines in one request and maps keys back to ids", async () => {
    const prompts = stubReplies({ "1": "L1", "1b": "B1", "2": "L2" });
    const result = await createLlmTranslationProvider(PROFILE).translate(request());
    expect(prompts).toHaveLength(1);
    expect(result).toEqual({
      detectedLanguage: "ja",
      main: [
        { id: "a", text: "L1" },
        { id: "b", text: "L2" },
      ],
      background: [{ id: "a", text: "B1" }],
    });
  });

  it("retries only the missing keys once and keeps earlier results", async () => {
    const prompts = stubReplies({ "1": "L1" }, { "1b": "B1", "2": "L2" });
    const result = await createLlmTranslationProvider(PROFILE).translate(request());
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Full song for context only");
    expect(prompts[1]).toContain(JSON.stringify({ "1b": "bg one", "2": "line two" }, null, 2));
    expect(result.main.map((line) => line.text)).toEqual(["L1", "L2"]);
    expect(result.background[0].text).toBe("B1");
  });

  it("marks keys still missing after the retry as failed", async () => {
    stubReplies({ "1": "L1" }, { "1b": "B1" });
    const result = await createLlmTranslationProvider(PROFILE).translate(request());
    expect(result.main[1]).toEqual({ id: "b", text: null, failed: true });
  });

  it("returns null without failing when the translation equals the source", async () => {
    stubReplies({ "1": "LINE ONE", "1b": "B1", "2": "L2" });
    const result = await createLlmTranslationProvider(PROFILE).translate(request());
    expect(result.main[0]).toEqual({ id: "a", text: null });
  });

  it("chunks sequentially without splitting a main line from its background", async () => {
    const prompts = stubReplies({ "1": "L1", "1b": "B1" }, { "2": "L2" });
    const profile = { ...PROFILE, maxLinesPerRequest: 2 };
    const result = await createLlmTranslationProvider(profile).translate(request());
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain(JSON.stringify({ "1": "line one", "1b": "bg one" }, null, 2));
    expect(prompts[1]).toContain(JSON.stringify({ "2": "line two" }, null, 2));
    expect(prompts[1]).toContain("Full song for context only");
    expect(result.main.map((line) => line.text)).toEqual(["L1", "L2"]);
  });

  it("rejects when the first request fails at the HTTP level", async () => {
    stubReplies(401);
    await expect(createLlmTranslationProvider(PROFILE).translate(request())).rejects.toMatchObject({ kind: "auth" });
  });

  it("keeps earlier chunks when a later chunk fails, retrying its keys", async () => {
    stubReplies({ "1": "L1", "1b": "B1" }, 500, 500);
    const profile = { ...PROFILE, maxLinesPerRequest: 2 };
    const result = await createLlmTranslationProvider(profile).translate(request());
    expect(result.main[0].text).toBe("L1");
    expect(result.main[1]).toEqual({ id: "b", text: null, failed: true });
  });

  it("retries an unreadable first reply and throws bad-response if nothing ever parses", async () => {
    stubReplies("no json here", "still none");
    await expect(createLlmTranslationProvider(PROFILE).translate(request())).rejects.toMatchObject({
      kind: "bad-response",
    });
  });

  it("recovers when the retry parses after an unreadable first reply", async () => {
    stubReplies("no json here", { "1": "L1", "1b": "B1", "2": "L2" });
    const result = await createLlmTranslationProvider(PROFILE).translate(request());
    expect(result.main.map((line) => line.text)).toEqual(["L1", "L2"]);
  });

  it("translates a line that only has a background vocal", async () => {
    stubReplies({ "1": "L1", "2b": "B2" });
    const result = await createLlmTranslationProvider(PROFILE).translate(
      request({ main: [{ id: "a", text: "line one" }], background: [{ id: "c", text: "bg two" }] }),
    );
    expect(result.background).toEqual([{ id: "c", text: "B2" }]);
  });

  it("returns empty results without a request when there is nothing to translate", async () => {
    const prompts = stubReplies();
    const result = await createLlmTranslationProvider(PROFILE).translate(request({ main: [], background: [] }));
    expect(prompts).toHaveLength(0);
    expect(result).toEqual({ detectedLanguage: "", main: [], background: [] });
  });

  it("propagates aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    await expect(createLlmTranslationProvider(PROFILE).translate(request())).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("createLlmProfile", () => {
  it("fills the Ollama preset", () => {
    expect(createLlmProfile("ollama", "x")).toMatchObject({
      id: "x",
      preset: "ollama",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      maxLinesPerRequest: 80,
    });
  });

  it("starts the OpenAI-compatible preset blank", () => {
    expect(createLlmProfile("openai-compatible", "y")).toMatchObject({ baseUrl: "", label: "", model: "" });
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm vitest run --project unit src/services/llm/llm-translation-provider.test.ts`
Expected: FAIL. The modules are not found.

- [ ] **Step 3: Implement `llm-profile.ts`**

```ts
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
```

- [ ] **Step 4: Implement `llm-translation-provider.ts`**

```ts
import type {
  LanguageLineInput,
  TranslationLineResult,
  TranslationProvider,
  TranslationRequest,
  TranslationResponse,
} from "@/services/language-provider";
import type { LlmProfile } from "@/services/llm/llm-profile";
import { chatJson, LlmRequestError } from "@/services/llm/openai-compatible-client";
import { buildTranslationMessages, type PromptItem, parseTranslationResponse } from "@/services/llm/translation-prompt";

// -- Types --------------------------------------------------------------------

interface KeyedItem extends PromptItem {
  id: string;
  slot: "main" | "background";
}

// -- Keys & chunks ------------------------------------------------------------

/** One group per line id, numbered in first-appearance order; background keys get a "b" suffix. */
function keyedGroups(main: LanguageLineInput[], background: LanguageLineInput[]): KeyedItem[][] {
  const groups = new Map<string, KeyedItem[]>();
  const groupFor = (id: string) => {
    let group = groups.get(id);
    if (!group) {
      group = [];
      groups.set(id, group);
    }
    return group;
  };
  for (const line of main) groupFor(line.id);
  for (const line of background) groupFor(line.id);
  const numbers = new Map([...groups.keys()].map((id, index) => [id, index + 1]));
  for (const line of main) groupFor(line.id).push({ id: line.id, slot: "main", key: `${numbers.get(line.id)}`, text: line.text });
  for (const line of background) {
    groupFor(line.id).push({ id: line.id, slot: "background", key: `${numbers.get(line.id)}b`, text: line.text });
  }
  return [...groups.values()].filter((group) => group.length > 0);
}

function packChunks(groups: KeyedItem[][], maxItems: number): KeyedItem[][] {
  const chunks: KeyedItem[][] = [];
  let current: KeyedItem[] = [];
  for (const group of groups) {
    if (current.length > 0 && current.length + group.length > maxItems) {
      chunks.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function isAbort(error: unknown): boolean {
  return (error as Error)?.name === "AbortError";
}

function sameAsSource(translation: string, source: string): boolean {
  return translation.localeCompare(source, undefined, { sensitivity: "accent" }) === 0;
}

// -- Provider -----------------------------------------------------------------

function createLlmTranslationProvider(profile: LlmProfile): TranslationProvider {
  async function requestItems(items: KeyedItem[], contextItems: KeyedItem[] | undefined, request: TranslationRequest) {
    const messages = buildTranslationMessages({
      items,
      contextItems,
      targetLanguage: request.targetLanguage,
      sourceLanguage: request.sourceLanguage,
      context: request.context,
      instructions: profile.instructions,
    });
    const raw = await chatJson({ ...profile, messages, signal: request.signal });
    return parseTranslationResponse(
      raw,
      items.map((item) => item.key),
    );
  }

  return {
    id: `llm:${profile.id}`,
    async translate(request): Promise<TranslationResponse> {
      const groups = keyedGroups(request.main, request.background);
      const allItems = groups.flat();
      const chunks = packChunks(groups, Math.max(1, profile.maxLinesPerRequest));
      const translations = new Map<string, string>();
      let detectedLanguage = "";
      let gaps: KeyedItem[] = [];
      let lastError: unknown;

      const collect = (items: KeyedItem[], parsed: Awaited<ReturnType<typeof requestItems>>) => {
        if (!detectedLanguage && parsed.detectedLanguage) detectedLanguage = parsed.detectedLanguage;
        for (const [key, text] of parsed.translations) translations.set(key, text);
        gaps.push(...items.filter((item) => !parsed.translations.has(item.key)));
      };

      for (const [index, chunk] of chunks.entries()) {
        try {
          collect(chunk, await requestItems(chunk, chunks.length > 1 ? allItems : undefined, request));
        } catch (error) {
          if (isAbort(error)) throw error;
          const unreadable = error instanceof LlmRequestError && error.kind === "bad-response";
          if (index === 0 && !unreadable) throw error;
          lastError = error;
          gaps.push(...chunk);
        }
      }

      if (gaps.length > 0) {
        const retryItems = gaps;
        gaps = [];
        try {
          collect(retryItems, await requestItems(retryItems, allItems, request));
        } catch (error) {
          if (isAbort(error)) throw error;
          lastError = error;
        }
      }

      if (allItems.length > 0 && translations.size === 0 && lastError instanceof LlmRequestError && lastError.kind === "bad-response") {
        throw lastError;
      }

      const resultFor = (item: KeyedItem): TranslationLineResult => {
        const text = translations.get(item.key);
        if (text === undefined) return { id: item.id, text: null, failed: true };
        return { id: item.id, text: sameAsSource(text, item.text) ? null : text };
      };
      return {
        detectedLanguage,
        main: allItems.filter((item) => item.slot === "main").map(resultFor),
        background: allItems.filter((item) => item.slot === "background").map(resultFor),
      };
    },
  };
}

// -- Exports ------------------------------------------------------------------

export { createLlmTranslationProvider };
```

`chatJson({ ...profile, messages, signal })` passes extra profile fields (`id`, `label`...) that `chatJson` ignores. TypeScript accepts the spread because the extra fields come from a spread variable, not an object literal. If Biome or tsc objects, pass `{ baseUrl: profile.baseUrl, apiKey: profile.apiKey, model: profile.model, messages, signal: request.signal }` instead.

**Ordering note:** `main` and `background` results come out in key order (`allItems`), not input order. Both follow line order, so this matches what the view expects. The tests compare arrays, so a mismatch shows up immediately.

- [ ] **Step 5: Run and confirm it passes**

Run: `pnpm vitest run --project unit src/services/llm`
Expected: PASS (all three llm test files).

- [ ] **Step 6: Commit**

```bash
git add src/services/llm/llm-profile.ts src/services/llm/llm-translation-provider.ts src/services/llm/llm-translation-provider.test.ts
git commit -m "feat(llm): whole-song LLM translation provider with chunking and gap retry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Persist LLM profiles and the selected translation provider

**Files:**
- Create: `src/stores/settings-llm-profiles.ts`
- Modify: `src/stores/settings.ts`
- Create: `src/stores/settings.llm-profiles.test.ts`
- Modify: `src/stores/settings.migration.test.ts` (version references only, if any assert `6`)

**Interfaces:**
- Consumes: `LlmProfile`, `createLlmProfile`, `LlmPreset` (Task 4).
- Produces on `useSettingsStore`:
  ```ts
  llmProfiles: LlmProfile[];                 // default []
  translationProvider: string;               // "google" | profile id; default "google"
  addLlmProfile(preset: LlmPreset, fields?: Partial<Omit<LlmProfile, "id" | "preset">>): string; // returns new id
  updateLlmProfile(id: string, updates: Partial<Omit<LlmProfile, "id">>): void;
  removeLlmProfile(id: string): void;        // resets translationProvider to "google" when it was this id
  selectTranslationProvider(id: string): void;
  ```
  Exported constant `GOOGLE_TRANSLATION_PROVIDER = "google"`.

- [ ] **Step 1: Write the failing tests**

`src/stores/settings.llm-profiles.test.ts`:
```ts
import { DEFAULTS, GOOGLE_TRANSLATION_PROVIDER, migrateSettingsForTest, useSettingsStore } from "@/stores/settings";
import { describe, expect, it } from "vitest";

describe("LLM profile settings", () => {
  it("defaults to Google with no profiles", () => {
    expect(DEFAULTS.translationProvider).toBe(GOOGLE_TRANSLATION_PROVIDER);
    expect(DEFAULTS.llmProfiles).toEqual([]);
  });

  it("adds a profile from a preset with overrides and returns its id", () => {
    const id = useSettingsStore.getState().addLlmProfile("ollama", { model: "test-model" });
    const [profile] = useSettingsStore.getState().llmProfiles;
    expect(profile).toMatchObject({ id, preset: "ollama", model: "test-model", baseUrl: "http://localhost:11434/v1" });
  });

  it("updates a profile in place", () => {
    const id = useSettingsStore.getState().addLlmProfile("openai-compatible");
    useSettingsStore.getState().updateLlmProfile(id, { label: "Hosted", model: "m" });
    expect(useSettingsStore.getState().llmProfiles[0]).toMatchObject({ id, label: "Hosted", model: "m" });
  });

  it("falls back to Google when the selected profile is removed", () => {
    const id = useSettingsStore.getState().addLlmProfile("ollama");
    useSettingsStore.getState().selectTranslationProvider(id);
    useSettingsStore.getState().removeLlmProfile(id);
    expect(useSettingsStore.getState().translationProvider).toBe(GOOGLE_TRANSLATION_PROVIDER);
    expect(useSettingsStore.getState().llmProfiles).toEqual([]);
  });

  it("keeps the selection when a different profile is removed", () => {
    const keep = useSettingsStore.getState().addLlmProfile("ollama");
    const drop = useSettingsStore.getState().addLlmProfile("ollama");
    useSettingsStore.getState().selectTranslationProvider(keep);
    useSettingsStore.getState().removeLlmProfile(drop);
    expect(useSettingsStore.getState().translationProvider).toBe(keep);
  });

  it("keeps profiles and the selection across reset to defaults", () => {
    const id = useSettingsStore.getState().addLlmProfile("ollama");
    useSettingsStore.getState().selectTranslationProvider(id);
    useSettingsStore.getState().resetToDefaults();
    expect(useSettingsStore.getState().llmProfiles.map((profile) => profile.id)).toEqual([id]);
    expect(useSettingsStore.getState().translationProvider).toBe(id);
  });

  it("migration adds the defaults to an older blob", () => {
    const { llmProfiles: _p, translationProvider: _t, ...older } = DEFAULTS;
    const migrated = migrateSettingsForTest(older, 6) as typeof DEFAULTS;
    expect(migrated.llmProfiles).toEqual([]);
    expect(migrated.translationProvider).toBe("google");
  });

  it("migration keeps existing profiles", () => {
    const blob = { ...DEFAULTS, llmProfiles: [{ id: "x" }], translationProvider: "x" };
    const migrated = migrateSettingsForTest(blob, 7) as { translationProvider: string };
    expect(migrated.translationProvider).toBe("x");
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm vitest run --project unit src/stores/settings.llm-profiles.test.ts`
Expected: FAIL. `GOOGLE_TRANSLATION_PROVIDER` and `addLlmProfile` are not defined.

- [ ] **Step 3: Create the actions module**

`src/stores/settings-llm-profiles.ts`:
```ts
import { createLlmProfile, type LlmPreset, type LlmProfile } from "@/services/llm/llm-profile";

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
```

- [ ] **Step 4: Wire it into `src/stores/settings.ts`**

1. Add the import:
   ```ts
   import {
     GOOGLE_TRANSLATION_PROVIDER,
     LLM_PROFILES_DEFAULTS,
     type LlmProfilesActions,
     type LlmProfilesState,
     llmProfilesActions,
     migrateLlmProfiles,
   } from "@/stores/settings-llm-profiles";
   ```
2. `interface SettingsState extends LlmProfilesState {`. Replace the opening line `interface SettingsState {`.
3. `interface SettingsActions extends LlmProfilesActions {`.
4. In `DEFAULTS`, after `composerBridgeUrl: DEFAULT_BRIDGE_URL,` add `...LLM_PROFILES_DEFAULTS,`.
5. `const SETTINGS_PERSIST_VERSION = 7;`
6. In `migrateSettings`, before `return next;` add `migrateLlmProfiles(next);`.
7. In `resetToDefaults`, after `composerBridgeUrl: state.composerBridgeUrl,` add:
   ```ts
          llmProfiles: state.llmProfiles,
          translationProvider: state.translationProvider,
   ```
8. In the store body, after `...DEFAULTS,` add `...llmProfilesActions(set),`.
9. Add `GOOGLE_TRANSLATION_PROVIDER` to the value export list.

If `src/stores/settings.migration.test.ts` hard-codes `6` as the *current* version anywhere (e.g. `rehydrateAt(6, ...)` meaning "current"), leave those calls alone. A blob at 6 still migrates correctly. Change nothing unless a test fails.

- [ ] **Step 5: Run and confirm it passes**

Run: `pnpm vitest run --project unit src/stores && wc -l src/stores/settings.ts`
Expected: PASS. `settings.ts` stays at or under 300 lines.

- [ ] **Step 6: Commit**

```bash
git add src/stores/settings-llm-profiles.ts src/stores/settings.ts src/stores/settings.llm-profiles.test.ts
git commit -m "feat(settings): persist LLM profiles and the selected translation provider

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Translation settings section with the profile editor

**Files:**
- Create: `src/services/llm/llm-error-message.ts`
- Test: `src/services/llm/llm-error-message.test.ts`
- Modify: `src/stores/settings-catalog.ts` (section id + section list)
- Create: `src/stores/settings-catalog-translation-entries.ts`
- Modify: `src/stores/settings-catalog-entries.ts` (spread entries after the last `sync` entry)
- Modify: `src/ui/settings/settings-section-icons.ts`
- Modify: `src/ui/settings/setting-controls-registry.tsx`
- Create: `src/ui/settings/llm-profile-form.tsx`
- Create: `src/ui/settings/llm-profiles-setting.tsx`
- Test: `src/ui/settings/llm-profiles-setting.browser.test.tsx`
- Modify: `src/stores/settings-catalog.test.ts` (one assertion)

**Interfaces:**
- Consumes: settings actions (Task 5), `listModels`, `LlmRequestError` (Task 2), `DEFAULT_TRANSLATION_INSTRUCTIONS` (Task 3), `LlmProfile`, `LlmPreset` (Task 4), `isValidHttpUrl`, `ensureHttpScheme` from `@/utils/url`, `Button` from `@/ui/button`, `IconButton` from `@/ui/icon-button`, `SettingText` from `@/ui/settings/setting-text`.
- Produces: `function llmErrorMessage(error: LlmRequestError, profile: LlmProfile): string` (used again in Task 7), setting id `llmProfiles` (section `"translation"`), `LlmProfilesSetting` component, `LlmProfileForm` component:
  ```ts
  const LlmProfileForm: React.FC<{ initial: LlmProfile; submitLabel: string; onSave: (profile: LlmProfile) => void; onCancel: () => void }>
  ```

- [ ] **Step 1: Write the failing tests**

`src/services/llm/llm-error-message.test.ts`:
```ts
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
```


Add to `src/stores/settings-catalog.test.ts`, inside `describe("regressions", ...)`:
```ts
    it("lists LLM profiles under Translation, right after Sync & Timing", () => {
      expect(settingIdsInSection("translation")).toEqual(["llmProfiles"]);
      const order = SETTINGS_SECTIONS.map((section) => section.id);
      expect(order.indexOf("translation")).toBe(order.indexOf("sync") + 1);
    });
```

`src/ui/settings/llm-profiles-setting.browser.test.tsx`:
```tsx
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
```

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm vitest run --project unit src/services/llm/llm-error-message.test.ts src/stores/settings-catalog.test.ts && pnpm vitest run --project browser src/ui/settings/llm-profiles-setting.browser.test.tsx`
Expected: FAIL. `llm-error-message`, the `"translation"` section and the component don't exist.

- [ ] **Step 3: Implement the error message, the section and the catalog entry**

`src/services/llm/llm-error-message.ts`:
```ts
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
```

In the unit project, `window` may be undefined. If the Ollama test throws `window is not defined`, use `globalThis.location?.origin ?? "this site"` instead.

Run `pnpm vitest run --project unit src/services/llm/llm-error-message.test.ts` and expect PASS before continuing.


In `src/stores/settings-catalog.ts`:
- Add `| "translation"` to `SettingsSectionId` after `| "sync"`.
- Insert `{ id: "translation", label: "Translation" },` into `SETTINGS_SECTIONS` right after the `sync` entry.

`src/stores/settings-catalog-translation-entries.ts`:
```ts
import type { SettingEntry } from "@/stores/settings-catalog";

// Catalog entries for the Translation section. Kept in their own module so
// settings-catalog-entries.ts stays under the 300-line budget. Spread into
// SETTINGS_CATALOG right after the last sync entry.

const TRANSLATION_ENTRIES = {
  llmProfiles: {
    section: "translation",
    label: "LLM translation profiles",
    description:
      "Translate lyrics with a local Ollama model or any OpenAI-compatible API instead of Google Translate. Pick the profile in the Languages tab. API keys are stored only in this browser.",
    keywords: ["llm", "ollama", "openai", "ai", "model", "translate", "api key", "lm studio", "openrouter"],
  },
} as const satisfies Record<string, SettingEntry>;

export { TRANSLATION_ENTRIES };
```

In `src/stores/settings-catalog-entries.ts`, import `TRANSLATION_ENTRIES` and spread `...TRANSLATION_ENTRIES,` right after the `defaultGranularity` entry (the last `sync` entry, ending around line 199) and before `confirmReplaceProjectFromHash`.

In `src/ui/settings/settings-section-icons.ts`, import `IconLanguage` from `@tabler/icons-react` and add `translation: IconLanguage,` after `sync`.

- [ ] **Step 4: Build the form**

`src/ui/settings/llm-profile-form.tsx`:
```tsx
import type { LlmProfile } from "@/services/llm/llm-profile";
import { llmErrorMessage } from "@/services/llm/llm-error-message";
import { listModels, LlmRequestError } from "@/services/llm/openai-compatible-client";
import { DEFAULT_TRANSLATION_INSTRUCTIONS } from "@/services/llm/translation-prompt";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
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
      const message =
        error instanceof LlmRequestError ? llmErrorMessage(error, draft) : "Connection test failed.";
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
        <input id={`${draft.id}-label`} className={INPUT} value={draft.label} onChange={(e) => update({ label: e.target.value })} />
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
        <input id={`${draft.id}-model`} className={cn(INPUT, "font-mono")} value={draft.model} onChange={(e) => update({ model: e.target.value })} />
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
        <Button size="sm" variant="secondary" onClick={() => void testConnection()} disabled={!urlValid || connection.status === "testing"}>
          Test connection
        </Button>
        {connection.status === "ok" && (
          <span className="text-[11px] text-composer-text-muted">
            Connected. {connection.models.length} {connection.models.length === 1 ? "model" : "models"} found.
          </span>
        )}
        {connection.status === "error" && <span className="text-[11px] text-composer-error-text">{connection.message}</span>}
      </div>
      {connection.status === "ok" && connection.models.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {connection.models.map((model) => (
            <Button key={model} size="sm" variant={model === draft.model ? "primary" : "secondary"} onClick={() => update({ model })}>
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
```

Check `src/ui/button.tsx` for the supported `variant` values. If `"ghost"` doesn't exist, use `"secondary"`. The pluralisation must go through `pluralize` from `@/utils/pluralize` if `src/test/pluralize-owner.test.ts` flags the inline ternary: replace it with `{pluralize(connection.models.length, "model")} found.` and update the test text to match `pluralize`'s output (e.g. `"Connected. 2 models found."`).

- [ ] **Step 5: Build the list and register it**

`src/ui/settings/llm-profiles-setting.tsx`:
```tsx
import { createLlmProfile, type LlmPreset, type LlmProfile } from "@/services/llm/llm-profile";
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
```

In `src/ui/settings/setting-controls-registry.tsx`, import `LlmProfilesSetting` and add `llmProfiles: { kind: "custom", Component: LlmProfilesSetting },` to `SETTING_CONTROLS`.

If `Button` doesn't forward `aria-label`, wrap the label text instead: name the buttons "Add Ollama profile" / "Add OpenAI-compatible profile" as visible text and drop the `aria-label`.

- [ ] **Step 6: Run and confirm everything passes**

Run: `pnpm typecheck && pnpm vitest run --project unit src/stores src/ui src/test && pnpm vitest run --project browser src/ui/settings`
Expected: PASS, including the catalog copy guards, the settings-section-rows tests, the search-settings tests and the file-size budget. If a settings modal/nav test enumerates sections, add `"translation"` to its expected list.

- [ ] **Step 7: Commit**

```bash
git add src/services/llm/llm-error-message.ts src/services/llm/llm-error-message.test.ts src/stores/settings-catalog.ts src/stores/settings-catalog-translation-entries.ts src/stores/settings-catalog-entries.ts src/stores/settings-catalog.test.ts src/ui/settings/settings-section-icons.ts src/ui/settings/setting-controls-registry.tsx src/ui/settings/llm-profile-form.tsx src/ui/settings/llm-profiles-setting.tsx src/ui/settings/llm-profiles-setting.browser.test.tsx
git commit -m "feat(settings): Translation section for managing LLM profiles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Resolve the provider in the Languages tab: picker, sequential LLM runs, missing-model guard, error toasts

**Files:**
- Create: `src/services/resolve-translation-provider.ts`
- Create: `src/services/resolve-translation-provider.test.ts`
- Create: `src/views/languages/translation-provider-select.tsx`
- Modify: `src/views/languages.tsx`
- Create: `src/views/languages.llm.browser.test.tsx`

**Interfaces:**
- Consumes: `googleLanguageProvider` (Task 1), `runTranslations` (Task 1), `LlmRequestError` (Task 2), `createLlmTranslationProvider` (Task 4), settings fields/actions (Task 5), `llmErrorMessage` and the `llmProfiles` setting id (Task 6).
- Produces:
  ```ts
  function resolveTranslationProvider(settings: Pick<SettingsState, "llmProfiles" | "translationProvider">): { provider: TranslationProvider; profile?: LlmProfile }
  const TranslationProviderSelect: React.FC<{ disabled: boolean }>
  const MissingModelNotice: React.FC  // renders nothing unless the selected LLM profile has no model
  ```

- [ ] **Step 1: Write the failing unit test**

`src/services/resolve-translation-provider.test.ts`:
```ts
import { googleLanguageProvider } from "@/services/google-language-provider";
import { createLlmProfile } from "@/services/llm/llm-profile";
import { resolveTranslationProvider } from "@/services/resolve-translation-provider";
import { describe, expect, it } from "vitest";

const PROFILE = { ...createLlmProfile("ollama", "p1"), model: "m" };

describe("resolveTranslationProvider", () => {
  it("returns Google for the google id", () => {
    expect(resolveTranslationProvider({ llmProfiles: [PROFILE], translationProvider: "google" })).toEqual({
      provider: googleLanguageProvider,
    });
  });

  it("returns an LLM provider and its profile for a profile id", () => {
    const resolved = resolveTranslationProvider({ llmProfiles: [PROFILE], translationProvider: "p1" });
    expect(resolved.provider.id).toBe("llm:p1");
    expect(resolved.profile).toBe(PROFILE);
  });

  it("falls back to Google for a stale profile id", () => {
    expect(resolveTranslationProvider({ llmProfiles: [], translationProvider: "gone" }).provider).toBe(
      googleLanguageProvider,
    );
  });
});
```


- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm vitest run --project unit src/services/resolve-translation-provider.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement the resolver**

`src/services/resolve-translation-provider.ts`:
```ts
import { googleLanguageProvider } from "@/services/google-language-provider";
import type { TranslationProvider } from "@/services/language-provider";
import type { LlmProfile } from "@/services/llm/llm-profile";
import { createLlmTranslationProvider } from "@/services/llm/llm-translation-provider";
import type { SettingsState } from "@/stores/settings";

function resolveTranslationProvider(
  settings: Pick<SettingsState, "llmProfiles" | "translationProvider">,
): { provider: TranslationProvider; profile?: LlmProfile } {
  const profile = settings.llmProfiles.find((candidate) => candidate.id === settings.translationProvider);
  if (!profile) return { provider: googleLanguageProvider };
  return { provider: createLlmTranslationProvider(profile), profile };
}

export { resolveTranslationProvider };
```


Run: `pnpm vitest run --project unit src/services/resolve-translation-provider.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing browser tests**

`src/views/languages.llm.browser.test.tsx`:
```tsx
import { googleLanguageProvider } from "@/services/google-language-provider";
import { useProjectStore } from "@/stores/project";
import { useSettingsStore } from "@/stores/settings";
import { render } from "@/test/render";
import { LanguagesPanel } from "@/views/languages";
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

describe("Languages translation provider", () => {
  it("sends one Google request per target with main and background together", async () => {
    const translate = mockGoogle();
    const screen = await render(<LanguagesPanel />);
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
        choices: [{ message: { content: JSON.stringify({ detectedLanguage: "ja", lines: { "1": "LLM text" } }) } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const screen = await render(<LanguagesPanel />);
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
    const screen = await render(<LanguagesPanel />);
    await expect.element(screen.getByText(/Choose a model for Local model/)).toBeInTheDocument();
    await expect.element(screen.getByRole("textbox", { name: "Transliteration", exact: true })).toHaveValue("romaji");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
  });
});
```

The lines fixture uses `backgroundText: "(bg one)"`. If the project store reconciles brackets differently, set `backgroundText` to whatever form `languageSourceText` accepts. Check `src/domain/language/source-text.ts`. The test only needs one main and one background input.

- [ ] **Step 5: Run and confirm they fail**

Run: `pnpm vitest run --project browser src/views/languages.llm.browser.test.tsx`
Expected: test 1 passes (Task 1 already did this); tests 2-4 FAIL (no picker, the LLM is never used, no notice).

- [ ] **Step 6: Create the picker and notice**

`src/views/languages/translation-provider-select.tsx`:
```tsx
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
```

Check `SettingLink`'s export name in `src/ui/setting-link.tsx` (the file defines `SettingTargetLink` and `SettingLinkProps = { setting } | { section }`). Import whatever that file exports as the public link component. Search `grep -rn "<SettingLink" src | head -3` for an existing call site and copy it.

- [ ] **Step 7: Use the resolver in `languages.tsx`**

1. Add the imports:
   ```ts
   import { LlmRequestError } from "@/services/llm/openai-compatible-client";
   import { llmErrorMessage } from "@/services/llm/llm-error-message";
   import { resolveTranslationProvider } from "@/services/resolve-translation-provider";
   import { useSettingsStore } from "@/stores/settings";
   import { MissingModelNotice, TranslationProviderSelect } from "@/views/languages/translation-provider-select";
   ```
2. At the top of the `try` in `generate` (before `languageGenerationInputs`), add:
   ```ts
        const { provider, profile } = resolveTranslationProvider(useSettingsStore.getState());
        // An LLM profile without a model can't translate; the notice explains why.
        const translationTargets = profile && !profile.model.trim() ? [] : requestedTargets;
   ```
   and declare `let activeProfile: LlmProfile | undefined;` just above the `try`, setting `activeProfile = profile;` right after resolving, so the `catch` block can see it. Import `type LlmProfile` from `@/services/llm/llm-profile`.
3. In the `runTranslations(...)` call, replace `googleLanguageProvider` with `provider`, `requestedTargets` with `translationTargets`, and the final `false` with `profile !== undefined`.
4. In `translationPairs`, replace `requestedTargets.map` with `translationTargets.map`.
5. Replace the `catch` body with:
   ```ts
        if ((error as Error).name === "AbortError") return;
        if (error instanceof LlmRequestError && activeProfile) toast.error(llmErrorMessage(error, activeProfile));
        else toast.error("Couldn't generate some lines. Try Regenerate.");
   ```
6. In the header, put `<TranslationProviderSelect disabled={isGenerating} />` right before the `<span>Source</span>` element.
7. Render `<MissingModelNotice />` right after `<LanguageTrackBar ... />`.
8. Leave the transliteration calls on `googleLanguageProvider`.

Run `wc -l src/views/languages.tsx`. If it is over 300 lines, move the `context` builder and the failure check into `src/views/languages/run-translations.ts` as `translationContext(metadata)` and `hasFailedLines(romanization, translations)`, export them, and use them from `languages.tsx`.

- [ ] **Step 8: Run and confirm everything passes**

Run: `pnpm typecheck && pnpm vitest run --project browser src/views/languages && pnpm vitest run --project unit src/services src/test`
Expected: PASS, including `no-raw-settings-references` and `file-size-budget`.

- [ ] **Step 9: Commit**

```bash
git add src/services/resolve-translation-provider.ts src/services/resolve-translation-provider.test.ts src/views/languages/translation-provider-select.tsx src/views/languages.tsx src/views/languages/run-translations.ts src/views/languages.llm.browser.test.tsx
git commit -m "feat(languages): pick Google or an LLM profile for translation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run the full suite and the static checks**

Run: `pnpm typecheck && pnpm test && pnpm knip && pnpm lint:fix`
Expected: all green. `knip` should not report `LanguageProvider`/`TranslationBatchResult` (removed) or any new unused export. If `lint:fix` reformats files, review the diff.

- [ ] **Step 2: Refresh the knowledge graph**

Run: `graphify update .`

- [ ] **Step 3: Manual smoke test (optional, needs local Ollama)**

```bash
OLLAMA_ORIGINS="http://localhost:5173" ollama serve
```
Then `pnpm dev`. Add an Ollama profile in the Translation section, use Test connection, pick a model, select it in the Languages tab, and Regenerate. Check that every line gets a translation, and that stopping Ollama mid-run shows the `OLLAMA_ORIGINS` toast.

- [ ] **Step 4: Commit any lint/format fixes**

```bash
git add -A src
git commit -m "chore: lint and format LLM translation feature

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Skip if there is nothing to commit.)
