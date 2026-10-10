import type { LineSyncedLine, LyricLine } from "@/domain/line/model";
import { stripSplitCharacter } from "@/utils/split-character";

// -- Predicates ---------------------------------------------------------------

function isLineSynced(line: LyricLine): line is LineSyncedLine {
  return !line.words?.length && line.begin !== undefined && line.end !== undefined;
}

function isWordSynced(line: LyricLine): boolean {
  return !!line.words?.length;
}

function hasAnyTiming(line: LyricLine): boolean {
  return isWordSynced(line) || isLineSynced(line) || !!line.backgroundWords?.length;
}

function hasMainLyrics(line: LyricLine): boolean {
  return stripSplitCharacter(line.text).trim().length > 0;
}

// A whole line wrapped in parentheses is a background vocal that overlaps the main line before it.
function isBracketedLine(line: LyricLine | undefined): boolean {
  if (!line) return false;
  const text = line.text.trim();
  return text.length >= 2 && text.startsWith("(") && text.endsWith(")");
}

// -- Exports ------------------------------------------------------------------

export { hasAnyTiming, hasMainLyrics, isBracketedLine, isLineSynced, isWordSynced };
