import { applyLineUpdates } from "@/domain/line/apply-line-updates";
import type { LyricLine } from "@/domain/line/model";
import type { SyncGranularity } from "@/domain/line/sync-progress";
import {
  type BackgroundCommit,
  type BackgroundGesture,
  commitBackgroundGesture,
} from "@/domain/sync/background-gesture";
import { createLine } from "@/test/factories";
import { describe, expect, it } from "vitest";

const word = (text: string, begin: number, end: number) => ({ text, begin, end });

function run(
  lines: LyricLine[],
  gesture: BackgroundGesture,
  cursor: [number, number],
  time: number,
  granularity: SyncGranularity = "word",
): BackgroundCommit | null {
  return commitBackgroundGesture(lines, gesture, {
    cursor: { lineIndex: cursor[0], wordIndex: cursor[1] },
    time,
    granularity,
    pass: lines.map((_, index) => index),
  });
}

function applied(lines: LyricLine[], commit: BackgroundCommit | null): LyricLine[] {
  return commit ? applyLineUpdates(lines, commit.lineUpdates) : lines;
}

const echoLine = (fields: Partial<Parameters<typeof createLine>[0]> = {}) =>
  createLine({ id: "l0", text: "come back", begin: 10, end: 12, backgroundText: "come back now", ...fields });

describe("commitBackgroundGesture", () => {
  it("taps a background word without touching the lead, keeping every word and marking it manual", () => {
    const lines = [echoLine()];
    const commit = run(lines, "tap", [0, 0], 12);
    const [line] = applied(lines, commit);

    expect(line.begin).toBe(10);
    expect(line.backgroundTextSource).toBe("manual");
    expect(line.backgroundText).toBe("come back now");
    expect(line.backgroundWords?.map((w) => w.text)).toEqual(["come ", "back ", "now"]);
    expect(line.backgroundWords?.[0].begin).toBe(12);
    const words = line.backgroundWords ?? [];
    for (let i = 1; i < words.length; i++) expect(words[i].begin).toBeGreaterThanOrEqual(words[i - 1].end);
    expect(commit?.nextCursor).toEqual({ lineIndex: 0, wordIndex: 1 });
  });

  it("ends the previous background word where the next tap lands", () => {
    const lines = [
      echoLine({ backgroundWords: [word("come ", 12, 12.3), word("back ", 12.3, 12.6), word("now", 12.6, 12.9)] }),
    ];
    const [line] = applied(lines, run(lines, "tap", [0, 1], 13));
    expect(line.backgroundWords?.[0]).toEqual(word("come ", 12, 13));
    expect(line.backgroundWords?.[1].begin).toBe(13);
  });

  it("snaps a tap that lands before the previous background word to its start", () => {
    const lines = [
      echoLine({ backgroundWords: [word("come ", 12, 12.3), word("back ", 12.3, 12.6), word("now", 12.6, 12.9)] }),
    ];
    const commit = run(lines, "tap", [0, 1], 11);
    expect(commit?.clampedTo).toBe(12);
    expect(applied(lines, commit)[0].backgroundWords?.[1].begin).toBe(12);
  });

  it("holds a background word open and closes it on release", () => {
    let lines = [echoLine()];
    const start = run(lines, "hold-start", [0, 0], 12);
    lines = applied(lines, start);
    expect(lines[0].backgroundWords?.[0]).toEqual(word("come ", 12, 12));
    expect(start?.nextCursor).toEqual({ lineIndex: 0, wordIndex: 0 });

    const end = run(lines, "hold-end", [0, 0], 12.8);
    expect(applied(lines, end)[0].backgroundWords?.[0]).toEqual(word("come ", 12, 12.8));
    expect(end?.nextCursor).toEqual({ lineIndex: 0, wordIndex: 1 });
  });

  it("spreads a whole background phrase across one hold in line mode", () => {
    let lines = [echoLine(), createLine({ id: "l1", text: "next", begin: 20, end: 21, backgroundText: "ooh" })];
    lines = applied(lines, run(lines, "hold-start", [0, 0], 12, "line"));
    const end = run(lines, "hold-end", [0, 0], 14, "line");
    const words = applied(lines, end)[0].backgroundWords ?? [];

    expect(words.map((w) => w.text)).toEqual(["come ", "back ", "now"]);
    expect(words[0].begin).toBe(12);
    expect(words[words.length - 1].end).toBe(14);
    for (let i = 1; i < words.length; i++) expect(words[i].begin).toBeCloseTo(words[i - 1].end);
    expect(end?.nextCursor).toEqual({ lineIndex: 1, wordIndex: 0 });
  });
});
