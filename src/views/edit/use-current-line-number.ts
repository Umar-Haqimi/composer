import type { LyricLine } from "@/domain/line/model";
import { lineBounds, playingLineIndexAmong } from "@/domain/line/playing-line";
import { useFrameLoop } from "@/hooks/use-frame-loop";
import { livePlaybackTime } from "@/stores/audio";
import type { ParsedLine } from "@/views/edit/parse-lyrics";
import { useEffect, useMemo, useRef, useState } from "react";

// -- Hook ---------------------------------------------------------------------

// The textarea row (1-based) of the line at the playhead, or null when nothing is timed or the playhead is hidden.
function useCurrentLineNumber(lines: readonly LyricLine[], parsed: readonly ParsedLine[], enabled: boolean) {
  const [currentLineNumber, setCurrentLineNumber] = useState<number | null>(null);
  const lastRef = useRef<number | null>(null);
  const bounds = useMemo(() => lineBounds(lines), [lines]);
  const rowByLineId = useMemo(
    () => new Map(parsed.flatMap((line) => (line.lineId ? [[line.lineId, line.lineNumber] as const] : []))),
    [parsed],
  );

  const compute = () => {
    const index = enabled ? playingLineIndexAmong(bounds, livePlaybackTime()) : -1;
    const lineId = index >= 0 ? lines[index]?.id : undefined;
    const next = lineId === undefined ? null : (rowByLineId.get(lineId) ?? null);
    if (next === lastRef.current) return;
    lastRef.current = next;
    setCurrentLineNumber(next);
  };

  // The loop sleeps between playback and seeks, so edits that remap rows are picked up here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: compute reads the latest bounds and rows by closure
  useEffect(compute, [bounds, rowByLineId, enabled]);
  useFrameLoop(compute, "edit-current-line", enabled);

  return currentLineNumber;
}

// -- Exports ------------------------------------------------------------------

export { useCurrentLineNumber };
