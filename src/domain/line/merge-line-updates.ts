import type { LineUpdate, LooseLine, LyricLine } from "@/domain/line/model";

// Narrows like reconcileLine for timed words, so one merged update lands the same as the two applied in order.
function mergeLineUpdate(first: Partial<LyricLine>, second: Partial<LyricLine>): Partial<LyricLine> {
  const merged: Partial<LooseLine> = { ...first, ...second };
  const { words, begin, end, ...rest } = merged;
  if (words !== undefined) return { ...rest, words };
  return {
    ...rest,
    ...("words" in merged ? { words } : {}),
    ...("begin" in merged ? { begin } : {}),
    ...("end" in merged ? { end } : {}),
  };
}

function mergeUpdates(a: readonly LineUpdate[], b: readonly LineUpdate[]): LineUpdate[] {
  const merged = new Map(a.map((u) => [u.id, u.updates]));
  for (const u of b) {
    const earlier = merged.get(u.id);
    merged.set(u.id, earlier ? mergeLineUpdate(earlier, u.updates) : u.updates);
  }
  return [...merged].map(([id, updates]) => ({ id, updates }));
}

// -- Exports ------------------------------------------------------------------

export { mergeUpdates };
