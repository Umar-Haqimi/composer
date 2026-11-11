import {
  advanceBackgroundCursor,
  backgroundPassLineIndices,
  backgroundSkipTarget,
  retreatBackgroundCursor,
} from "@/domain/sync/background-pass";
import { createGroup, createLine } from "@/test/factories";
import { describe, expect, it } from "vitest";

const word = (text: string, begin: number, end: number) => ({ text, begin, end });

describe("backgroundPassLineIndices", () => {
  it("visits timed lines with background text once per shared template line", () => {
    const group = createGroup({ id: "g", sharesTiming: true });
    const chorus = (instanceIdx: number, begin: number) =>
      createLine({
        id: `c${instanceIdx}`,
        text: "hold on",
        begin,
        end: begin + 1,
        backgroundText: "hold on",
        groupId: "g",
        instanceIdx,
        templateLineIdx: 0,
      });
    const lines = [
      createLine({ id: "plain", text: "no echo", begin: 0, end: 1 }),
      createLine({ id: "untimed", text: "later", backgroundText: "ooh" }),
      chorus(0, 5),
      createLine({ id: "verse", text: "walk", begin: 8, end: 9, backgroundText: "yeah" }),
      chorus(1, 12),
    ];

    expect(backgroundPassLineIndices(lines, [group])).toEqual([2, 3]);
  });
});

describe("background cursor", () => {
  const lines = [
    createLine({ id: "a", text: "one", begin: 0, end: 1, backgroundText: "oh yeah" }),
    createLine({ id: "skip", text: "two", begin: 2, end: 3 }),
    createLine({
      id: "b",
      text: "three",
      begin: 4,
      end: 5,
      backgroundText: "hey",
      backgroundWords: [word("hey", 4.5, 4.8)],
    }),
  ];
  const pass = [0, 2];

  it("walks background words, then jumps to the next background line and past the end", () => {
    let cursor = { lineIndex: 0, wordIndex: 0 };
    const visited = [cursor];
    for (let step = 0; step < 3; step++) {
      cursor = advanceBackgroundCursor(lines, pass, cursor, "word");
      visited.push(cursor);
    }
    expect(visited).toEqual([
      { lineIndex: 0, wordIndex: 0 },
      { lineIndex: 0, wordIndex: 1 },
      { lineIndex: 2, wordIndex: 0 },
      { lineIndex: 3, wordIndex: 0 },
    ]);
  });

  it("steps back to the last background word of the previous background line", () => {
    expect(retreatBackgroundCursor(lines, pass, { lineIndex: 2, wordIndex: 0 }, "word")).toEqual({
      lineIndex: 0,
      wordIndex: 1,
    });
    expect(retreatBackgroundCursor(lines, pass, { lineIndex: 3, wordIndex: 0 }, "line")).toEqual({
      lineIndex: 2,
      wordIndex: 0,
    });
  });

  it("skips forward to the next background line's lead start minus pre-roll, never backwards", () => {
    const next = { lineIndex: 2, wordIndex: 0 };
    expect(backgroundSkipTarget(lines, next, "word", 1, 1.5)).toBe(2.5);
    expect(backgroundSkipTarget(lines, next, "word", 3, 1.5)).toBeNull();
    expect(backgroundSkipTarget(lines, { lineIndex: 0, wordIndex: 1 }, "word", -5, 1.5)).toBeNull();
  });
});
