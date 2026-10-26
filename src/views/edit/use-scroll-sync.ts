import { type LineAnchors, mapScrollTop, measureTextareaLineAnchors } from "@/views/edit/scroll-sync";
import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";

// -- Helpers ------------------------------------------------------------------

function measurePreviewLineAnchors(viewport: HTMLElement): number[] {
  const viewportTop = viewport.getBoundingClientRect().top - viewport.scrollTop;
  const anchors = Array.from(
    viewport.querySelectorAll<HTMLElement>("[data-line-row]"),
    (row) => row.getBoundingClientRect().top - viewportTop,
  );
  anchors.push(viewport.scrollHeight);
  return anchors;
}

const maxScroll = (el: HTMLElement) => el.scrollHeight - el.clientHeight;

type Side = "textarea" | "preview";

function consumeEcho(echo: Record<Side, number | null>, side: Side, scrollTop: number): boolean {
  const expected = echo[side];
  echo[side] = null;
  return expected !== null && Math.abs(expected - scrollTop) < 1;
}

// -- Hook ---------------------------------------------------------------------

// Keeps the lyrics textarea and the preview scrolled to the same line, and exposes the
// textarea's soft-wrapped line positions so other overlays can line up with its text.
function useScrollSync(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  previewViewportRef: RefObject<HTMLDivElement | null>,
  rawText: string,
) {
  const [textareaAnchors, setTextareaAnchors] = useState<LineAnchors>([]);
  const textareaAnchorsRef = useRef<LineAnchors>(textareaAnchors);
  // The scrollTop we last wrote to each pane, so its echoed scroll event isn't synced back.
  const echoRef = useRef<Record<Side, number | null>>({ textarea: null, preview: null });

  const remeasure = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const anchors = measureTextareaLineAnchors(textarea);
    textareaAnchorsRef.current = anchors;
    setTextareaAnchors(anchors);
  }, [textareaRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the textarea's DOM value changes with rawText, so its wrapped lines must be re-measured.
  useLayoutEffect(() => {
    remeasure();
  }, [rawText, remeasure]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      remeasure();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [textareaRef, remeasure]);

  const handleTextareaScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const viewport = previewViewportRef.current;
    if (!textarea || !viewport) return;
    if (consumeEcho(echoRef.current, "textarea", textarea.scrollTop)) return;
    const target = Math.round(
      mapScrollTop(
        textareaAnchorsRef.current,
        measurePreviewLineAnchors(viewport),
        textarea.scrollTop,
        maxScroll(textarea),
        maxScroll(viewport),
      ),
    );
    if (Math.abs(viewport.scrollTop - target) < 1) return;
    echoRef.current.preview = target;
    viewport.scrollTop = target;
  }, [textareaRef, previewViewportRef]);

  const handlePreviewScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const viewport = previewViewportRef.current;
    if (!textarea || !viewport) return;
    if (consumeEcho(echoRef.current, "preview", viewport.scrollTop)) return;
    const target = Math.round(
      mapScrollTop(
        measurePreviewLineAnchors(viewport),
        textareaAnchorsRef.current,
        viewport.scrollTop,
        maxScroll(viewport),
        maxScroll(textarea),
      ),
    );
    if (Math.abs(textarea.scrollTop - target) < 1) return;
    echoRef.current.textarea = target;
    textarea.scrollTop = target;
  }, [textareaRef, previewViewportRef]);

  return { textareaAnchors, handleTextareaScroll, handlePreviewScroll };
}

// -- Exports ------------------------------------------------------------------

export { useScrollSync };
