import type { LyricLine } from "@/domain/line/model";
import type { GestureCommit } from "@/domain/sync/commit-gesture";
import { bracketAnchorLineIndex, bracketRewindTime, findUndoTarget, overlapsPreviousLine } from "@/domain/sync/rewind";
import { createLine } from "@/test/factories";
import { describe, expect, it } from "vitest";

const word = (text: string, begin: number, end: number) => ({ text, begin, end });
const timed = (id: string, text: string, begin: number) =>
  createLine({ id, text, words: [word(`${text} `, begin, begin + 0.5)] });
const untimed = (id: string, text: string) => createLine({ id, text });
const blank = (id: string) => createLine({ id, text: "" });

function commitTo(lineIndex: number, lineUpdates: GestureCommit["lineUpdates"] = []): GestureCommit {
  return { lineUpdates, nextCursor: { lineIndex, wordIndex: 0 }, nextJumped: false, clampedTo: null };
}

describe("findUndoTarget", () => {
  it("targets the cursor line when it has timing", () => {
    const lines = [timed("a", "one", 1), timed("b", "two", 5)];
    expect(findUndoTarget(lines, { lineIndex: 1, wordIndex: 1 })).toEqual({ lineIndex: 1, begin: 5 });
  });

  it("falls back to the most recent timed line when the cursor line is untimed", () => {
    const lines = [timed("a", "one", 1), timed("b", "two", 5), blank("c"), untimed("d", "four")];
    expect(findUndoTarget(lines, { lineIndex: 3, wordIndex: 0 })).toEqual({ lineIndex: 1, begin: 5 });
  });

  it("works from a cursor past the end of the song", () => {
    const lines = [timed("a", "one", 1), timed("b", "two", 5)];
    expect(findUndoTarget(lines, { lineIndex: 2, wordIndex: 0 })).toEqual({ lineIndex: 1, begin: 5 });
  });

  it("uses line timing in line granularity", () => {
    const lines = [createLine({ id: "a", text: "one", begin: 4, end: 6 })];
    expect(findUndoTarget(lines, { lineIndex: 0, wordIndex: 0 })).toEqual({ lineIndex: 0, begin: 4 });
  });

  it("ignores seeded background words on an otherwise untimed line", () => {
    const lines = [
      timed("a", "one", 1),
      createLine({ id: "b", text: "two", backgroundText: "ooh", backgroundWords: [word("ooh", 9, 9.5)] }),
    ];
    expect(findUndoTarget(lines, { lineIndex: 1, wordIndex: 0 })).toEqual({ lineIndex: 0, begin: 1 });
  });

  it("returns null when nothing is timed", () => {
    expect(findUndoTarget([untimed("a", "one")], { lineIndex: 0, wordIndex: 0 })).toBeNull();
    expect(findUndoTarget([], { lineIndex: 0, wordIndex: 0 })).toBeNull();
  });
});

describe("bracketAnchorLineIndex", () => {
  it("finds the main line right before a single bracketed line", () => {
    const lines = [timed("a", "main", 2), untimed("b", "(bg)")];
    expect(bracketAnchorLineIndex(lines, 1)).toBe(0);
  });

  it("skips earlier bracketed lines to reach the main line", () => {
    const lines = [timed("a", "main", 2), timed("b", "(bg one)", 2.2), untimed("c", "(bg two)")];
    expect(bracketAnchorLineIndex(lines, 2)).toBe(0);
  });

  it("skips untimed lines", () => {
    const lines = [timed("a", "main", 2), untimed("b", "later"), untimed("c", "(bg)")];
    expect(bracketAnchorLineIndex(lines, 2)).toBe(0);
  });

  it("never anchors on a timed blank line", () => {
    const timedBlank = createLine({ id: "gap", text: "", begin: 3, end: 3.2 });
    const lines = [timed("a", "main", 2), timedBlank, untimed("c", "(bg)")];
    expect(bracketAnchorLineIndex(lines, 2)).toBe(0);
  });

  it("returns -1 when no timed main line precedes", () => {
    expect(bracketAnchorLineIndex([untimed("a", "(bg)")], 0)).toBe(-1);
  });
});

describe("overlapsPreviousLine", () => {
  const lines = [timed("a", "main", 2), untimed("b", "(bg)"), blank("c"), untimed("d", "next main")];

  it("is true on a bracketed line", () => {
    expect(overlapsPreviousLine(lines, 1)).toBe(true);
  });

  it("is true on a main line whose previous syncable line is bracketed", () => {
    expect(overlapsPreviousLine(lines, 3)).toBe(true);
  });

  it("is false on an ordinary main line", () => {
    expect(overlapsPreviousLine(lines, 0)).toBe(false);
    expect(overlapsPreviousLine([timed("a", "x", 1), untimed("b", "y")], 1)).toBe(false);
  });

  it("is false past the end", () => {
    expect(overlapsPreviousLine(lines, 4)).toBe(false);
  });
});

describe("bracketRewindTime", () => {
  const from = { lineIndex: 0, wordIndex: 1 };

  it("rewinds to the anchor start minus the preroll when advancing onto a bracketed line", () => {
    const lines = [timed("a", "main", 4), untimed("b", "(bg)")];
    expect(bracketRewindTime(lines, from, commitTo(1), 1.5)).toBe(2.5);
  });

  it("clamps at zero", () => {
    const lines = [timed("a", "main", 0.5), untimed("b", "(bg)")];
    expect(bracketRewindTime(lines, from, commitTo(1), 1.5)).toBe(0);
  });

  it("sees timing written by the same commit", () => {
    const lines: LyricLine[] = [untimed("a", "main"), untimed("b", "(bg)")];
    const commit = commitTo(1, [{ id: "a", updates: { begin: 6, end: 6 } }]);
    expect(bracketRewindTime(lines, { lineIndex: 0, wordIndex: 0 }, commit, 1)).toBe(5);
  });

  it("does nothing when the next line is not bracketed", () => {
    const lines = [timed("a", "main", 4), untimed("b", "next")];
    expect(bracketRewindTime(lines, from, commitTo(1), 1.5)).toBeNull();
  });

  it("does nothing when the cursor stayed on the same line", () => {
    const lines = [timed("a", "main", 4), untimed("b", "(bg)")];
    expect(
      bracketRewindTime(lines, from, { ...commitTo(0), nextCursor: { lineIndex: 0, wordIndex: 2 } }, 1.5),
    ).toBeNull();
  });

  it("does nothing when a bracketed first line has no anchor", () => {
    const lines = [untimed("a", "(bg)"), untimed("b", "(bg two)")];
    expect(bracketRewindTime(lines, { lineIndex: 0, wordIndex: 0 }, commitTo(1), 1.5)).toBeNull();
  });

  it("rewinds to the same main line across consecutive bracketed lines, then stops", () => {
    const lines = [
      timed("a", "main", 4),
      timed("b", "(bg one)", 4.2),
      untimed("c", "(bg two)"),
      untimed("d", "main two"),
    ];
    expect(bracketRewindTime(lines, { lineIndex: 1, wordIndex: 0 }, commitTo(2), 1)).toBe(3);
    expect(bracketRewindTime(lines, { lineIndex: 2, wordIndex: 0 }, commitTo(3), 1)).toBeNull();
  });
});
