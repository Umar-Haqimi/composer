# Sync Undo & Bracketed Line Rewind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rebindable `R` shortcut in the Sync tab that clears the current (or last timed) line and rewinds playback, and auto-rewind to the anchor main line when sync advances onto a bracketed `( … )` background-vocal line.

**Architecture:** Pure logic (target-line lookup, bracket detection, anchor lookup, overlap rule) lives in a new domain module `src/domain/sync/rewind.ts` plus one predicate in `src/domain/line/predicates.ts`. `commitGesture` gains an `overlapsPrevious` context flag so a tap on a bracketed line is allowed to land *before* the previous line's last word without being snapped or trimming it. `useSyncHandlers` wires the domain functions to the audio and project stores; `sync-panel.tsx` binds the new shortcut.

**Tech Stack:** React 19, Zustand (persist), Vitest (unit project `*.test.ts`, browser project `*.browser.test.tsx` via `vitest-browser-react`), Biome, TypeScript.

Spec: `docs/superpowers/specs/2026-10-10-sync-undo-and-bracket-rewind-design.md`

## Global Constraints

- New settings and defaults (verbatim from spec): `undoRewindDuration: 3.0`, `undoContinuePlayback: true`, `autoRewindForBracketedLines: true`.
- Undo Rewind Duration control: slider `0.5`s to `10.0`s, step `0.5`s.
- Shortcut: `id: "sync.undoAndRewind"`, `scope: "sync"`, `description: "Undo line sync and rewind"`, `defaultBinding: { key: "r" }`.
- Toast: `toast("Line sync undone", { id: "sync-undo-line" })`.
- Bracket rewind seek: `Math.max(0, anchorTime - redoPreroll)`; undo seek: `Math.max(0, firstSyncTime - undoRewindDuration)`.
- All timing writes go through `updateLinesWithHistory(..., { deriveText: false, propagateToSiblings: false })` so Ctrl/Cmd+Z stays consistent.
- `src/domain/**` must not import from `stores/`, `views/`, `hooks/`, `pages/`, `ui/`, `audio/` (enforced by `src/test/domain-isolation.test.ts`).
- New non-test source files must stay under 300 lines (`src/test/file-size-budget.test.ts`). `useSyncHandlers.ts` and `sync-panel.tsx` are already baselined; keep additions to them thin.
- No regex literals for bracket detection (use `startsWith`/`endsWith`; `src/test/one-concept-one-regex.test.ts`).
- Settings copy: unique labels, descriptions end with a period, no en/em dashes, no curly quotes.
- File section headers follow the existing `// -- Name ----…` style; exports collected at the bottom under `// -- Exports`.

## Deviations from the spec (decided while planning, flag to the user)

1. **"Has timing" uses `mainBounds(line)` instead of `hasAnyTiming(line)`.** The Sync panel seeds `backgroundWords` onto every line that has `backgroundText` (`withSeededBackgroundWords`), so `hasAnyTiming` would report never-synced lines as timed. `mainBounds(line)?.begin` equals the spec's `line.words?.[0]?.begin ?? line.begin` for every state a gesture can produce.
2. **New `overlapsPrevious` gesture flag (spec gap).** After a rewind, the first tap on the bracketed line happens *earlier* than the main line's last word. Today `anchorBefore` would snap that tap forward ("Early tap snapped") and the cross-line close would trim the main line's last word. With the flag set, a cross-line previous slot is ignored: no floor, no close. The flag is on when `autoRewindForBracketedLines` is enabled and either the cursor line or the previous syncable line is bracketed (the latter so a main line following a trailing echo is not snapped either). Consequence: the main line's last word keeps its provisional `defaultWordDuration` end; the user can nudge it.
3. **`hold-tap` does not trigger the bracket rewind.** A hold-tap that crosses into a bracketed line immediately opens the bracketed line's first word at the current time; rewinding underneath an open, held word would produce a word that ends before it begins. `tap-word`, `tap-line` and `hold-end` trigger it as specified.
4. **No persist version bump.** Zustand's `persist` shallow-merges stored state over `DEFAULTS`, so keys missing from an old blob already get defaults (same as `syllablesFollowRolling`). Task 1 adds tests proving it instead of a migration branch.
5. **Undo shortcut is ignored in edit mode and while holding**, matching how the tap/hold shortcuts are gated.

## File Map

| File | Change | Responsibility |
|---|---|---|
| `src/stores/settings.ts` | Modify | 3 new settings + defaults |
| `src/stores/settings-catalog-entries.ts` | Modify | 3 catalog entries (sync section) |
| `src/ui/settings/setting-controls-registry.tsx` | Modify | Controls for the 3 entries |
| `src/stores/settings.migration.test.ts` | Modify | Old blobs get new defaults |
| `src/stores/shortcut-definitions.ts` | Modify | `sync.undoAndRewind` |
| `src/stores/shortcut-definitions.test.ts` | Modify | Registry test |
| `src/ui/shortcut-reference.tsx` | Modify | List shortcut in reference dialog |
| `src/domain/line/predicates.ts` (+ `.test.ts`) | Modify | `isBracketedLine` |
| `src/domain/sync/rewind.ts` (+ `.test.ts`) | Create | `findUndoTarget`, `bracketAnchorLineIndex`, `overlapsPreviousLine`, `bracketRewindTime` |
| `src/domain/sync/commit-gesture.ts` (+ `.test.ts`) | Modify | `overlapsPrevious` flag; export `applyUpdates` |
| `src/hooks/useSyncHandlers.ts` (+ `.browser.test.tsx`) | Modify | `handleUndoAndRewindLine`; bracket rewind in `runGesture` |
| `src/views/sync/sync-panel.tsx` (+ `.browser.test.tsx`) | Modify | Bind shortcut |

