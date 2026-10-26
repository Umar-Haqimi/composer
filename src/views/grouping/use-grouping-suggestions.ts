import { useAudioStore } from "@/stores/audio";
import { useProjectStore } from "@/stores/project";
import { hiddenByDismissal } from "@/ui/notices/notice-model";
import { replacedOwnTimingNote, showGroupActionToast, showKeptOwnTimingToast } from "@/utils/group-toast";
import { type RepeatingSection, findRepeatingStandaloneSections } from "@/views/grouping/repeating-sections";
import { useMemo } from "react";

// The header notice and the edit preview's ghost groups both read this, so they always agree.
function useVisibleGroupingSuggestions(enabled = true) {
  const lines = useProjectStore((s) => s.lines);
  const dismissed = useProjectStore((s) => s.dismissedSuggestions);

  const suggestions = useMemo(() => (enabled ? findRepeatingStandaloneSections(lines) : []), [enabled, lines]);
  return useMemo(() => hiddenByDismissal(suggestions, dismissed), [suggestions, dismissed]);
}

function groupSections(sections: readonly RepeatingSection[]): number {
  const { duration } = useAudioStore.getState();
  const { groupRepeatingSections } = useProjectStore.getState();
  const outcomes = sections.map((section) => groupRepeatingSections(section.starts, section.length, { duration }));
  showKeptOwnTimingToast(
    outcomes.flatMap((outcome) => outcome.keptOwnTiming),
    "edit",
  );
  return outcomes.reduce((sum, outcome) => sum + outcome.replaced.length, 0);
}

function acceptSuggestion(section: RepeatingSection): void {
  const replaced = groupSections([section]);
  if (replaced > 0) showGroupActionToast(replacedOwnTimingNote(replaced));
}

function dismissSuggestions(fingerprints: readonly string[]): void {
  const { dismissSuggestion } = useProjectStore.getState();
  for (const fingerprint of fingerprints) dismissSuggestion(fingerprint);
}

export { acceptSuggestion, dismissSuggestions, groupSections, useVisibleGroupingSuggestions };
