import { manualBackgroundWordEdit } from "@/domain/line/background";
import type { LyricLine } from "@/domain/line/model";
import { shiftWords } from "@/domain/line/shift";
import type { SyncGranularity } from "@/domain/line/sync-progress";
import { type BackgroundGesture, commitBackgroundGesture } from "@/domain/sync/background-gesture";
import {
  backgroundPassProgress,
  backgroundResumeTime,
  backgroundSlots,
  firstBackgroundCursor,
  isBackgroundPassComplete,
  previousBackgroundSlot,
  retreatBackgroundCursor,
} from "@/domain/sync/background-pass";
import { toastEarlyTap, triggerPulse } from "@/hooks/sync-gesture-feedback";
import { useBackgroundSyncCursor } from "@/hooks/useBackgroundSyncCursor";
import { requestPlayback } from "@/lib/sync-count-in";
import { livePlaybackTime, useAudioStore } from "@/stores/audio";
import { useProjectStore } from "@/stores/project";
import { useSettingsStore } from "@/stores/settings";
import { stripSplitCharacter } from "@/utils/split-character";
import type { SyncState } from "@/utils/sync-helpers";
import { nudgeBgWordBegin } from "@/utils/timing/bg-word-timing";
import { useCallback, useMemo } from "react";

// -- Types --------------------------------------------------------------------

interface UseBackgroundSyncHandlersProps {
  lines: LyricLine[];
  granularity: SyncGranularity;
  editMode: boolean;
  setSyncState: React.Dispatch<React.SetStateAction<SyncState>>;
  setShowPulse: (show: boolean) => void;
  setIsPlaying: (playing: boolean) => void;
}

const TIMING_WRITE = { deriveText: false, propagateToSiblings: false } as const;

// -- Hook ---------------------------------------------------------------------

// The background pass mirrors the lead pass's gesture surface, so the Sync panel
// swaps one handler set for the other and keeps a single keyboard and pointer path.
function useBackgroundSyncHandlers({
  lines,
  granularity,
  editMode,
  setSyncState,
  setShowPulse,
  setIsPlaying,
}: UseBackgroundSyncHandlersProps) {
  const seekTo = useAudioStore((s) => s.seekTo);
  const updateLineWithHistory = useProjectStore((s) => s.updateLineWithHistory);
  const updateLinesWithHistory = useProjectStore((s) => s.updateLinesWithHistory);
  const { pass, cursor, moveTo, recordCommit } = useBackgroundSyncCursor(lines, granularity);
  const isComplete = isBackgroundPassComplete(lines, cursor);

  const runGesture = useCallback(
    (gesture: BackgroundGesture): boolean => {
      const commit = commitBackgroundGesture(lines, gesture, { cursor, time: livePlaybackTime(), granularity, pass });
      if (!commit) return false;
      const before = useProjectStore.getState();
      updateLinesWithHistory(commit.lineUpdates, TIMING_WRITE);
      if (useProjectStore.getState().lines === before.lines) return false;
      recordCommit(cursor, before.history[before.historyIndex], commit.nextCursor);
      toastEarlyTap(commit.clampedTo);
      return true;
    },
    [lines, cursor, granularity, pass, updateLinesWithHistory, recordCommit],
  );

  const handleTap = useCallback(() => {
    if (runGesture("tap")) triggerPulse(setShowPulse);
  }, [runGesture, setShowPulse]);
  const handleHoldStart = useCallback(() => void runGesture("hold-start"), [runGesture]);
  const handleHoldEnd = useCallback(() => {
    if (runGesture("hold-end")) triggerPulse(setShowPulse);
  }, [runGesture, setShowPulse]);
  const handleHoldTap = useCallback(() => {
    if (runGesture("hold-tap")) triggerPulse(setShowPulse);
  }, [runGesture, setShowPulse]);

  const seekBefore = useCallback(
    (time: number) => seekTo(Math.max(0, time - useSettingsStore.getState().redoPreroll)),
    [seekTo],
  );

  const handleStartSync = useCallback(() => {
    const start = isComplete ? firstBackgroundCursor(lines, pass) : cursor;
    moveTo(start);
    const resume = backgroundResumeTime(lines, start, granularity);
    if (resume !== null) seekBefore(resume);
    setSyncState((prev) => ({ ...prev, isActive: true }));
    return requestPlayback();
  }, [isComplete, lines, pass, cursor, granularity, moveTo, seekBefore, setSyncState]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    moveTo(firstBackgroundCursor(lines, pass));
    setSyncState((prev) => ({ ...prev, isActive: false }));
  }, [lines, pass, moveTo, setIsPlaying, setSyncState]);

  // Edit mode treats a click as a scrub for auditioning, so playback is left alone there.
  const jumpTo = useCallback(
    (next: typeof cursor, time: number | null) => {
      if (pass.includes(next.lineIndex)) moveTo(next);
      if (time === null) return;
      if (editMode) return seekTo(time);
      setIsPlaying(false);
      seekBefore(time);
    },
    [pass, editMode, moveTo, seekTo, seekBefore, setIsPlaying],
  );

  const handleJumpToLine = useCallback(
    (lineIndex: number) => {
      const next = { lineIndex, wordIndex: 0 };
      jumpTo(next, backgroundResumeTime(lines, next, granularity));
    },
    [lines, granularity, jumpTo],
  );

  const handleJumpToBgWord = useCallback(
    (lineIndex: number, wordIndex: number) => {
      const word = lines[lineIndex]?.backgroundWords?.[wordIndex];
      if (!word) return;
      jumpTo({ lineIndex, wordIndex: granularity === "word" ? wordIndex : 0 }, word.begin);
    },
    [lines, granularity, jumpTo],
  );

  const handleNudgeLastSynced = useCallback(
    (delta: number) => {
      const previous = retreatBackgroundCursor(lines, pass, cursor, granularity);
      const line = lines[previous.lineIndex];
      if (previous === cursor || !line) return;
      const { groups } = useProjectStore.getState();
      if (granularity === "word") {
        const duration = useAudioStore.getState().duration;
        nudgeBgWordBegin(lines, previous.lineIndex, previous.wordIndex, delta, updateLineWithHistory, groups, duration);
        return;
      }
      const words = shiftWords(backgroundSlots(line), delta);
      updateLinesWithHistory([{ id: line.id, updates: manualBackgroundWordEdit(words) }], TIMING_WRITE);
    },
    [lines, pass, cursor, granularity, updateLineWithHistory, updateLinesWithHistory],
  );

  const currentLine = lines[cursor.lineIndex];
  const currentWord = useMemo(() => {
    if (!currentLine) return undefined;
    if (granularity === "line") return currentLine.backgroundText && stripSplitCharacter(currentLine.backgroundText);
    return backgroundSlots(currentLine)[cursor.wordIndex]?.text.trim();
  }, [currentLine, granularity, cursor.wordIndex]);

  return {
    handleTap,
    handleHoldStart,
    handleHoldEnd,
    handleHoldTap,
    handleStartSync,
    handleReset,
    handleJumpToLine,
    handleJumpToBgWord,
    handleNudgeLastSynced,
    cursor,
    isComplete,
    currentWord,
    pass,
    progress: backgroundPassProgress(lines, pass, cursor, granularity),
    lastSyncedTime: previousBackgroundSlot(lines, pass, cursor, granularity)?.begin,
  };
}

// -- Exports ------------------------------------------------------------------

export { useBackgroundSyncHandlers };