---

### Task 1: Settings, catalog entries and controls

**Files:**
- Modify: `src/stores/settings.ts` (interface ~line 55, `DEFAULTS` ~line 127)
- Modify: `src/stores/settings-catalog-entries.ts` (after the `redoPreroll` entry, ~line 191)
- Modify: `src/ui/settings/setting-controls-registry.tsx` (after `redoPreroll`, ~line 87)
- Test: `src/stores/settings.migration.test.ts`

**Interfaces:**
- Produces: `SettingsState.undoRewindDuration: number`, `SettingsState.undoContinuePlayback: boolean`, `SettingsState.autoRewindForBracketedLines: boolean`, read in Task 4 via `useSettingsStore.getState()`.

- [ ] **Step 1: Write the failing tests**

Append to `src/stores/settings.migration.test.ts`:

```ts
describe("sync undo and bracket rewind settings", () => {
  it("gives a saved blob from before the settings existed the defaults", async () => {
    const {
      undoRewindDuration: _a,
      undoContinuePlayback: _b,
      autoRewindForBracketedLines: _c,
      ...withoutKeys
    } = legacyBlob();
    await rehydrateAt(6, withoutKeys);
    const state = useSettingsStore.getState();
    expect(state.undoRewindDuration).toBe(3);
    expect(state.undoContinuePlayback).toBe(true);
    expect(state.autoRewindForBracketedLines).toBe(true);
  });

  it("keeps saved choices across a rehydrate", async () => {
    await rehydrateAt(
      6,
      legacyBlob({ undoRewindDuration: 5.5, undoContinuePlayback: false, autoRewindForBracketedLines: false }),
    );
    const state = useSettingsStore.getState();
    expect(state.undoRewindDuration).toBe(5.5);
    expect(state.undoContinuePlayback).toBe(false);
    expect(state.autoRewindForBracketedLines).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/stores/settings.migration.test.ts`
Expected: FAIL (type errors / `undefined` for the new keys).

- [ ] **Step 3: Add the settings**

In `src/stores/settings.ts`, in `SettingsState` directly after `redoPreroll: number;`:

```ts
  undoRewindDuration: number;
  undoContinuePlayback: boolean;
  autoRewindForBracketedLines: boolean;
```

In `DEFAULTS` directly after `redoPreroll: 1.5,`:

```ts
  undoRewindDuration: 3,
  undoContinuePlayback: true,
  autoRewindForBracketedLines: true,
```

In `src/stores/settings-catalog-entries.ts`, directly after the `redoPreroll` entry (keeps the sync section contiguous, which `settings-catalog.test.ts` checks):

```ts
  undoRewindDuration: {
    section: "sync",
    label: "Undo rewind duration",
    description: "How far before the undone line playback jumps back when you undo a line in Sync.",
    keywords: ["undo", "rewind", "back", "r"],
    settingKey: "undoRewindDuration",
  },
  undoContinuePlayback: {
    section: "sync",
    label: "Continue playback on undo",
    description: "Keep the audio playing after undoing a line. Turn off to pause instead.",
    keywords: ["undo", "pause", "play"],
    settingKey: "undoContinuePlayback",
  },
  autoRewindForBracketedLines: {
    section: "sync",
    label: "Auto-rewind for bracketed lines",
    description:
      "When the next line is a bracketed background vocal, jump back to the start of the main line it overlaps so you can sync it.",
    keywords: ["background", "vocals", "brackets", "parentheses", "overlap", "rewind"],
    settingKey: "autoRewindForBracketedLines",
  },
```

In `src/ui/settings/setting-controls-registry.tsx`, directly after the `redoPreroll` line:

```ts
  undoRewindDuration: { kind: "slider", min: 0.5, max: 10, step: 0.5, format: (v) => `${v.toFixed(1)}s` },
  undoContinuePlayback: TOGGLE,
  autoRewindForBracketedLines: TOGGLE,
```

- [ ] **Step 4: Run the settings tests**

Run: `pnpm vitest run src/stores/settings.migration.test.ts src/stores/settings-catalog.test.ts src/stores/settings.test.ts`
Expected: PASS. Then `pnpm typecheck` → no errors (the `Record<SettingId, SettingControl>` type forces the registry entries).

- [ ] **Step 5: Commit**

```bash
git add src/stores/settings.ts src/stores/settings-catalog-entries.ts src/ui/settings/setting-controls-registry.tsx src/stores/settings.migration.test.ts
git commit -m "feat(settings): add undo rewind and bracket auto-rewind settings"
```

---

### Task 2: Shortcut registration

**Files:**
- Modify: `src/stores/shortcut-definitions.ts` (after `sync.toggleTextVariant`, ~line 120)
- Modify: `src/ui/shortcut-reference.tsx` (sync section, ~line 47)
- Test: `src/stores/shortcut-definitions.test.ts`

**Interfaces:**
- Produces: shortcut id `"sync.undoAndRewind"`, matched in Task 5 via `findMatchingShortcut(e, "sync")`.

- [ ] **Step 1: Write the failing test**

Add inside `describe("SHORTCUT_DEFINITIONS", …)` in `src/stores/shortcut-definitions.test.ts`:

```ts
  it("registers the undo-line-and-rewind shortcut with default key 'r' in the sync scope", () => {
    const undo = SHORTCUT_DEFINITIONS.find((d) => d.id === "sync.undoAndRewind");

    expect(undo).toBeDefined();
    expect(undo?.scope).toBe("sync");
    expect(undo?.description).toBe("Undo line sync and rewind");
    expect(undo?.defaultBinding).toEqual({ key: "r" });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/stores/shortcut-definitions.test.ts`
