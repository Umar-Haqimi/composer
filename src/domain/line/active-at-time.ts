import { effectiveBounds } from "@/domain/line/bounds";
import type { LyricLine } from "@/domain/line/model";

// -- Functions ----------------------------------------------------------------

// Ids of every synced line whose span (including background vocals) contains `time`.
function lineIdsActiveAt(lines: readonly LyricLine[], time: number): string[] {
  const ids: string[] = [];
  for (const line of lines) {
    const bounds = effectiveBounds(line);
    if (bounds && time >= bounds.begin && time < bounds.end) ids.push(line.id);
  }
  return ids;
}

// -- Exports ------------------------------------------------------------------

export { lineIdsActiveAt };
