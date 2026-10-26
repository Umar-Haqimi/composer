import type { LyricLine } from "@/domain/line/model";
import type { RepeatingSection } from "@/views/grouping/repeating-sections";

interface GhostRun {
  section: RepeatingSection;
  ordinal: number;
  isFirstLine: boolean;
}

// Keyed by line id, not row index, so a preview that lags a pending text edit never shifts a ghost onto the wrong row.
function ghostRunsByLineId(sections: readonly RepeatingSection[], lines: readonly LyricLine[]): Map<string, GhostRun> {
  const runs = new Map<string, GhostRun>();
  for (const section of sections) {
    section.starts.forEach((start, runIdx) => {
      for (let offset = 0; offset < section.length; offset++) {
        const line = lines[start + offset];
        if (line) runs.set(line.id, { section, ordinal: runIdx + 1, isFirstLine: offset === 0 });
      }
    });
  }
  return runs;
}

export { ghostRunsByLineId };