Expected: FAIL, `undo` is undefined.

- [ ] **Step 3: Register the shortcut**

In `src/stores/shortcut-definitions.ts`, after the `sync.toggleTextVariant` entry:

```ts
  {
    id: "sync.undoAndRewind",
    scope: "sync",
    description: "Undo line sync and rewind",
    defaultBinding: { key: "r" },
  },
```

In `src/ui/shortcut-reference.tsx`, after the `sync.nudgeRight` row:

```ts
      { keys: ["R"], description: "Undo line sync and rewind", shortcutId: "sync.undoAndRewind" },
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/stores/shortcut-definitions.test.ts src/stores/shortcut-bindings.test.ts`
Expected: PASS (`r` is also `timeline.toggleRollingEdit`, but that is the timeline scope, same as `f` already shared by `sync.holdSync`/`timeline.toggleFollow`).

- [ ] **Step 5: Commit**

```bash
git add src/stores/shortcut-definitions.ts src/stores/shortcut-definitions.test.ts src/ui/shortcut-reference.tsx
git commit -m "feat(shortcuts): register sync.undoAndRewind (R)"
```

---

### Task 3: Domain logic (bracket predicate, rewind helpers, overlap flag)

**Files:**
- Modify: `src/domain/line/predicates.ts`, `src/domain/line/predicates.test.ts`
- Create: `src/domain/sync/rewind.ts`, `src/domain/sync/rewind.test.ts`
- Modify: `src/domain/sync/commit-gesture.ts`, `src/domain/sync/commit-gesture.test.ts`

**Interfaces:**
- Produces:
  - `isBracketedLine(line: LyricLine | undefined): boolean` from `@/domain/line/predicates`
  - `findUndoTarget(lines: readonly LyricLine[], cursor: SyncCursor): { lineIndex: number; begin: number } | null` from `@/domain/sync/rewind`
  - `bracketAnchorLineIndex(lines: readonly LyricLine[], fromIndex: number): number` (`-1` when none)
  - `overlapsPreviousLine(lines: readonly LyricLine[], lineIndex: number): boolean`
  - `bracketRewindTime(lines: readonly LyricLine[], from: SyncCursor, commit: GestureCommit, preroll: number): number | null`
  - `GestureContext.overlapsPrevious?: boolean` on `commitGesture`
  - `applyUpdates(lines, updates): LyricLine[]` newly exported from `@/domain/sync/commit-gesture`

- [ ] **Step 1: Write the failing predicate test**

Add `isBracketedLine` to the existing import from `@/domain/line/predicates` in `src/domain/line/predicates.test.ts` (and `createLine` from `@/test/factories` if not already imported), then append:

```ts
describe("isBracketedLine", () => {
  it.each([
    ["(vocal)", true],
    ["( vocal )", true],
    ["  (ooh, ah)  ", true],
    ["normal line", false],
    ["(incomplete", false],
    ["incomplete)", false],
    ["()", true],
    ["(", false],
    ["", false],
  ])("%j -> %s", (text, expected) => {
    expect(isBracketedLine(createLine({ text }))).toBe(expected);
  });

  it("is false for a missing line", () => {
    expect(isBracketedLine(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/domain/line/predicates.test.ts`
Expected: FAIL, `isBracketedLine` is not exported.

- [ ] **Step 3: Implement `isBracketedLine`**

In `src/domain/line/predicates.ts`, after `hasMainLyrics`:

```ts
// A whole line wrapped in parentheses is a background vocal that overlaps the main line before it.
function isBracketedLine(line: LyricLine | undefined): boolean {
  if (!line) return false;
  const text = line.text.trim();
  return text.length >= 2 && text.startsWith("(") && text.endsWith(")");
}
```

Add `isBracketedLine` to the file's export list.

- [ ] **Step 4: Run predicate tests**

