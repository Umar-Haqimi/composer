import type { SettingEntry } from "@/stores/settings-catalog";

// Catalog entries for the sync undo and bracket auto-rewind settings. Kept in
// their own module so settings-catalog-entries.ts stays under the 300-line
// budget. Spread into SETTINGS_CATALOG right after redoPreroll.

const SYNC_UNDO_REWIND_ENTRIES = {
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
} as const satisfies Record<string, SettingEntry>;

export { SYNC_UNDO_REWIND_ENTRIES };
