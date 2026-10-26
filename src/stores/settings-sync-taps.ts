// Sync tap settings this fork adds: undo-and-rewind, bracketed-line
// auto-rewind and early-tap snapping. Kept in their own module so settings.ts
// stays under the 300-line budget.

// -- Types ---------------------------------------------------------------------

interface SyncTapSettings {
  undoRewindDuration: number;
  undoContinuePlayback: boolean;
  autoRewindForBracketedLines: boolean;
  snapEarlyTaps: boolean;
}

// -- Defaults ------------------------------------------------------------------

const SYNC_TAP_DEFAULTS: SyncTapSettings = {
  undoRewindDuration: 3,
  undoContinuePlayback: true,
  autoRewindForBracketedLines: true,
  // Off lets an early tap overlap the line before it instead of snapping to that line's last word.
  snapEarlyTaps: false,
};

// -- Exports -------------------------------------------------------------------

export { SYNC_TAP_DEFAULTS };
export type { SyncTapSettings };