Run: `pnpm vitest run src/domain/line/predicates.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `commitGesture` overlap tests**

In `src/domain/sync/commit-gesture.test.ts`, change the `run` helper to accept the flag:

```ts
function run(
  lines: LyricLine[],
  gesture: SyncGesture,
  cursor: [number, number],
  time: number,
  jumped = false,
  overlapsPrevious = false,
) {
  return commitGesture(lines, gesture, {
    cursor: { lineIndex: cursor[0], wordIndex: cursor[1] },
    jumped,
    time,
    defaultWordDuration: DUR,
    overlapsPrevious,
  });
}
```

Append:

```ts
describe("overlapsPrevious", () => {
  const main = () =>
    createLine({ id: "l0", text: "Hello world", words: [word("Hello ", 2, 2.5), word("world", 3, 3.3)] });
  const bg = () => createLine({ id: "l1", text: "(ooh ah)" });

  it("baseline: without the flag an overlapping tap snaps to the previous word and closes it", () => {
    const commit = run([main(), bg()], "tap-word", [1, 0], 1);
    expect(commit?.clampedTo).toBe(3);
  });

  it("lets the first word of an overlapping line land before the previous line's last word", () => {
    const lines = [main(), bg()];
    const commit = run(lines, "tap-word", [1, 0], 1, false, true);
    expect(commit?.clampedTo).toBeNull();
    const next = apply(lines, commit);
    expect(next[1].words?.[0]).toMatchObject({ begin: 1, end: 1 + DUR });
  });

  it("leaves the previous line untouched", () => {
    const lines = [main(), bg()];
    const next = apply(lines, run(lines, "tap-word", [1, 0], 1, false, true));
    expect(next[0].words).toEqual(lines[0].words);
  });

  it("still orders words within the overlapping line", () => {
    const lines = [main(), createLine({ id: "l1", text: "(ooh ah)", words: [word("(ooh ", 1, 1.3)] })];
    const commit = run(lines, "tap-word", [1, 1], 0.5, false, true);
    expect(commit?.clampedTo).toBe(1);
  });

  it("applies to line granularity", () => {
    const lines = [createLine({ id: "l0", text: "Hello world", begin: 2, end: 4 }), bg()];
    const commit = run(lines, "tap-line", [1, 0], 1, false, true);
    expect(commit?.clampedTo).toBeNull();
    const next = apply(lines, commit);
    expect(next[1].begin).toBe(1);
    expect(next[0]).toMatchObject({ begin: 2, end: 4 });
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm vitest run src/domain/sync/commit-gesture.test.ts`
Expected: the four flag tests FAIL (type error on `overlapsPrevious`, then clamping to 3); the baseline test passes.

- [ ] **Step 7: Implement the flag**

In `src/domain/sync/commit-gesture.ts`:

Extend `GestureContext`:

```ts
interface GestureContext {
  cursor: SyncCursor;
  jumped: boolean;
  time: number;
  defaultWordDuration: number;
  // The cursor line is sung over the line before it, so that line neither floors nor gets closed by this tap.
  overlapsPrevious?: boolean;
}
```

In `anchorBefore`, right after `if (!previous) return { slot: null, floor: 0 };`:

```ts
  if (ctx.overlapsPrevious && previous.lineIndex !== ctx.cursor.lineIndex) return { slot: null, floor: 0 };
```

Change the export line to:

```ts
export { applyUpdates, commitGesture };
```

- [ ] **Step 8: Run gesture tests**

Run: `pnpm vitest run src/domain/sync/commit-gesture.test.ts`
Expected: PASS (all existing tests unchanged since the flag defaults to off).

- [ ] **Step 9: Write the failing `rewind` tests**

Create `src/domain/sync/rewind.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LyricLine } from "@/domain/line/model";
import type { GestureCommit } from "@/domain/sync/commit-gesture";
import {
  bracketAnchorLineIndex,
  bracketRewindTime,
  findUndoTarget,
  overlapsPreviousLine,
} from "@/domain/sync/rewind";
import { createLine } from "@/test/factories";

const word = (text: string, begin: number, end: number) => ({ text, begin, end });
const timed = (id: string, text: string, begin: number) =>
  createLine({ id, text, words: [word(`${text} `, begin, begin + 0.5)] });
const untimed = (id: string, text: string) => createLine({ id, text });
const blank = (id: string) => createLine({ id, text: "" });

function commitTo(lineIndex: number, lineUpdates: GestureCommit["lineUpdates"] = []): GestureCommit {
  return { lineUpdates, nextCursor: { lineIndex, wordIndex: 0 }, nextJumped: false, clampedTo: null };
}

describe("findUndoTarget", () => {
  it("targets the cursor line when it has timing", () => {
    const lines = [timed("a", "one", 1), timed("b", "two", 5)];
    expect(findUndoTarget(lines, { lineIndex: 1, wordIndex: 1 })).toEqual({ lineIndex: 1, begin: 5 });
  });

  it("falls back to the most recent timed line when the cursor line is untimed", () => {
    const lines = [timed("a", "one", 1), timed("b", "two", 5), blank("c"), untimed("d", "four")];
    expect(findUndoTarget(lines, { lineIndex: 3, wordIndex: 0 })).toEqual({ lineIndex: 1, begin: 5 });
  });

  it("works from a cursor past the end of the song", () => {
    const lines = [timed("a", "one", 1), timed("b", "two", 5)];
    expect(findUndoTarget(lines, { lineIndex: 2, wordIndex: 0 })).toEqual({ lineIndex: 1, begin: 5 });
  });

  it("uses line timing in line granularity", () => {
    const lines = [createLine({ id: "a", text: "one", begin: 4, end: 6 })];
    expect(findUndoTarget(lines, { lineIndex: 0, wordIndex: 0 })).toEqual({ lineIndex: 0, begin: 4 });
  });

  it("ignores seeded background words on an otherwise untimed line", () => {
    const lines = [
      timed("a", "one", 1),
      createLine({ id: "b", text: "two", backgroundText: "ooh", backgroundWords: [word("ooh", 9, 9.5)] }),
    ];
    expect(findUndoTarget(lines, { lineIndex: 1, wordIndex: 0 })).toEqual({ lineIndex: 0, begin: 1 });
  });

  it("returns null when nothing is timed", () => {
    expect(findUndoTarget([untimed("a", "one")], { lineIndex: 0, wordIndex: 0 })).toBeNull();
    expect(findUndoTarget([], { lineIndex: 0, wordIndex: 0 })).toBeNull();
  });
});

describe("bracketAnchorLineIndex", () => {
  it("finds the main line right before a single bracketed line", () => {
    const lines = [timed("a", "main", 2), untimed("b", "(bg)")];
    expect(bracketAnchorLineIndex(lines, 1)).toBe(0);
  });

  it("skips earlier bracketed lines to reach the main line", () => {
    const lines = [timed("a", "main", 2), timed("b", "(bg one)", 2.2), untimed("c", "(bg two)")];
    expect(bracketAnchorLineIndex(lines, 2)).toBe(0);
  });

  it("skips untimed lines", () => {
    const lines = [timed("a", "main", 2), untimed("b", "later"), untimed("c", "(bg)")];
    expect(bracketAnchorLineIndex(lines, 2)).toBe(0);
  });

  it("returns -1 when no timed main line precedes", () => {
    expect(bracketAnchorLineIndex([untimed("a", "(bg)")], 0)).toBe(-1);
  });
});

describe("overlapsPreviousLine", () => {
  const lines = [timed("a", "main", 2), untimed("b", "(bg)"), blank("c"), untimed("d", "next main")];

  it("is true on a bracketed line", () => {
    expect(overlapsPreviousLine(lines, 1)).toBe(true);
  });

  it("is true on a main line whose previous syncable line is bracketed", () => {
    expect(overlapsPreviousLine(lines, 3)).toBe(true);
  });

  it("is false on an ordinary main line", () => {
    expect(overlapsPreviousLine(lines, 0)).toBe(false);
    expect(overlapsPreviousLine([timed("a", "x", 1), untimed("b", "y")], 1)).toBe(false);
  });

  it("is false past the end", () => {
    expect(overlapsPreviousLine(lines, 4)).toBe(false);
  });
});

describe("bracketRewindTime", () => {
  const from = { lineIndex: 0, wordIndex: 1 };

  it("rewinds to the anchor start minus the preroll when advancing onto a bracketed line", () => {
    const lines = [timed("a", "main", 4), untimed("b", "(bg)")];
    expect(bracketRewindTime(lines, from, commitTo(1), 1.5)).toBe(2.5);
  });

  it("clamps at zero", () => {
    const lines = [timed("a", "main", 0.5), untimed("b", "(bg)")];
    expect(bracketRewindTime(lines, from, commitTo(1), 1.5)).toBe(0);
  });

  it("sees timing written by the same commit", () => {
    const lines: LyricLine[] = [untimed("a", "main"), untimed("b", "(bg)")];
    const commit = commitTo(1, [{ id: "a", updates: { begin: 6, end: 6 } }]);
    expect(bracketRewindTime(lines, { lineIndex: 0, wordIndex: 0 }, commit, 1)).toBe(5);
  });

  it("does nothing when the next line is not bracketed", () => {
    const lines = [timed("a", "main", 4), untimed("b", "next")];
    expect(bracketRewindTime(lines, from, commitTo(1), 1.5)).toBeNull();
  });

  it("does nothing when the cursor stayed on the same line", () => {
    const lines = [timed("a", "main", 4), untimed("b", "(bg)")];
    expect(bracketRewindTime(lines, from, { ...commitTo(0), nextCursor: { lineIndex: 0, wordIndex: 2 } }, 1.5)).toBeNull();
  });

  it("does nothing when a bracketed first line has no anchor", () => {
    const lines = [untimed("a", "(bg)"), untimed("b", "(bg two)")];
    expect(bracketRewindTime(lines, { lineIndex: 0, wordIndex: 0 }, commitTo(1), 1.5)).toBeNull();
  });

  it("rewinds to the same main line across consecutive bracketed lines, then stops", () => {
    const lines = [timed("a", "main", 4), timed("b", "(bg one)", 4.2), untimed("c", "(bg two)"), untimed("d", "main two")];
    expect(bracketRewindTime(lines, { lineIndex: 1, wordIndex: 0 }, commitTo(2), 1)).toBe(3);
    expect(bracketRewindTime(lines, { lineIndex: 2, wordIndex: 0 }, commitTo(3), 1)).toBeNull();
  });
});
```

- [ ] **Step 10: Run to verify failure**

Run: `pnpm vitest run src/domain/sync/rewind.test.ts`
Expected: FAIL, module `@/domain/sync/rewind` not found.

- [ ] **Step 11: Implement `src/domain/sync/rewind.ts`**

```ts
import { mainBounds } from "@/domain/line/bounds";
import type { LyricLine } from "@/domain/line/model";
import { isBracketedLine } from "@/domain/line/predicates";
import { isSyncableLine } from "@/domain/line/sync-progress";
import { applyUpdates, type GestureCommit } from "@/domain/sync/commit-gesture";
import { prevSyncableLineIndex, type SyncCursor } from "@/domain/sync/cursor";

// -- Types --------------------------------------------------------------------

interface UndoTarget {
  lineIndex: number;
  begin: number;
}

// -- Undo ---------------------------------------------------------------------

// Main timing only: the Sync view seeds background words onto untimed lines, so they say nothing about progress.
function mainBegin(line: LyricLine | undefined): number | undefined {
  return line ? mainBounds(line)?.begin : undefined;
}

function findUndoTarget(lines: readonly LyricLine[], cursor: SyncCursor): UndoTarget | null {
  const current = mainBegin(lines[cursor.lineIndex]);
  if (current !== undefined) return { lineIndex: cursor.lineIndex, begin: current };
  for (let i = prevSyncableLineIndex(lines, cursor.lineIndex); i >= 0; i = prevSyncableLineIndex(lines, i)) {
    const begin = mainBegin(lines[i]);
    if (begin !== undefined) return { lineIndex: i, begin };
  }
  return null;
}

// -- Bracketed lines ----------------------------------------------------------

function bracketAnchorLineIndex(lines: readonly LyricLine[], fromIndex: number): number {
  for (let i = Math.min(fromIndex, lines.length) - 1; i >= 0; i--) {
    if (!isBracketedLine(lines[i]) && mainBegin(lines[i]) !== undefined) return i;
  }
  return -1;
}

function overlapsPreviousLine(lines: readonly LyricLine[], lineIndex: number): boolean {
  const line = lines[lineIndex];
  if (!isSyncableLine(line)) return false;
  if (isBracketedLine(line)) return true;
  const prev = prevSyncableLineIndex(lines, lineIndex);
  return prev >= 0 && isBracketedLine(lines[prev]);
}

function bracketRewindTime(
  lines: readonly LyricLine[],
  from: SyncCursor,
  commit: GestureCommit,
  preroll: number,
): number | null {
  const next = commit.nextCursor.lineIndex;
  if (next <= from.lineIndex || !isBracketedLine(lines[next])) return null;
  const updated = applyUpdates(lines, commit.lineUpdates);
  const begin = mainBegin(updated[bracketAnchorLineIndex(updated, next)]);
  return begin === undefined ? null : Math.max(0, begin - preroll);
}

// -- Exports ------------------------------------------------------------------

export { bracketAnchorLineIndex, bracketRewindTime, findUndoTarget, overlapsPreviousLine };
export type { UndoTarget };
```

Note: `prevSyncableLineIndex(lines, i)` already starts at `min(i, length) - 1`, so the loop works for a cursor past the end. `updated[-1]` is `undefined`, which `mainBegin` handles.

- [ ] **Step 12: Run the domain tests and guards**

Run: `pnpm vitest run src/domain src/test/domain-isolation.test.ts src/test/one-concept-one-regex.test.ts src/test/file-size-budget.test.ts`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/domain/line/predicates.ts src/domain/line/predicates.test.ts src/domain/sync/rewind.ts src/domain/sync/rewind.test.ts src/domain/sync/commit-gesture.ts src/domain/sync/commit-gesture.test.ts
git commit -m "feat(sync): domain helpers for line undo and bracketed-line rewind"
```

---

### Task 4: Hook wiring (`useSyncHandlers`)

**Files:**
- Modify: `src/hooks/useSyncHandlers.ts`
- Test: `src/hooks/useSyncHandlers.browser.test.tsx`

**Interfaces:**
- Consumes: `findUndoTarget`, `overlapsPreviousLine`, `bracketRewindTime` from `@/domain/sync/rewind`; settings from Task 1.
- Produces: `handleUndoAndRewindLine: () => void` on the hook's return value (used by Task 5).

- [ ] **Step 1: Write the failing hook tests**

Append to `src/hooks/useSyncHandlers.browser.test.tsx` (helpers `mountSyncHandlers`, `createLine`, `createWord`, `useAudioStore`, `useSettingsStore`, `useProjectStore` are already imported there; stores are reset between tests by `src/test/stores.ts`):

```ts
describe("useSyncHandlers.handleUndoAndRewindLine", () => {
  const lineA = () =>
    createLine({
      id: "l0",
      text: "Hello world",
      words: [createWord({ text: "Hello ", begin: 4, end: 4.5 }), createWord({ text: "world", begin: 4.5, end: 5 })],
    });
  const partialB = () =>
    createLine({ id: "l1", text: "Second line", words: [createWord({ text: "Second ", begin: 8, end: 8.4 })] });

  it("clears the cursor line when it has timing and rewinds before its first word", async () => {
    useProjectStore.getState().setLines([lineA(), partialB()]);
    const { result, act, getSyncState, playingCalls } = await mountSyncHandlers({
      initialSyncState: { position: { lineIndex: 1, wordIndex: 1 }, isActive: true },
    });

    await act(() => result.current.handleUndoAndRewindLine());

    expect(useProjectStore.getState().lines[1].words).toBeUndefined();
    expect(useProjectStore.getState().lines[0].words).toHaveLength(2);
    expect(getSyncState()).toMatchObject({
      position: { lineIndex: 1, wordIndex: 0 },
      jumpedToPosition: true,
      isActive: true,
    });
    expect(useAudioStore.getState().currentTime).toBe(8 - 3);
    expect(playingCalls.at(-1)).toBe(true);
  });

  it("falls back to the previous timed line when the cursor line is untimed", async () => {
    useProjectStore.getState().setLines([lineA(), createLine({ id: "l1", text: "Second line" })]);
    const { result, act, getSyncState } = await mountSyncHandlers({
      initialSyncState: { position: { lineIndex: 1, wordIndex: 0 }, isActive: true },
    });

    await act(() => result.current.handleUndoAndRewindLine());

    expect(useProjectStore.getState().lines[0].words).toBeUndefined();
    expect(getSyncState().position).toEqual({ lineIndex: 0, wordIndex: 0 });
    expect(useAudioStore.getState().currentTime).toBe(1);
  });

  it("uses the configured rewind duration and clamps at zero", async () => {
    useSettingsStore.setState({ undoRewindDuration: 10 });
    useProjectStore.getState().setLines([lineA()]);
    const { result, act } = await mountSyncHandlers({
      initialSyncState: { position: { lineIndex: 0, wordIndex: 2 }, isActive: true },
    });

    await act(() => result.current.handleUndoAndRewindLine());

    expect(useAudioStore.getState().currentTime).toBe(0);
  });

  it("pauses when continue-playback is off", async () => {
    useSettingsStore.setState({ undoContinuePlayback: false });
    useProjectStore.getState().setLines([lineA()]);
    const { result, act, playingCalls } = await mountSyncHandlers({
      initialSyncState: { position: { lineIndex: 0, wordIndex: 2 }, isActive: true },
    });

    await act(() => result.current.handleUndoAndRewindLine());

    expect(playingCalls).toEqual([false]);
  });

  it("is a no-op when nothing has been synced", async () => {
    useProjectStore.getState().setLines([createLine({ id: "l0", text: "Hello world" })]);
    useAudioStore.setState({ currentTime: 7 });
    const { result, act, getSyncState, playingCalls } = await mountSyncHandlers();
    const before = getSyncState();

    await act(() => result.current.handleUndoAndRewindLine());

    expect(getSyncState()).toBe(before);
    expect(useAudioStore.getState().currentTime).toBe(7);
    expect(playingCalls).toEqual([]);
  });

  it("invariant: project undo restores the cleared line", async () => {
    useProjectStore.getState().setLines([lineA()]);
    const { result, act } = await mountSyncHandlers({
      initialSyncState: { position: { lineIndex: 0, wordIndex: 2 }, isActive: true },
    });

    await act(() => result.current.handleUndoAndRewindLine());
    useProjectStore.getState().undo();

    expect(useProjectStore.getState().lines[0].words).toHaveLength(2);
  });
});

describe("useSyncHandlers bracketed-line auto-rewind", () => {
  const mainLine = () =>
    createLine({ id: "l0", text: "Hello world", words: [createWord({ text: "Hello ", begin: 4, end: 4.5 })] });
  const bgLine = () => createLine({ id: "l1", text: "(ooh ah)" });

  it("rewinds to the main line's start minus the pre-roll when sync advances onto a bracketed line", async () => {
    useProjectStore.getState().setLines([mainLine(), bgLine()]);
    const { result, act, getSyncState, playingCalls } = await mountSyncHandlers({
      initialSyncState: { position: { lineIndex: 0, wordIndex: 1 }, isActive: true },
      initialCurrentTime: 5,
    });

    await act(() => result.current.handleTap());

    expect(getSyncState().position).toEqual({ lineIndex: 1, wordIndex: 0 });
    expect(useAudioStore.getState().currentTime).toBe(4 - DEFAULTS.redoPreroll);
    expect(playingCalls.at(-1)).toBe(true);
  });

  it("lets the bracketed line's first tap land inside the main line without snapping or trimming it", async () => {
    useProjectStore.getState().setLines([mainLine(), bgLine()]);
    const { result, rerender, act, getSyncState } = await mountSyncHandlers({
      initialSyncState: { position: { lineIndex: 0, wordIndex: 1 }, isActive: true },
      initialCurrentTime: 5,
    });

    await act(() => result.current.handleTap());
    const mainAfterFirstTap = useProjectStore.getState().lines[0].words;
    await rerender({ syncState: getSyncState(), currentTime: 4.2 });
    await act(() => result.current.handleTap());

    expect(useProjectStore.getState().lines[1].words?.[0].begin).toBe(4.2);
    expect(useProjectStore.getState().lines[0].words).toEqual(mainAfterFirstTap);
  });

  it("does not rewind when the setting is off", async () => {
    useSettingsStore.setState({ autoRewindForBracketedLines: false });
    useProjectStore.getState().setLines([mainLine(), bgLine()]);
    useAudioStore.setState({ currentTime: 5 });
    const { result, act, playingCalls } = await mountSyncHandlers({
      initialSyncState: { position: { lineIndex: 0, wordIndex: 1 }, isActive: true },
      initialCurrentTime: 5,
    });

    await act(() => result.current.handleTap());

    expect(useAudioStore.getState().currentTime).toBe(5);
    expect(playingCalls).toEqual([]);
  });

  it("does not rewind when the next line is not bracketed", async () => {
    useProjectStore.getState().setLines([mainLine(), createLine({ id: "l1", text: "Next main" })]);
    useAudioStore.setState({ currentTime: 5 });
    const { result, act } = await mountSyncHandlers({
      initialSyncState: { position: { lineIndex: 0, wordIndex: 1 }, isActive: true },
      initialCurrentTime: 5,
    });

    await act(() => result.current.handleTap());

    expect(useAudioStore.getState().currentTime).toBe(5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project browser src/hooks/useSyncHandlers.browser.test.tsx`
Expected: new tests FAIL (`handleUndoAndRewindLine` is not a function; no rewind on tap).

- [ ] **Step 3: Implement**

In `src/hooks/useSyncHandlers.ts`:

Add import (keep alphabetical module order):

```ts
import { bracketRewindTime, findUndoTarget, overlapsPreviousLine } from "@/domain/sync/rewind";
```

Add constant next to `EARLY_TAP_TOAST_ID`:

```ts
const UNDO_LINE_TOAST_ID = "sync-undo-line";
```

Replace `runGesture` with:

```ts
  const runGesture = useCallback(
    (gesture: SyncGesture): boolean => {
      const { defaultWordDuration, autoRewindForBracketedLines, redoPreroll } = useSettingsStore.getState();
      const commit = commitGesture(lines, gesture, {
        cursor,
        jumped: !!syncState.jumpedToPosition,
        time: readTapTime(),
        defaultWordDuration,
        overlapsPrevious: autoRewindForBracketedLines && overlapsPreviousLine(lines, cursor.lineIndex),
      });
      if (!commit) return false;
      updateLinesWithHistory(commit.lineUpdates, { deriveText: false, propagateToSiblings: false });
      setSyncState((prev) => ({ ...prev, position: commit.nextCursor, jumpedToPosition: commit.nextJumped }));
      if (commit.clampedTo !== null) {
        toast(`Early tap snapped to ${formatTimeMs(commit.clampedTo)}`, { id: EARLY_TAP_TOAST_ID });
      }
      // A hold-tap has already opened the bracketed line's first word at the current time.
      if (autoRewindForBracketedLines && gesture !== "hold-tap") {
        const rewindTo = bracketRewindTime(lines, cursor, commit, redoPreroll);
        if (rewindTo !== null) {
          seekTo(rewindTo);
          setIsPlaying(true);
        }
      }
      return true;
    },
    [lines, cursor, syncState.jumpedToPosition, readTapTime, updateLinesWithHistory, setSyncState, seekTo, setIsPlaying],
  );
```

Add after `handleNudgeLastSynced`:

```ts
  const handleUndoAndRewindLine = useCallback(() => {
    const target = findUndoTarget(lines, cursor);
    if (!target) return;
    const line = lines[target.lineIndex];
    updateLinesWithHistory(
      [{ id: line.id, updates: { words: undefined, begin: undefined, end: undefined, backgroundWords: undefined } }],
      { deriveText: false, propagateToSiblings: false },
    );
    setSyncState((prev) => ({
      ...prev,
      position: { lineIndex: target.lineIndex, wordIndex: 0 },
      jumpedToPosition: true,
      isActive: true,
    }));
    const { undoRewindDuration, undoContinuePlayback } = useSettingsStore.getState();
    seekTo(Math.max(0, target.begin - undoRewindDuration));
    setIsPlaying(undoContinuePlayback);
    toast("Line sync undone", { id: UNDO_LINE_TOAST_ID });
  }, [lines, cursor, updateLinesWithHistory, setSyncState, seekTo, setIsPlaying]);
```

Add `handleUndoAndRewindLine,` to the returned object after `handleNudgeLastSynced,`.

- [ ] **Step 4: Run hook tests**

Run: `pnpm vitest run --project browser src/hooks/useSyncHandlers.browser.test.tsx`
Expected: PASS, including all pre-existing tests (none of them use bracketed lines, so `overlapsPrevious` is false for them).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSyncHandlers.ts src/hooks/useSyncHandlers.browser.test.tsx
git commit -m "feat(sync): undo-line-and-rewind handler and bracketed-line auto-rewind"
```

---

### Task 5: Bind the shortcut in the Sync panel

**Files:**
- Modify: `src/views/sync/sync-panel.tsx` (destructure ~line 108, keydown switch ~line 360, deps ~line 393)
- Test: `src/views/sync/sync-panel.browser.test.tsx`

**Interfaces:**
- Consumes: `handleUndoAndRewindLine` from Task 4, `"sync.undoAndRewind"` from Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `src/views/sync/sync-panel.browser.test.tsx`:

```ts
describe("SyncPanel · undo line shortcut", () => {
  function pressUndo(): void {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", code: "KeyR", bubbles: true }));
  }

  function loadTimedProject(): void {
    useAudioStore.setState({
      source: { type: "file", file: createAudioFile() },
      duration: 20,
      currentTime: 9,
      isPlaying: true,
    });
    useProjectStore.setState({
      activeTab: "sync",
      lines: [
        createLine({
          id: "l0",
          text: "Hello world",
          words: [createWord({ text: "Hello ", begin: 6, end: 6.5 }), createWord({ text: "world", begin: 6.5, end: 7 })],
        }),
        createLine({ id: "l1", text: "Second line" }),
      ],
    });
  }

  it("clears the last synced line and rewinds when R is pressed", async () => {
    loadTimedProject();
    await render(<SyncPanel />);

    pressUndo();

    await expect.poll(() => useProjectStore.getState().lines[0].words).toBeUndefined();
    expect(useAudioStore.getState().currentTime).toBe(3);
  });

  it("does nothing in edit mode", async () => {
    loadTimedProject();
    const screen = await render(<SyncPanel />);
    await screen.getByRole("button", { name: "Edit" }).click();

    pressUndo();

    expect(useProjectStore.getState().lines[0].words).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project browser src/views/sync/sync-panel.browser.test.tsx`
Expected: the first new test FAILS (words still present).

- [ ] **Step 3: Implement**

In `src/views/sync/sync-panel.tsx`:

Add `handleUndoAndRewindLine,` to the `useSyncHandlers` destructure after `handleNudgeLastSynced,`.

In the keydown `switch`, after the `sync.nudgeRight` case:

```ts
        case "sync.undoAndRewind":
          e.preventDefault();
          if (editMode || isHolding || e.repeat) return;
          handleUndoAndRewindLine();
          break;
```

Add `handleUndoAndRewindLine` to that effect's dependency array (after `handleNudgeLastSynced`).

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run --project browser src/views/sync`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/sync/sync-panel.tsx src/views/sync/sync-panel.browser.test.tsx
git commit -m "feat(sync): bind R to undo line sync and rewind"
```

---

### Task 6: Full verification and graph refresh

- [ ] **Step 1: Lint, typecheck, dead-code**

Run: `pnpm lint:fix && pnpm typecheck && pnpm knip`
Expected: no errors; knip reports no unused exports (every new export is consumed: `applyUpdates` by `rewind.ts`, `bracketAnchorLineIndex` by its test and `rewind.ts` internally; if knip flags `bracketAnchorLineIndex` or `UndoTarget` as test-only, drop them from the export list and test `bracketAnchorLineIndex` through `bracketRewindTime`).

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: unit and browser projects PASS, including the repo guard tests in `src/test/`.

- [ ] **Step 3: Manual check in the app**

Run `pnpm dev`, open the Sync tab with a song whose lyrics include a `(…)` line after a main line:
- Sync the main line; on its last word the audio jumps back to ~1.5s before the main line; tapping the bracketed words during the main line does not show "Early tap snapped".
- Press `R` mid-line: the line clears, a "Line sync undone" toast shows, audio restarts 3s before the line.
- Toggle the three settings under Settings › Sync & Timing and confirm each takes effect; rebind `R` under Shortcuts.

- [ ] **Step 4: Refresh the knowledge graph and commit any lint fixes**

```bash
graphify update .
git status --short
git add -u src
git commit -m "chore: lint fixes for sync undo and bracket rewind" # only if lint:fix changed files
```
