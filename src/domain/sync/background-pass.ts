import { isSharedLine } from "@/domain/group/shared-timing";
import type { LinkGroup } from "@/domain/group/template";
import { mainBounds } from "@/domain/line/bounds";
import type { LyricLine } from "@/domain/line/model";
import { type SyncGranularity, isSyncableLine } from "@/domain/line/sync-progress";
import type { SyncCursor } from "@/domain/sync/cursor";
import type { WordTiming } from "@/domain/word/timing";
import { createInitialBgWords } from "@/utils/sync-helpers";

// -- Types --------------------------------------------------------------------

type SyncTrack = "lead" | "background";

interface SlotTiming {
  begin: number;
  end: number;
}

// -- Lines --------------------------------------------------------------------

function hasBackgroundToSync(line: LyricLine): boolean {
  return isSyncableLine(line) && !!line.backgroundText?.trim() && mainBounds(line) !== null;
}

// The background pass runs after the lead pass, so it visits lines whose lead is
// timed. Shared-timing fan-out copies background words to every placed instance,
// so only the first instance of each shared template line needs tapping.
function backgroundPassLineIndices(lines: readonly LyricLine[], groups: readonly LinkGroup[]): number[] {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const seenShared = new Set<string>();
  const indices: number[] = [];
  lines.forEach((line, index) => {
    if (!hasBackgroundToSync(line)) return;
    if (isSharedLine(line, groupsById)) {
      const key = `${line.groupId}:${line.templateLineIdx ?? line.id}`;
      if (seenShared.has(key)) return;
      seenShared.add(key);
    }
    indices.push(index);
  });
  return indices;
}

// A line keeps every background word in its array, so a pass that has not
// reached a line yet still exports all of its words. Untimed text is seeded at
// the lead's start, the same guess the lead pass makes.
function backgroundSlots(line: LyricLine): WordTiming[] {
  if (line.backgroundWords?.length) return line.backgroundWords;
  const bounds = mainBounds(line);
  if (!bounds || !line.backgroundText) return [];
  return createInitialBgWords(line.backgroundText, bounds.begin);
}

function slotCount(lines: readonly LyricLine[], lineIndex: number, granularity: SyncGranularity): number {
  const line = lines[lineIndex];
  if (!line) return 0;
  return granularity === "line" ? 1 : backgroundSlots(line).length;
}

// -- Cursor -------------------------------------------------------------------

function pastEnd(lines: readonly LyricLine[]): SyncCursor {
  return { lineIndex: lines.length, wordIndex: 0 };
}

function firstBackgroundCursor(lines: readonly LyricLine[], pass: readonly number[]): SyncCursor {
  return pass.length > 0 ? { lineIndex: pass[0], wordIndex: 0 } : pastEnd(lines);
}

function isBackgroundPassComplete(lines: readonly LyricLine[], cursor: SyncCursor): boolean {
  return cursor.lineIndex >= lines.length;
}

function advanceBackgroundCursor(
  lines: readonly LyricLine[],
  pass: readonly number[],
  cursor: SyncCursor,
  granularity: SyncGranularity,
): SyncCursor {
  if (cursor.wordIndex + 1 < slotCount(lines, cursor.lineIndex, granularity)) {
    return { lineIndex: cursor.lineIndex, wordIndex: cursor.wordIndex + 1 };
  }
  const next = pass.find((index) => index > cursor.lineIndex);
  return next === undefined ? pastEnd(lines) : { lineIndex: next, wordIndex: 0 };
}

function retreatBackgroundCursor(
  lines: readonly LyricLine[],
  pass: readonly number[],
  cursor: SyncCursor,
  granularity: SyncGranularity,
): SyncCursor {
  if (cursor.wordIndex > 0 && pass.includes(cursor.lineIndex)) {
    return { lineIndex: cursor.lineIndex, wordIndex: cursor.wordIndex - 1 };
  }
  const previous = pass.findLast((index) => index < cursor.lineIndex);
  if (previous === undefined) return cursor;
  return { lineIndex: previous, wordIndex: Math.max(0, slotCount(lines, previous, granularity) - 1) };
}

