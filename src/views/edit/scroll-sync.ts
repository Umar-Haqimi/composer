// -- Types --------------------------------------------------------------------

// Content-space top offset of each lyric line, in line order, followed by the total content height.
type LineAnchors = readonly number[];

// -- Functions ----------------------------------------------------------------

// Maps a scroll position in one pane onto the other so the same lyric line sits at the top of both,
// interpolating within a line so tall (wrapped) rows scroll smoothly instead of snapping.
function mapScrollTop(
  from: LineAnchors,
  to: LineAnchors,
  scrollTop: number,
  fromMaxScroll: number,
  toMaxScroll: number,
): number {
  if (toMaxScroll <= 0) return 0;
  if (scrollTop <= 0) return 0;
  if (fromMaxScroll > 0 && scrollTop >= fromMaxScroll - 1) return toMaxScroll;

  const count = Math.min(from.length, to.length);
  if (count < 2) return fromMaxScroll > 0 ? (scrollTop / fromMaxScroll) * toMaxScroll : 0;

  let i = 0;
  while (i < count - 2 && from[i + 1] <= scrollTop) i++;

  const span = from[i + 1] - from[i];
  const fraction = span > 0 ? Math.min(1, Math.max(0, (scrollTop - from[i]) / span)) : 0;
  const target = to[i] + fraction * (to[i + 1] - to[i]);
  return Math.min(toMaxScroll, Math.max(0, target));
}

// Properties that decide where a textarea wraps its text.
const MIRROR_PROPERTIES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariantLigatures",
  "fontFeatureSettings",
  "letterSpacing",
  "wordSpacing",
  "lineHeight",
  "textTransform",
  "textIndent",
  "tabSize",
  "whiteSpace",
  "overflowWrap",
  "wordBreak",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

// Measures where each line of a textarea starts once soft-wrapped, by laying the text out in a
// hidden mirror with the same width and typography. Returns anchors relative to the textarea's padding box.
function measureTextareaLineAnchors(textarea: HTMLTextAreaElement): number[] {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement("div");
  for (const property of MIRROR_PROPERTIES) mirror.style[property] = style[property];
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    top: "0",
    left: "-99999px",
    boxSizing: "border-box",
    border: "0",
    width: `${textarea.clientWidth}px`,
  });
  if (style.whiteSpace === "normal") mirror.style.whiteSpace = "pre-wrap";

  for (const text of textarea.value.split("\n")) {
    const row = document.createElement("div");
    row.textContent = text === "" ? "​" : text;
    mirror.append(row);
  }

  document.body.append(mirror);
  const anchors = Array.from(mirror.children, (row) => (row as HTMLElement).offsetTop);
  anchors.push(mirror.scrollHeight);
  mirror.remove();
  return anchors;
}

// -- Exports ------------------------------------------------------------------

export { mapScrollTop, measureTextareaLineAnchors };
export type { LineAnchors };
