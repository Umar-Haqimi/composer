# LLM Lyrics Translation (Ollama / OpenAI-compatible)

Date: 2026-10-11
Status: Draft for review

## Goal

Let users translate lyrics with a local Ollama model or any OpenAI-compatible
API instead of Google Translate, while keeping Google as an option.

Motivation (from the user):

- **Context-aware translation.** Google translates line by line and often
  misreads multilingual lines or lines whose meaning depends on the rest of the
  song. The LLM must see the whole song.
- **Reliability.** Google frequently leaves many lines untranslated. The LLM
  path must detect and retry missing lines, and report any that still fail.

## Scope

In scope:

- Translation only, via saved LLM profiles or Google.
- A provider picker in the Languages tab.
- A new "Translation" settings section for managing profiles.

Out of scope:

- Transliteration (romanization) stays on Google, unchanged.
- Streaming / incremental results.
- Automatic fallback to Google when an LLM request fails.
- Caching LLM results.

## Background (current code)

- `src/views/languages.tsx` calls `googleLanguageProvider` directly for both
  transliteration and translation, issuing separate `translate()` calls for
  main and background inputs.
- `src/services/language-provider.ts` defines a single `LanguageProvider`
  interface with `translate` and `transliterate`.
- Main and background inputs share the same `line.id`
  (`src/views/languages/generation-inputs.ts`).
- Composer is a browser-only static app; LLM requests go directly from the
  browser. Ollama exposes an OpenAI-compatible API at `/v1`, so one client
  covers Ollama, LM Studio, llama.cpp server, OpenRouter, OpenAI, etc. Local
  Ollama requires `OLLAMA_ORIGINS` to include the app's origin.
- Settings persist via zustand `persist` in `src/stores/settings.ts`; the Cobalt
  instance list (list + selected id) is the pattern to follow.

## Design

### 1. Data model and settings

Added to `SettingsState` (persisted):

```ts
interface LlmProfile {
  id: string;
  label: string;              // e.g. "Ollama – qwen3:14b"
  baseUrl: string;            // e.g. "http://localhost:11434/v1"
  apiKey: string;             // "" when not needed
  model: string;
  instructions: string;       // custom style prompt; seeded with DEFAULT_TRANSLATION_INSTRUCTIONS
  maxLinesPerRequest: number; // chunk size, default 80
}

llmProfiles: LlmProfile[];               // default []
translationProvider: "google" | string;  // "google" or a profile id; default "google"
```

Actions: `addLlmProfile`, `updateLlmProfile`, `removeLlmProfile`,
`selectTranslationProvider`. Removing the selected profile resets
`translationProvider` to `"google"`.

Persist version is bumped; the migration adds the defaults. Existing users keep
Google and see no behaviour change.

API keys are stored in the browser's local storage. The UI states this. Any
settings export/share path (to be enumerated during planning — candidates are
`src/stores/settings.ts`, `src/ui/settings-modal.tsx`) must omit `apiKey`.

### 2. Settings UI — "Translation" section

- New `SettingsSectionId` `"translation"`, placed after "Sync & Timing", with
  catalog entries so it is searchable (keywords: llm, ollama, openai, ai, model,
  translate, api key).
- Profile list editor modelled on the Cobalt instance editor: add, edit, delete.
- "Add profile" offers two presets:
  - **Ollama** — `baseUrl` `http://localhost:11434/v1`, empty key.
  - **OpenAI-compatible** — blank fields.
- **Test connection** calls `GET {baseUrl}/models`. On success it fills a model
  dropdown (free text is still allowed). On failure it shows a classified error;
  for network/CORS failures on an Ollama-preset profile it explains setting
  `OLLAMA_ORIGINS` to include the current origin and restarting Ollama.
- Instructions textarea with "Reset to default".
- Note that API keys are stored locally in this browser.

### 3. Languages tab picker

A "Translate with" `Select` next to the source-language select, listing
"Google Translate" and each profile by label. It reads and writes the global
`translationProvider` setting. Transliteration always uses Google.

### 4. Provider interfaces

