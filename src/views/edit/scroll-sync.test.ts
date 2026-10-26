import { mapScrollTop } from "@/views/edit/scroll-sync";
import { describe, expect, it } from "vitest";

// -- mapScrollTop -------------------------------------------------------------

describe("mapScrollTop", () => {
  // Textarea: line 2 wraps to two rows. Preview: a group header pushes line 3 down.
  const textarea = [8, 36, 92, 120, 148];
  const preview = [0, 28, 56, 110, 138];

  it("pins the top and bottom", () => {
    expect(mapScrollTop(textarea, preview, 0, 100, 80)).toBe(0);
    expect(mapScrollTop(textarea, preview, 100, 100, 80)).toBe(80);
  });

  it("aligns line starts", () => {
    expect(mapScrollTop(textarea, preview, 36, 100, 200)).toBe(28);
    expect(mapScrollTop(textarea, preview, 92, 100, 200)).toBe(56);
  });

  it("interpolates within a line", () => {
    expect(mapScrollTop(textarea, preview, 64, 100, 200)).toBe(42);
  });

  it("clamps to the target's scroll range", () => {
    expect(mapScrollTop(preview, textarea, 99, 100, 50)).toBe(50);
  });

  it("falls back to proportional scrolling without anchors", () => {
    expect(mapScrollTop([], [], 50, 100, 200)).toBe(100);
  });
});