// Lines change under the cursor (edits, undo, a granularity switch), so the
// stored position is pulled onto the nearest background line at or after it.
function clampBackgroundCursor(
  lines: readonly LyricLine[],
  pass: readonly number[],
  cursor: SyncCursor,
  granularity: SyncGranularity,
): SyncCursor {
  const lineIndex = pass.find((index) => index >= cursor.lineIndex);
  if (lineIndex === undefined) return pastEnd(lines);
  if (lineIndex !== cursor.lineIndex) return { lineIndex, wordIndex: 0 };
  const lastSlot = Math.max(0, slotCount(lines, lineIndex, granularity) - 1);
  return { lineIndex, wordIndex: Math.min(cursor.wordIndex, lastSlot) };
}

function backgroundSlotTiming(
  lines: readonly LyricLine[],
  cursor: SyncCursor,
  granularity: SyncGranularity,
): SlotTiming | null {
  const line = lines[cursor.lineIndex];
  if (!line) return null;
  const slots = backgroundSlots(line);
  if (slots.length === 0) return null;
  if (granularity === "line") return { begin: slots[0].begin, end: slots[slots.length - 1].end };
  const slot = slots[cursor.wordIndex];
  return slot ? { begin: slot.begin, end: slot.end } : null;
}

function previousBackgroundSlot(
  lines: readonly LyricLine[],
  pass: readonly number[],
  cursor: SyncCursor,
  granularity: SyncGranularity,
): SlotTiming | null {
  const previous = retreatBackgroundCursor(lines, pass, cursor, granularity);
  if (previous === cursor) return null;
  return backgroundSlotTiming(lines, previous, granularity);
}

// Where playback resumes for the slot under the cursor: the previous background
// word mid-line, otherwise the lead's start, since background vocals answer it.
function backgroundResumeTime(
  lines: readonly LyricLine[],
  cursor: SyncCursor,
  granularity: SyncGranularity,
): number | null {
  if (granularity === "word" && cursor.wordIndex > 0) {
    return backgroundSlotTiming(lines, { ...cursor, wordIndex: cursor.wordIndex - 1 }, granularity)?.begin ?? null;
  }
  const line = lines[cursor.lineIndex];
  return line ? (mainBounds(line)?.begin ?? null) : null;
}

// Lines without background vocals have nothing to tap, so a finished line jumps
// ahead to the next one. Only forward: a close next line keeps playing through.
function backgroundSkipTarget(
  lines: readonly LyricLine[],
  next: SyncCursor,
  granularity: SyncGranularity,
  tapTime: number,
  preroll: number,
): number | null {
  if (next.wordIndex !== 0) return null;
  const resume = backgroundResumeTime(lines, next, granularity);
  if (resume === null) return null;
  const seekTo = resume - preroll;
  return seekTo > tapTime ? seekTo : null;
}

function backgroundPassProgress(
  lines: readonly LyricLine[],
  pass: readonly number[],
  cursor: SyncCursor,
  granularity: SyncGranularity,
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const index of pass) {
    const count = slotCount(lines, index, granularity);
    total += count;
    if (index < cursor.lineIndex) done += count;
    else if (index === cursor.lineIndex) done += Math.min(cursor.wordIndex, count);
  }
  return { done, total };
}

// -- Exports ------------------------------------------------------------------

export {
  advanceBackgroundCursor,
  backgroundPassLineIndices,
  backgroundPassProgress,
  backgroundResumeTime,
  backgroundSkipTarget,
  backgroundSlots,
  clampBackgroundCursor,
  firstBackgroundCursor,
  isBackgroundPassComplete,
  previousBackgroundSlot,
  retreatBackgroundCursor,
};
export type { SyncTrack };
