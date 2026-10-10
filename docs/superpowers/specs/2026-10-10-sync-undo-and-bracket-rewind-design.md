# Sync Undo & Bracketed Line Rewind Design

## Overview
This design introduces two synchronized audio playback controls to the Sync tab in Composer:
1. **Undo Line Sync & Rewind Shortcut (default `R`)**: Clears timing for the current line (or previous line if the current line has not yet been synced) and rewinds audio playback by a customizable duration before the line's first synced word.
2. **Auto-Rewind for Bracketed Lines**: When a main lyric line completes syncing and the subsequent line is bracketed (background/overlapping vocal, e.g. `(...)`), the audio automatically rewinds to the start of the anchor main line (with pre-roll) so the background vocal can be synced while playback continues smoothly.
3. **Settings Customization**: All behaviors (rewind duration, playback continuation on undo, and bracket auto-rewind toggle) are configurable in Settings.

---

## Architecture & Settings

### 1. Settings Schema (`src/stores/settings.ts`)
Three new configuration fields are added to `SettingsState` with persistence migration:
- **`undoRewindDuration`** (`number`, default `3.0`): The duration in seconds to rewind before the first word of the undone line.
- **`undoContinuePlayback`** (`boolean`, default `true`): Whether audio continues playing uninterrupted (`true`) or pauses (`false`) after undoing a line.
- **`autoRewindForBracketedLines`** (`boolean`, default `true`): Whether audio automatically seeks back to the preceding anchor main line when transitioning to a bracketed line.

Migration bump in `src/stores/settings.ts`:
- Ensure migrations initialize default values if they are undefined on older stored state.

### 2. Settings Catalog & UI (`src/stores/settings-catalog.ts` & Sync Settings)
- Add settings entries under the sync section:
  - **Undo Rewind Duration**: Number input / slider (`0.5`s to `10.0`s in steps of `0.5`s).
  - **Continue Playback on Undo**: Switch toggle.
  - **Auto-Rewind for Bracketed Lines**: Switch toggle.

### 3. Shortcut Registry (`src/stores/shortcut-definitions.ts`)
Add a new shortcut definition in scope `"sync"`:
```ts
{
  id: "sync.undoAndRewind",
  scope: "sync",
  description: "Undo line sync and rewind",
  defaultBinding: { key: "r" },
}
```

---

## Feature 1: Undo Line & Rewind Logic

### Trigger
- Bound to shortcut `sync.undoAndRewind` in `src/views/sync/sync-panel.tsx`.
- Dispatches `handleUndoAndRewindLine` in `src/hooks/useSyncHandlers.ts`.

### Target Line Resolution
1. **Check current line at `cursor.lineIndex`**:
   - If the current line has any timing (`hasAnyTiming(line)` is true):
     - Target is `cursor.lineIndex`.
   - If the current line has NO timing:
     - Search backwards for the most recent syncable line that has timing (`prevSyncableLineIndex(lines, cursor.lineIndex)` where `hasAnyTiming(lines[idx])`).
     - If found, that line becomes the target line.
     - If no timed line is found anywhere in the song, no-op.

### Action
1. Determine `firstSyncTime`:
   - `line.words?.[0]?.begin ?? line.begin ?? currentTime`.
2. Clear the target line's timing using `updateLinesWithHistory`:
   - Set `words: undefined`, `begin: undefined`, `end: undefined`, `backgroundWords: undefined`.
3. Reset sync position:
   - `setSyncState({ position: { lineIndex: targetLineIndex, wordIndex: 0 }, jumpedToPosition: true, isActive: true })`.
4. Audio seeking & playback:
   - Calculate rewind position: `seekTarget = Math.max(0, firstSyncTime - undoRewindDuration)`.
   - Call `seekTo(seekTarget)`.
   - If `undoContinuePlayback` is `true`:
     - Ensure `setIsPlaying(true)`.
   - If `undoContinuePlayback` is `false`:
     - Ensure `setIsPlaying(false)`.
5. Show feedback toast:
   - `toast("Line sync undone", { id: "sync-undo-line" })`.

---

## Feature 2: Auto-Rewind on Bracketed Lines

### Bracket Detection
A helper function `isBracketedLine(line: LyricLine): boolean`:
- Inspects `line.text.trim()`.
- Returns `true` if text starts with `(` and ends with `)`.

### Transition Trigger in `useSyncHandlers.ts`
When committing a gesture (`tap-word`, `hold-end`, `hold-tap`, or `tap-line`) inside `runGesture`:
1. Check if the gesture completed the current line and advanced to a new line:
   - `commit.nextCursor.lineIndex > cursor.lineIndex`.
2. Retrieve the next line: `nextLine = lines[commit.nextCursor.lineIndex]`.
3. If `autoRewindForBracketedLines` is enabled AND `isBracketedLine(nextLine)` is true:
   - Find the nearest preceding non-bracketed line that has timing:
     - Iterate backwards from `commit.nextCursor.lineIndex - 1` down to `0`.
     - Find first line where `!isBracketedLine(l)` and `hasAnyTiming(l)`.
   - If found (`anchorLine`):
     - Calculate anchor start time: `anchorTime = anchorLine.words?.[0]?.begin ?? anchorLine.begin`.
     - If `anchorTime !== undefined`:
       - Calculate rewind point: `rewindTime = Math.max(0, anchorTime - redoPreroll)`.
       - Seek audio: `seekTo(rewindTime)`.
       - Keep playback active (`setIsPlaying(true)`).

### Multi-Line Bracket Handling
- If multiple consecutive bracketed lines follow a main line:
  - Completing line 1 (main) $\to$ advances to line 2 (bracketed) $\to$ rewinds to line 1 start.
  - Completing line 2 (bracketed) $\to$ advances to line 3 (bracketed) $\to$ finds line 1 as the anchor main line $\to$ rewinds to line 1 start.
  - Completing line 3 (bracketed) $\to$ advances to line 4 (main line 2, not bracketed) $\to$ no rewind triggered; audio continues naturally forward.

---

## Error Handling & Edge Cases
- **No timed lines**: Undoing when nothing has been synced does nothing safely without errors.
- **Rewind past beginning of song**: `Math.max(0, time - duration)` clamps to `0`.
- **First line of song is bracketed**: No preceding anchor line exists; audio plays forward normally.
- **Modal open**: Shortcut does not trigger when any modal is open (`isAnyModalOpen()`).
- **Undo history**: All line timing updates use `updateLinesWithHistory`, so standard Ctrl+Z / Cmd+Z remains fully consistent.

---

## Testing Strategy
1. **Unit Tests (`src/domain/sync/` & `src/utils/`)**:
   - Test bracket detection helper on various formats: `"(vocal)"`, `"( vocal )"`, `"normal line"`, `"(incomplete"`.
   - Test anchor line lookup logic with single bracketed line and consecutive bracketed lines.
2. **Hook Tests (`src/hooks/useSyncHandlers.browser.test.tsx`)**:
   - Test `handleUndoAndRewindLine` when current line has timing.
   - Test `handleUndoAndRewindLine` when current line is empty (falls back to previous line).
   - Test playback state respects `undoContinuePlayback` (true vs false).
   - Test auto-rewind on bracketed line advancement during tap gestures.
3. **Shortcuts & Settings Tests**:
   - Verify `sync.undoAndRewind` appears in settings and is rebindable.
   - Verify defaults in `useSettingsStore`.
