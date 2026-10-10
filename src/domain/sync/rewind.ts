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