`src/services/language-provider.ts` splits the interface:

```ts
interface TranslationRequest {
  main: LanguageLineInput[];
  background: LanguageLineInput[];
  targetLanguage: string;
  sourceLanguage?: string;
  context: { title: string; artists: string[]; album: string };
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
  ): Promise<TransliterationBatchResult>; // unchanged
}
```

`googleLanguageProvider` implements both. Its `translate` runs its existing
per-line batches for `main` and `background` and ignores `context`. Its
behaviour does not change.

### 5. LLM translation engine (`src/services/llm/`)

**`openai-compatible-client.ts`**

- `chatJson({ baseUrl, apiKey, model, messages, signal }): Promise<string>`:
  POST `{baseUrl}/chat/completions` (trailing slashes normalised) with
  `response_format: { type: "json_object" }` and temperature 0.3. Sends
  `Authorization: Bearer <key>` only when `apiKey` is non-empty. Returns
  `choices[0].message.content`.
- `listModels({ baseUrl, apiKey, signal }): Promise<string[]>`: GET
  `{baseUrl}/models`, returns `data[].id`.
- Throws `LlmRequestError` with `kind`: `"network"` (fetch rejected, including
  CORS), `"auth"` (401/403), `"not-found"` (404), `"http"` (other non-OK, with
  status), `"bad-response"` (body missing the expected shape). An `AbortError`
  is re-thrown unchanged.

**`translation-prompt.ts`** (pure)

- `buildTranslationMessages({ items, contextItems, targetLanguage, sourceLanguage, context, instructions })`
  returns `[system, user]` messages.
- Keys: main line *n* (1-based, project order) → `"n"`; its background vocal →
  `"nb"`. Short keys save tokens and are easier for the model to track than
  UUIDs; the provider maps them back to line ids.
- The **system message** contains fixed rules the user cannot edit:
  - Translate song lyrics into the target language (named and BCP 47 tag).
  - Keep a strict 1:1 key correspondence. Never merge, split, reorder or skip
    lines.
  - Translate every part of mixed-language lines into the target language.
  - Keys ending in `b` are background vocals sung alongside the main line with
    the same number, so translate them in that context.
  - Respond with only
    `{"detectedLanguage": "<BCP 47 of the main source language>", "lines": {"<key>": "<translation>"}}`.
  - After the rules, a separate "Style instructions" block holds the profile's
    `instructions`.
- The **user message** contains song metadata (title, artists, album when
  present), the source language when not `auto`, then the lines to translate as
  a JSON object of key → source text. When chunking, it also contains the full
  song as a separate "context only — do not translate" block.
