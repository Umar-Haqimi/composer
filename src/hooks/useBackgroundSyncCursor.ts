import type { LyricLine } from "@/domain/line/model";
import type { SyncGranularity } from "@/domain/line/sync-progress";
import { backgroundPassLineIndices, clampBackgroundCursor } from "@/domain/sync/background-pass";
import type { SyncCursor } from "@/domain/sync/cursor";
import { useProjectStore } from "@/stores/project";
import { useCallback, useMemo, useState } from "react";

// -- Types --------------------------------------------------------------------

interface StoredBackgroundCursor {
  cursor: SyncCursor;
  entry: object | undefined;
}

// -- State --------------------------------------------------------------------

// History entries are immutable snapshots that undo and redo only re-point to,
// so each entry remembers where the background cursor stood when it was the
// current step. Undo from anywhere (toolbar, Timeline, shortcut) then lands the
// cursor back on the tap it removed.
const cursorByEntry = new WeakMap<object, SyncCursor>();

function currentEntry(): object | undefined {
  const { history, historyIndex } = useProjectStore.getState();
  return history[historyIndex];
}

// -- Hook ---------------------------------------------------------------------

function useBackgroundSyncCursor(lines: readonly LyricLine[], granularity: SyncGranularity) {
  const groups = useProjectStore((s) => s.groups);
  const entry = useProjectStore((s) => s.history[s.historyIndex]);
  const pass = useMemo(() => backgroundPassLineIndices(lines, groups), [lines, groups]);
  const [stored, setStored] = useState<StoredBackgroundCursor>({
    cursor: { lineIndex: 0, wordIndex: 0 },
    entry: undefined,
  });

  const remembered = entry === stored.entry || !entry ? undefined : cursorByEntry.get(entry);
  const raw = remembered ?? stored.cursor;
  const cursor = useMemo(() => clampBackgroundCursor(lines, pass, raw, granularity), [lines, pass, raw, granularity]);

  const moveTo = useCallback((next: SyncCursor) => setStored({ cursor: next, entry: currentEntry() }), []);

  const recordCommit = useCallback((before: SyncCursor, beforeEntry: object | undefined, next: SyncCursor) => {
    const afterEntry = currentEntry();
    if (beforeEntry) cursorByEntry.set(beforeEntry, before);
    if (afterEntry) cursorByEntry.set(afterEntry, next);
    setStored({ cursor: next, entry: afterEntry });
  }, []);

  return { pass, cursor, moveTo, recordCommit };
}

// -- Exports ------------------------------------------------------------------

export { useBackgroundSyncCursor };
