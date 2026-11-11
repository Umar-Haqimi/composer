import { effectiveBounds } from "@/domain/line/bounds";
import type { LyricLine } from "@/domain/line/model";

// -- Types --------------------------------------------------------------------

type LineBounds = ReturnType<typeof effectiveBounds>;

// -- Functions ----------------------------------------------------------------

function lineBounds(lines: readonly LyricLine[]): LineBounds[] {
  return lines.map(effectiveBounds);
}

// The line sounding at `time`; between lines the last one that ended, before the first line the first one ahead.
function playingLineIndexAmong(bounds: readonly LineBounds[], time: number): number {
  const sounding = bounds.findIndex((b) => b !== null && time >= b.begin && time < b.end);
  if (sounding !== -1) return sounding;
  const ended = bounds.findLastIndex((b) => b !== null && time >= b.end);
  if (ended !== -1) return ended;
  return bounds.findIndex((b) => b !== null && time < b.begin);
}

function playingLineIndex(lines: readonly LyricLine[], time: number): number {
  return playingLineIndexAmong(lineBounds(lines), time);
}

// -- Exports ------------------------------------------------------------------

export { lineBounds, playingLineIndex, playingLineIndexAmong };