- `parseTranslationResponse(raw, expectedKeys)` returns
  `{ detectedLanguage, translations: Map<key, string> }`:
  - Accepts plain JSON, ```` ```json ```` fenced JSON, or JSON with surrounding
    prose (extracts the first balanced top-level `{...}`).
  - Ignores unknown keys. Drops empty strings and non-string values, which then
    count as missing.
  - Throws `bad-response` only if no JSON object can be parsed at all.
- `DEFAULT_TRANSLATION_INSTRUCTIONS`: natural, idiomatic phrasing that keeps the
  meaning and tone of the song rather than a literal translation; leave proper
  names untranslated; keep interjections and vocalisations (e.g. "oh", "la la")
  as they are.

**`llm-translation-provider.ts`**

`createLlmTranslationProvider(profile): TranslationProvider`. Its `translate`:

1. Builds keyed items from `main` and `background`, in project order.
2. Splits the items into consecutive chunks of `profile.maxLinesPerRequest`. A
   main line and its background are always kept in the same chunk.
3. For each chunk **in sequence**: calls `chatJson`, then parses the response.
   When there is more than one chunk, the full song goes in as read-only
   context.
4. Collects missing keys from all chunks and makes **one** retry request for
   them (full song as context, "translate only these keys"). If that retry
   fails at the request level, the keys stay missing rather than failing the
   whole batch.
5. Maps results back to `{ id, text }`:
   - A key that is still missing becomes `{ id, text: null, failed: true }`.
   - A translation equal to the source text (accent-insensitive
     `localeCompare`) becomes `text: null`, matching Google's behaviour.
6. `detectedLanguage` is the first non-empty value returned, otherwise `""`.

A request-level error from the first chunk request rejects the call, so the
view can show a specific toast. If a later chunk fails, its keys are marked
`failed` and the chunks that succeeded are kept.

No caching.

### 6. View integration (`src/views/languages.tsx`)

- `resolveTranslationProvider(settings): { provider: TranslationProvider; profile?: LlmProfile }`
  returns Google, or the LLM provider for the selected profile. If that profile
  id no longer exists, it falls back to Google.
- `generate()`:
  - Makes **one** `translate()` call per target language, passing `main`,
    `background` and `context` from `metadata`. `translationPairs` is built from
    `.main` and `.background`.
  - With an LLM provider, targets run in sequence. With Google they keep running
    in parallel.
  - Transliteration still calls `googleLanguageProvider.transliterate` directly.
  - `mergeGeneratedLanguageUpdates`, the edit guard, and the abort and stale-state
    checks are unchanged.
- Auto-generate on tab entry: if an LLM profile is selected but has no `model`,
  translation is skipped. A banner/toast says "Choose a model in Settings →
  Translation". Transliteration still runs.

### 7. Error handling

| Situation | Result |
| --- | --- |
| Some lines missing after retry | `failed: true` → existing "Couldn't generate some lines. Try Regenerate." toast |
| `network` | "Couldn't reach <label>. Is it running and does it allow this site's origin?" (Ollama profiles add the `OLLAMA_ORIGINS` hint) |
| `auth` | "<label> rejected the API key." |
| `not-found` | "Model "<model>" not found on <label>." |
| `bad-response` | "<label> returned unreadable output. Try Regenerate or another model." |
| `http` | "<label> returned <status>." |
| Abort | Silent, as now; the signal is passed through to `fetch`. |

Google output is never substituted when an LLM request fails.

### 8. Testing

All fixtures use placeholder text (`"line one"`, `"line two"`), never real
lyrics.

- `src/services/llm/translation-prompt.test.ts`
  - Key mapping, including background keys.
  - Metadata included or omitted.
  - Instructions placed in their own block.
  - Chunk context block.
  - Parsing: clean JSON, fenced JSON, prose-wrapped JSON, unknown keys, missing
    keys, empty values, non-string values, unparseable output.
- `src/services/llm/openai-compatible-client.test.ts` (mocked `fetch`)
  - URL joining.
  - Auth header only when a key is set.
  - `response_format` present.
  - Error classification for each `kind`.
  - Abort passthrough.
- `src/services/llm/llm-translation-provider.test.ts`
  - Single retry for gaps; `failed` after the retry.
  - Chunk order is sequential, and main/background pairs are never split
    across chunks.
  - Same-as-source becomes `null`.
  - A failure in a later chunk marks only its keys.
  - Abort.
- `src/services/google-language-provider.test.ts`: updated for the new request
  and response shape; behaviour unchanged.
- Settings: migration defaults; removing the selected profile resets to
  `"google"`; catalog test covers the new section and entries; `apiKey`
  excluded from any export path.
- Browser tests:
  - The Languages view sends one `translate` per target with main and
    background together.
  - The picker lists profiles and persists the selection.
  - Auto-generate skips translation when no model is set.
  - The profile editor's Test connection fills the model list.

## Files

New:

- `src/services/llm/openai-compatible-client.ts` (+ test)
- `src/services/llm/translation-prompt.ts` (+ test)
- `src/services/llm/llm-translation-provider.ts` (+ test)
- `src/services/resolve-translation-provider.ts`
- Translation settings section component under `src/ui/settings/`

Modified:

- `src/services/language-provider.ts`
- `src/services/google-language-provider.ts` (+ test)
- `src/views/languages.tsx` (+ browser tests)
- `src/stores/settings.ts` (+ migration test)
- `src/stores/settings-catalog.ts`, `src/stores/settings-catalog-entries.ts` (+ test)
- Settings modal section rendering
