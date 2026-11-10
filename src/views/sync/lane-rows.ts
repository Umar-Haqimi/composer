import { getAgentColor } from "@/domain/agent/colors";
import { agentDisplayName } from "@/domain/agent/display-name";
import type { Agent } from "@/domain/agent/model";
import type { LanguageDisplayLine } from "@/domain/language/display";
import type { LyricLine } from "@/domain/line/model";
import { backgroundSlots } from "@/domain/sync/background-pass";
import type { WordTiming } from "@/domain/word/timing";
import { splitIntoWords, splitIntoWordsWithMeta } from "@/utils/sync-helpers";
import type { LaneGroupTag } from "@/views/sync/shared-sync-tags";

// -- Interfaces ---------------------------------------------------------------

interface LaneSinger {
  name: string;
  color: string;
}

interface WordRun {
  start: number;
  end: number;
}

interface LaneRow {
  line: LyricLine;
  lineIndex: number;
  text: string;
  wordTexts: string[];
  wordRuns: WordRun[];
  backgroundText?: string;
  leadText?: string;
  singer?: LaneSinger;
  groupTag?: LaneGroupTag;
  folded: boolean;
}

interface LaneRowsInput {
  lines: readonly LyricLine[];
  displayLines: readonly LanguageDisplayLine[];
  agents: readonly Agent[];
  groupTags: ReadonlyMap<string, LaneGroupTag>;
  folded: ReadonlySet<string>;
  backgroundPass?: readonly number[];
}

type LaneTrackFields = Pick<LaneRow, "text" | "wordTexts" | "wordRuns" | "backgroundText" | "leadText">;

// -- Functions ----------------------------------------------------------------

function laneSinger(agentId: string, agents: readonly Agent[]): LaneSinger {
  const agent = agents.find((candidate) => candidate.id === agentId);
  return { name: agent ? agentDisplayName(agent) : agentId, color: getAgentColor(agentId) };
}

// Syllables split from one word share a run, so the lane spaces words apart and keeps syllables joined.
function wordRunsOf(text: string, slotCount: number): WordRun[] {
  const { trailingSpace } = splitIntoWordsWithMeta(text);
  const runs: WordRun[] = [];
  let start = 0;
  for (let index = 0; index < slotCount; index++) {
    const endsWord = trailingSpace.length !== slotCount || trailingSpace[index] || index === slotCount - 1;
    if (!endsWord) continue;
    runs.push({ start, end: index });
    start = index + 1;
  }
  return runs;
}

// Background syllables carry their spacing on the word text itself.
function slotRunsOf(slots: readonly WordTiming[]): WordRun[] {
  const runs: WordRun[] = [];
  let start = 0;
  slots.forEach((slot, index) => {
    if (!slot.text.endsWith(" ") && index < slots.length - 1) return;
    runs.push({ start, end: index });
    start = index + 1;
  });
  return runs;
}

function leadFields(line: LyricLine, display: LanguageDisplayLine): LaneTrackFields {
  const wordTexts = display.wordTexts ?? splitIntoWords(display.text);
  return {
    text: display.text,
    wordTexts,
    wordRuns: wordRunsOf(line.text, wordTexts.length),
    backgroundText: display.backgroundText,
  };
}

// The background pass taps background words, so they take the lead's place and the lead stays as context.
function backgroundFields(line: LyricLine, display: LanguageDisplayLine): LaneTrackFields {
  const slots = backgroundSlots(line);
  const shown = display.backgroundWordTexts;
  return {
    text: display.backgroundText ?? line.backgroundText ?? "",
    wordTexts: shown?.length === slots.length ? shown : slots.map((slot) => slot.text.trim()),
    wordRuns: slotRunsOf(slots),
    leadText: display.text,
  };
}

function buildLaneRows({ lines, displayLines, agents, groupTags, folded, backgroundPass }: LaneRowsInput): LaneRow[] {
  const showsSingers = new Set(lines.map((line) => line.agentId)).size > 1;
  const inPass = backgroundPass && new Set(backgroundPass);
  let previousAgentId: string | null = null;
  return lines.map((line, lineIndex) => {
    const display = displayLines[lineIndex] ?? line;
    const isFolded = inPass ? !inPass.has(lineIndex) : folded.has(line.id);
    const singerChanged = !isFolded && line.agentId !== previousAgentId;
    if (!isFolded) previousAgentId = line.agentId;
    return {
      line,
      lineIndex,
      ...(inPass ? backgroundFields(line, display) : leadFields(line, display)),
      singer: showsSingers && singerChanged ? laneSinger(line.agentId, agents) : undefined,
      groupTag: groupTags.get(line.id),
      folded: isFolded,
    };
  });
}

// -- Exports ------------------------------------------------------------------

export { buildLaneRows };
export type { LaneRow };
