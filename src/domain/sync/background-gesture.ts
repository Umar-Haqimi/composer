import { manualBackgroundWordEdit } from "@/domain/line/background";
import type { LineUpdate, LyricLine } from "@/domain/line/model";
import { shiftWords } from "@/domain/line/shift";
import type { SyncGranularity } from "@/domain/line/sync-progress";
import { advanceBackgroundCursor, backgroundSlots } from "@/domain/sync/background-pass";
import type { SyncCursor } from "@/domain/sync/cursor";
import { applyLineUpdates } from "@/domain/line/apply-line-updates";
import { enforceOrderAround } from "@/domain/word/order";
import type { WordTiming } from "@/domain/word/timing";
import { DEFAULT_BG_WORD_DURATION } from "@/utils/sync-helpers";

// -- Types --------------------------------------------------------------------

type BackgroundGesture = "tap" | "hold-start" | "hold-end" | "hold-tap";

interface BackgroundGestureContext {
  cursor: SyncCursor;
  time: number;
  granularity: SyncGranularity;
  pass: readonly number[];
}

interface BackgroundCommit {
  lineUpdates: LineUpdate[];
  nextCursor: SyncCursor;
  clampedTo: number | null;
}

interface SlotWrite {
  update: LineUpdate;
  clampedTo: number | null;
}

interface SlotClose extends SlotWrite {
  closeEnd: number;
}

// -- Word helpers ---------------------------------------------------------------

function slotWrite(line: LyricLine, words: WordTiming[], clampedTo: number | null): SlotWrite {
  return { update: { id: line.id, updates: manualBackgroundWordEdit(words) }, clampedTo };
}

// Words after the written one still hold their old guess, so they move as a
// block and keep their lengths instead of collapsing to zero.
function pushFollowing(words: WordTiming[], index: number): WordTiming[] {
  const next = words[index + 1];
  if (!next || next.begin >= words[index].end) return enforceOrderAround(words, index);
  const shifted = shiftWords(words.slice(index + 1), words[index].end - next.begin);
  return enforceOrderAround([...words.slice(0, index + 1), ...shifted], index);
}

function isOpen(word: WordTiming): boolean {
  return word.begin === word.end;
}

function spreadWords(words: readonly WordTiming[], begin: number, end: number): WordTiming[] {
  const weights = words.map((word) => Math.max(1, word.text.trim().length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = begin;
  return words.map((word, index) => {
    const wordEnd = index === words.length - 1 ? end : cursor + ((end - begin) * weights[index]) / total;
    const spread = { ...word, begin: cursor, end: wordEnd };
    cursor = wordEnd;
    return spread;
  });
}

// -- Word mode ------------------------------------------------------------------

function writeWordSlot(line: LyricLine, ctx: BackgroundGestureContext, open: boolean): SlotWrite | null {
  const slots = backgroundSlots(line);
  const index = ctx.cursor.wordIndex;
  const slot = slots[index];
  if (!slot) return null;
  const previous = slots[index - 1];
  const floor = previous ? previous.begin : 0;
  const begin = Math.max(ctx.time, floor);
  const length = slot.end > slot.begin ? slot.end - slot.begin : DEFAULT_BG_WORD_DURATION;

  const words = [...slots];
  words[index] = { ...slot, begin, end: open ? begin : begin + length };
  if (previous) {
    const closesAt = open && !isOpen(previous) ? Math.min(previous.end, begin) : begin;
    words[index - 1] = { ...previous, end: Math.max(closesAt, previous.begin) };
  }
  return slotWrite(line, pushFollowing(words, index), ctx.time < floor ? floor : null);
}

function closeWordSlot(line: LyricLine, ctx: BackgroundGestureContext): SlotClose | null {
  const slots = backgroundSlots(line);
  const index = ctx.cursor.wordIndex;
  const held = slots[index];
  if (!held || !isOpen(held)) return null;
  const closeEnd = Math.max(ctx.time, held.begin);
  const words = [...slots];
  words[index] = { ...held, end: closeEnd };
  return { ...slotWrite(line, pushFollowing(words, index), ctx.time < held.begin ? held.begin : null), closeEnd };
}

// -- Line mode ------------------------------------------------------------------

function writeLineSlot(line: LyricLine, ctx: BackgroundGestureContext, open: boolean): SlotWrite | null {
  const slots = backgroundSlots(line);
  if (slots.length === 0) return null;
  const words = open
    ? slots.map((word) => ({ ...word, begin: ctx.time, end: ctx.time }))
    : shiftWords(slots, ctx.time - slots[0].begin);
  return slotWrite(line, words, null);
}

function closeLineSlot(line: LyricLine, ctx: BackgroundGestureContext): SlotClose | null {
  const slots = backgroundSlots(line);
  const begin = slots[0]?.begin;
  if (begin === undefined || !slots.every((word) => isOpen(word) && word.begin === begin)) return null;
  const closeEnd = Math.max(ctx.time, begin);
  return { ...slotWrite(line, spreadWords(slots, begin, closeEnd), ctx.time < begin ? begin : null), closeEnd };
}

// -- Dispatcher -------------------------------------------------------------------

function writeSlot(lines: readonly LyricLine[], ctx: BackgroundGestureContext, open: boolean): SlotWrite | null {
  const line = lines[ctx.cursor.lineIndex];
  if (!line) return null;
  return ctx.granularity === "line" ? writeLineSlot(line, ctx, open) : writeWordSlot(line, ctx, open);
}

function closeSlot(lines: readonly LyricLine[], ctx: BackgroundGestureContext): SlotClose | null {
  const line = lines[ctx.cursor.lineIndex];
  if (!line) return null;
  return ctx.granularity === "line" ? closeLineSlot(line, ctx) : closeWordSlot(line, ctx);
}

function commitBackgroundGesture(
  lines: readonly LyricLine[],
  gesture: BackgroundGesture,
  ctx: BackgroundGestureContext,
): BackgroundCommit | null {
  const advance = (cursor: SyncCursor) => advanceBackgroundCursor(lines, ctx.pass, cursor, ctx.granularity);

  if (gesture === "tap" || gesture === "hold-start") {
    const open = gesture === "hold-start";
    const write = writeSlot(lines, ctx, open);
    if (!write) return null;
    return {
      lineUpdates: [write.update],
      nextCursor: open ? ctx.cursor : advance(ctx.cursor),
      clampedTo: write.clampedTo,
    };
  }

  const closed = closeSlot(lines, ctx);
  if (!closed) return null;
  const nextCursor = advance(ctx.cursor);
  if (gesture === "hold-end") return { lineUpdates: [closed.update], nextCursor, clampedTo: closed.clampedTo };

  const linesAfterClose = applyLineUpdates(lines, [closed.update]);
  const opened = writeSlot(linesAfterClose, { ...ctx, cursor: nextCursor, time: closed.closeEnd }, true);
  const sameLine = opened?.update.id === closed.update.id;
  const lineUpdates = !opened ? [closed.update] : sameLine ? [opened.update] : [closed.update, opened.update];
  return { lineUpdates, nextCursor, clampedTo: closed.clampedTo };
}

// -- Exports ------------------------------------------------------------------

export { commitBackgroundGesture };
export type { BackgroundCommit, BackgroundGesture };
