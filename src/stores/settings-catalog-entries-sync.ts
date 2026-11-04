import type { SettingEntry } from "@/stores/settings-catalog";
import { pluralize } from "@/utils/pluralize";

// -- Helpers ------------------------------------------------------------------

function syncCountInDescription(seconds: number): string {
  if (seconds === 0) return "Playback starts right away in Sync.";
  return `Count down for ${pluralize(seconds, "second")} before Sync plays from the start of the song, so you are ready for the first word.`;
}

// -- Catalog ------------------------------------------------------------------

const SYNC_CATALOG_ENTRIES = {
  nudgeAmount: {
    section: "sync",
    label: "Nudge amount",
    description: "How far timing shifts when using nudge controls.",
    settingKey: "nudgeAmount",
  },
  defaultWordDuration: {
    section: "sync",
    label: "Default word duration",
    description: "Length assigned to newly created words in the timeline.",
    settingKey: "defaultWordDuration",
  },
  minWordDuration: {
    section: "sync",
    label: "Min word duration",
    description: "Shortest allowed duration for a word.",
    settingKey: "minWordDuration",
  },
  redoPreroll: {
    section: "sync",
    label: "Re-record pre-roll",
    description:
      "How far before the target line or word Sync starts playback after a jump, such as when you re-record a line or word, or when Sync skips past a repeat that already shares its timing.",
    settingKey: "redoPreroll",
  },
  syncCountIn: {
    section: "sync",
    label: "Count-in",
    descriptionFor: (state) => syncCountInDescription(state.syncCountIn),
    keywords: ["countdown", "pre-roll", "start delay"],
    settingKey: "syncCountIn",
  },
  undoRewindDuration: {
    section: "sync",
    label: "Undo rewind duration",
    description: "How far before the undone line playback jumps back when you undo a line in Sync.",
    keywords: ["undo", "rewind", "back", "r"],
    settingKey: "undoRewindDuration",
  },
  undoContinuePlayback: {
    section: "sync",
    label: "Continue playback on undo",
    description: "Keep the audio playing after undoing a line. Turn off to pause instead.",
    keywords: ["undo", "pause", "play"],
    settingKey: "undoContinuePlayback",
  },
  autoRewindForBracketedLines: {
    section: "sync",
    label: "Auto-rewind for bracketed lines",
    description:
      "When the next line is a bracketed background vocal, jump back to the start of the main line it overlaps so you can sync it.",
    keywords: ["background", "vocals", "brackets", "parentheses", "overlap", "rewind"],
    settingKey: "autoRewindForBracketedLines",
  },
  snapEarlyTaps: {
    section: "sync",
    label: "Snap early taps",
    description:
      "Move a tap that lands before the previous line's last word to that word instead. Leave off to let overlapping vocals start where you tap.",
    keywords: ["early", "tap", "snap", "overlap", "clamp", "duet", "vocals"],
    settingKey: "snapEarlyTaps",
  },
  defaultGranularity: {
    section: "sync",
    label: "Default granularity",
    description: "Whether new projects start in word or line timing mode.",
    settingKey: "defaultGranularity",
  },
} as const satisfies Record<string, SettingEntry>;

// -- Exports ------------------------------------------------------------------

export { SYNC_CATALOG_ENTRIES };
