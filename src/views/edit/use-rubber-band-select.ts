import { cancelNextFrame, nextFrame } from "@/lib/frame-loop";
import { useCallback, useEffect, useRef, useState } from "react";

// -- Types --------------------------------------------------------------------

interface BandRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface RubberBandOptions {
  getSelection: () => ReadonlySet<number>;
  // `focusLine` is the line nearest the pointer end of the band, for later shift-click ranges.
  onSelect: (next: Set<number>, focusLine: number | null) => void;
}

// -- Constants ----------------------------------------------------------------

const DRAG_THRESHOLD_PX = 4;
const AUTOSCROLL_EDGE_PX = 32;
const AUTOSCROLL_MAX_SPEED_PX = 18;
const IGNORED_TARGETS = "button, select, input, textarea, a, [contenteditable], .line-cell, .os-scrollbar";

// -- Helpers ------------------------------------------------------------------

function suppressNextClick(): void {
  const stop = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  // A drag that ends outside its start element fires no click; drop the guard so the next real click works.
  setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// -- Hook ---------------------------------------------------------------------

// Drag on empty space or a row's body in the preview to draw a selection rectangle over lines.
// Holding Shift, Ctrl or Cmd adds to the existing selection instead of replacing it.
function useRubberBandSelect({ getSelection, onSelect }: RubberBandOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [band, setBand] = useState<BandRect | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const container = containerRef.current;
      const viewport = viewportRef.current;
      if (e.button !== 0 || !container || !viewport) return;
      const target = e.target as HTMLElement;
      if (!viewport.contains(target) || target.closest(IGNORED_TARGETS)) return;

      const startRect = viewport.getBoundingClientRect();
      const startX = e.clientX - startRect.left;
      const startY = e.clientY - startRect.top + viewport.scrollTop;
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const base = e.shiftKey || e.ctrlKey || e.metaKey ? new Set(getSelection()) : new Set<number>();
      let pointer = { x: e.clientX, y: e.clientY };
      let active = false;
      let frame = 0;
      let lastSelection: ReadonlySet<number> = getSelection();

      const update = () => {
        const rect = viewport.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const x = Math.min(Math.max(pointer.x - rect.left, 0), viewport.clientWidth);
        const y = Math.min(Math.max(pointer.y - rect.top + viewport.scrollTop, 0), viewport.scrollHeight);
        const top = Math.min(startY, y);
        const bottom = Math.max(startY, y);

        const next = new Set(base);
        let focusLine: number | null = null;
        const contentTop = rect.top - viewport.scrollTop;
        for (const row of viewport.querySelectorAll<HTMLElement>("[data-line-row]")) {
          if (row.dataset.lineEmpty !== undefined) continue;
          const rowRect = row.getBoundingClientRect();
          const rowTop = rowRect.top - contentTop;
          const rowBottom = rowRect.bottom - contentTop;
          if (rowBottom <= top || rowTop >= bottom) continue;
          const lineNumber = Number(row.dataset.lineRow);
          next.add(lineNumber);
          if (focusLine === null || y >= startY) focusLine = lineNumber;
        }
        if (!sameSet(next, lastSelection)) {
          lastSelection = next;
          onSelect(next, focusLine);
        }

        // Draw the band clipped to the visible viewport.
        const visibleTop = Math.max(top - viewport.scrollTop, 0);
        const visibleBottom = Math.min(bottom - viewport.scrollTop, viewport.clientHeight);
        setBand({
          top: rect.top - containerRect.top + visibleTop,
          left: rect.left - containerRect.left + Math.min(startX, x),
          width: Math.abs(x - startX),
          height: Math.max(visibleBottom - visibleTop, 0),
        });
      };

      const autoscroll = () => {
        frame = 0;
        if (!active) return;
        const rect = viewport.getBoundingClientRect();
        let delta = 0;
        if (pointer.y < rect.top + AUTOSCROLL_EDGE_PX) {
          delta = -Math.min(1, (rect.top + AUTOSCROLL_EDGE_PX - pointer.y) / AUTOSCROLL_EDGE_PX);
        } else if (pointer.y > rect.bottom - AUTOSCROLL_EDGE_PX) {
          delta = Math.min(1, (pointer.y - (rect.bottom - AUTOSCROLL_EDGE_PX)) / AUTOSCROLL_EDGE_PX);
        }
        if (delta === 0) return;
        const before = viewport.scrollTop;
        viewport.scrollTop += Math.round(delta * AUTOSCROLL_MAX_SPEED_PX);
        if (viewport.scrollTop !== before) update();
        frame = nextFrame(autoscroll);
      };

      const handleMove = (ev: MouseEvent) => {
        pointer = { x: ev.clientX, y: ev.clientY };
        if (!active) {
          if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) < DRAG_THRESHOLD_PX) return;
          active = true;
        }
        window.getSelection()?.removeAllRanges();
        update();
        if (!frame) frame = nextFrame(autoscroll);
      };

      const cleanup = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        if (frame) cancelNextFrame(frame);
        cleanupRef.current = null;
      };

      const handleUp = () => {
        if (active) suppressNextClick();
        active = false;
        cleanup();
        setBand(null);
      };

      cleanupRef.current?.();
      cleanupRef.current = cleanup;
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [getSelection, onSelect],
  );

  return { containerRef, viewportRef, band, handleMouseDown };
}

// -- Exports ------------------------------------------------------------------

export { useRubberBandSelect };
export type { BandRect };
