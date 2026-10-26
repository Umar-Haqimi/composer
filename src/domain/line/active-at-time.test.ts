import { lineIdsActiveAt } from "@/domain/line/active-at-time";
import { type LooseLine, reconcileLine } from "@/domain/line/model";
import { describe, expect, it } from "vitest";

// -- Helpers ------------------------------------------------------------------

function line(id: string, extras: Partial<LooseLine> = {}) {
  return reconcileLine({ id, text: "Hello", agentId: "v1", ...extras });
}

// -- lineIdsActiveAt ----------------------------------------------------------

describe("lineIdsActiveAt", () => {
  const lines = [
    line("a", { begin: 1, end: 3 }),
    line("b", { words: [{ text: "hi", begin: 3, end: 5 }] }),
    line("c"),
    line("d", { begin: 4, end: 6 }),
  ];

  it("returns the line containing the time", () => {
    expect(lineIdsActiveAt(lines, 2)).toEqual(["a"]);
  });

  it("treats end as exclusive", () => {
    expect(lineIdsActiveAt(lines, 3)).toEqual(["b"]);
  });

  it("returns every overlapping line", () => {
    expect(lineIdsActiveAt(lines, 4.5)).toEqual(["b", "d"]);
  });

  it("returns nothing between or outside synced lines", () => {
    expect(lineIdsActiveAt(lines, 0.5)).toEqual([]);
    expect(lineIdsActiveAt(lines, 10)).toEqual([]);
  });
});
