import { useAudioStore } from "@/stores/audio";
import { alignedScrollTop, measureScrollRows } from "@/views/edit/linked-scroll";
import { type RefObject, useCallback, useEffect, useRef } from "react";

// -- Interfaces ---------------------------------------------------------------

interface LinkedScrollRefs {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  backdropRef: RefObject<HTMLDivElement | null>;
  previewViewportRef: RefObject<HTMLDivElement | null>;
}

interface Echo {
  element: HTMLElement;
  scrollTop: number;
}

// -- Constants ----------------------------------------------------------------

const ECHO_TOLERANCE_PX = 0.5;

// -- Hook ---------------------------------------------------------------------

// Scrolling either panel scrolls the other to the same lyric line. A programmatic write echoes back as
// a scroll event on the target, which is recognised by its position and dropped instead of bouncing.
function useLinkedScroll(
  { textareaRef, backdropRef, previewViewportRef }: LinkedScrollRefs,
  currentLineNumber: number | null,
) {
  const echoRef = useRef<Echo | null>(null);

  const isEcho = useCallback((element: HTMLElement) => {
    const echo = echoRef.current;
    if (!echo || echo.element !== element) return false;
    if (Math.abs(element.scrollTop - echo.scrollTop) > ECHO_TOLERANCE_PX) return false;
    echoRef.current = null;
    return true;
  }, []);

  const follow = useCallback(
    (sourceRows: HTMLElement, sourceScrollTop: number, target: HTMLElement, targetRows: HTMLElement) => {
      const next = alignedScrollTop(measureScrollRows(sourceRows), measureScrollRows(targetRows), sourceScrollTop);
      if (next === null) return;
      const before = target.scrollTop;
      target.scrollTop = next;
      const after = target.scrollTop;
      echoRef.current = after === before ? null : { element: target, scrollTop: after };
    },
    [],
  );

  const onTextareaScroll = useCallback(
    (scrollTop: number) => {
      const textarea = textareaRef.current;
      const backdrop = backdropRef.current;
      const preview = previewViewportRef.current;
      if (!textarea || !backdrop || !preview || isEcho(textarea)) return;
      follow(backdrop, scrollTop, preview, preview);
    },
    [textareaRef, backdropRef, previewViewportRef, isEcho, follow],
  );

  const onPreviewScroll = useCallback(
    (scrollTop: number) => {
      const textarea = textareaRef.current;
      const backdrop = backdropRef.current;
      const preview = previewViewportRef.current;
      if (!textarea || !backdrop || !preview || isEcho(preview)) return;
      follow(preview, scrollTop, textarea, backdrop);
    },
    [textareaRef, backdropRef, previewViewportRef, isEcho, follow],
  );

  // Playback keeps the current line in view; typing or a paused seek never moves the panels.
  useEffect(() => {
    if (currentLineNumber === null || !useAudioStore.getState().isPlaying) return;
    const textarea = textareaRef.current;
    const preview = previewViewportRef.current;
    if (!preview || (textarea && document.activeElement === textarea)) return;
    preview
      .querySelector(`[data-edit-line="${currentLineNumber}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentLineNumber, textareaRef, previewViewportRef]);

  return { onTextareaScroll, onPreviewScroll };
}

// -- Exports ------------------------------------------------------------------

export { useLinkedScroll };
