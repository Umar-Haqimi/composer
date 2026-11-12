import type { LinkGroup } from "@/domain/group/template";
import { instanceCount, instanceOrdinal } from "@/domain/instance/enumerate";
import { backgroundFields, withSeededBackground } from "@/domain/line/background";
import { remapWordTextsPreservingTiming } from "@/domain/word/remap-text";
import type { WordTiming } from "@/domain/word/timing";
import { noteGuideSignal } from "@/lib/guide-signals";
import { useProjectStore } from "@/stores/project";
import { useSettingsStore } from "@/stores/settings";
import { extractInlineAcrossLinkedLines } from "@/utils/background-vocal-extraction";
import { pluralize } from "@/utils/pluralize";
import { LinePreview } from "@/views/edit/line-preview";
import type { ParsedLine } from "@/views/edit/parse-lyrics";
import { GHOST_COLOR, GhostGroupHeader, PreviewGroupHeader } from "@/views/edit/preview-group-header";
import { ghostRunsByLineId } from "@/views/grouping/ghost-runs";
import {
  acceptSuggestion,
  dismissSuggestions,
  useVisibleGroupingSuggestions,
} from "@/views/grouping/use-grouping-suggestions";
import { useMemo, useState } from "react";

// -- Interfaces ---------------------------------------------------------------

interface PreviewRowsProps {
  parsed: ParsedLine[];
  // Matches the header notice, which hides suggestions while the lyrics are being typed.
  showSuggestions: boolean;
  selectedLines: ReadonlySet<number>;
  playingLineIds: ReadonlySet<string>;
  onSelect: (lineNumber: number, shiftKey: boolean) => void;
  onBulkAgentChange: (agentId: string) => void;
  onGutterMouseDown: (lineNumber: number, e: React.MouseEvent) => void;
  onGutterMouseEnter: (lineNumber: number, e: React.MouseEvent) => void;
  didDragRef: React.MutableRefObject<boolean>;
}

// -- Handlers -----------------------------------------------------------------

function handleAgentChange(lineId: string, agentId: string): void {
  useProjectStore.getState().updateLineWithHistory(lineId, { agentId });
  noteGuideSignal("edit.singer");
  noteGuideSignal("edit.singerOneLine");
}

function handleBackgroundChange(lineId: string, text: string): void {
  const newBgText = text || undefined;
  const target = useProjectStore.getState().lines.find((l) => l.id === lineId);

  let words: WordTiming[] | undefined;
  if (newBgText && target?.backgroundWords?.length) {
    words = remapWordTextsPreservingTiming(target.backgroundWords, newBgText);
  } else if (newBgText && target) {
    words = withSeededBackground({ ...target, backgroundText: newBgText }).backgroundWords;
  }

  useProjectStore
    .getState()
    .updateLineWithHistory(lineId, backgroundFields({ text: newBgText, words, source: "manual" }));
  if (newBgText) noteGuideSignal("edit.background");
}

function handleExtractLine(lineId: string): void {
  const updates = extractInlineAcrossLinkedLines(useProjectStore.getState().lines, lineId, {
    mergeStandaloneLines: false,
    preserveBrackets: useSettingsStore.getState().preserveBracketsOnExtraction,
  });
  if (updates.length === 0) return;
  useProjectStore.getState().updateLinesWithHistory(updates, { propagateToSiblings: false });
  noteGuideSignal("edit.background");
  noteGuideSignal("edit.extractOneLine");
}

function renameGroup(group: LinkGroup, next: string): void {
  const trimmed = next.trim();
  if (trimmed.length > 0 && trimmed !== group.label)
    useProjectStore.getState().updateGroup(group.id, { label: trimmed });
}

// -- Components ---------------------------------------------------------------

const PreviewRows: React.FC<PreviewRowsProps> = ({
  parsed,
  showSuggestions,
  selectedLines,
  playingLineIds,
  onSelect,
  onBulkAgentChange,
  onGutterMouseDown,
  onGutterMouseEnter,
  didDragRef,
}) => {
  const agents = useProjectStore((s) => s.agents);
  const splitCharacter = useSettingsStore((s) => s.splitCharacter);
  const editsSelection = selectedLines.size > 1;
  const lines = useProjectStore((s) => s.lines);
  const groups = useProjectStore((s) => s.groups);
  const instanceCountByGroup = useMemo(
    () => new Map(groups.map((g) => [g.id, instanceCount(lines, g.id)])),
    [groups, lines],
  );
  // Keyed by group and instance so only the double-clicked header turns into an input.
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const { visible: suggestions } = useVisibleGroupingSuggestions(showSuggestions);
  const ghostRuns = useMemo(() => ghostRunsByLineId(suggestions, lines), [suggestions, lines]);

  if (parsed.length === 0 || (parsed.length === 1 && parsed[0].isEmpty)) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-(--muted)">Lyrics will appear here</div>
    );
  }

  return (
    <div>
      {parsed.map((line, index) => {
        const prev = index > 0 ? parsed[index - 1] : null;
        const isFirstOfInstance =
          line.groupId !== undefined &&
          line.instanceIdx !== undefined &&
          (prev?.groupId !== line.groupId || prev?.instanceIdx !== line.instanceIdx);
        const group = line.groupId ? groups.find((g) => g.id === line.groupId) : undefined;
        const ghost = group ? undefined : ghostRuns.get(line.lineId);
        const totalInstances = group ? (instanceCountByGroup.get(group.id) ?? 0) : 0;
        const groupTooltip =
          group && totalInstances > 1
            ? `Part of ${group.label} · linked to ${pluralize(totalInstances - 1, "other instance")}. Edits propagate.`
            : undefined;
        const isSelected = selectedLines.has(line.lineNumber);
        return (
          <div key={line.lineNumber}>
            {isFirstOfInstance && group && line.instanceIdx !== undefined && (
              <PreviewGroupHeader
                label={group.label}
                ordinal={instanceOrdinal(lines, group.id, line.instanceIdx)}
                total={totalInstances}
                color={group.color}
                isRenaming={renamingKey === `${group.id}:${line.instanceIdx}`}
                onStartRename={() => setRenamingKey(`${group.id}:${line.instanceIdx}`)}
                onCommitRename={(next) => {
                  renameGroup(group, next);
                  setRenamingKey(null);
                }}
                onCancelRename={() => setRenamingKey(null)}
              />
            )}
            {ghost?.isFirstLine && (
              <GhostGroupHeader
                ordinal={ghost.ordinal}
                total={ghost.section.starts.length}
                onGroup={() => acceptSuggestion(ghost.section)}
                onDismiss={() => dismissSuggestions([ghost.section.fingerprint])}
              />
            )}
            <LinePreview
              line={line}
              agents={agents}
              isSelected={isSelected}
              isPlaying={playingLineIds.has(line.lineId)}
              splitCharacter={splitCharacter}
              groupColor={group?.color ?? (ghost ? GHOST_COLOR : undefined)}
              isGhostGroup={ghost !== undefined}
              groupTooltip={groupTooltip}
              onSelect={onSelect}
              onAgentChange={handleAgentChange}
              onBulkAgentChange={isSelected && editsSelection ? onBulkAgentChange : undefined}
              onBackgroundChange={handleBackgroundChange}
              onExtractLine={handleExtractLine}
              onGutterMouseDown={onGutterMouseDown}
              onGutterMouseEnter={onGutterMouseEnter}
              didDragRef={didDragRef}
            />
          </div>
        );
      })}
    </div>
  );
};

// -- Exports ------------------------------------------------------------------

export { PreviewRows };
