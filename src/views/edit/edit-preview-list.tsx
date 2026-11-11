import type { LinkGroup } from "@/domain/group/template";
import { instanceOrdinal } from "@/domain/instance/enumerate";
import type { LyricLine } from "@/domain/line/model";
import { pluralize } from "@/utils/pluralize";
import { LinePreview, type LinePreviewHandlers, PreviewGroupHeader } from "@/views/edit/line-preview";
import type { ParsedLine } from "@/views/edit/parse-lyrics";

// -- Interfaces ---------------------------------------------------------------

interface EditPreviewListProps extends LinePreviewHandlers {
  parsed: readonly ParsedLine[];
  lines: readonly LyricLine[];
  groups: readonly LinkGroup[];
  agents: { id: string; name?: string }[];
  instanceCountByGroup: ReadonlyMap<string, number>;
  selectedLines: ReadonlySet<number>;
  currentLineNumber: number | null;
}

// -- Components ---------------------------------------------------------------

const EditPreviewList: React.FC<EditPreviewListProps> = ({
  parsed,
  lines,
  groups,
  agents,
  instanceCountByGroup,
  selectedLines,
  currentLineNumber,
  onSelect,
  onAgentChange,
  onBulkAgentChange,
  onBackgroundChange,
  onExtractLine,
  onGutterMouseDown,
  onGutterMouseEnter,
  didDragRef,
}) => {
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
        const totalInstances = group ? (instanceCountByGroup.get(group.id) ?? 0) : 0;
        const groupTooltip =
          group && totalInstances > 1
            ? `Part of ${group.label} · linked to ${pluralize(totalInstances - 1, "other instance")}. Edits propagate.`
            : undefined;
        return (
          <div key={line.lineNumber}>
            {isFirstOfInstance && group && line.instanceIdx !== undefined && (
              <PreviewGroupHeader
                label={group.label}
                ordinal={instanceOrdinal(lines, group.id, line.instanceIdx)}
                total={totalInstances}
                color={group.color}
              />
            )}
            <LinePreview
              line={line}
              agents={agents}
              isSelected={selectedLines.has(line.lineNumber)}
              isCurrent={line.lineNumber === currentLineNumber}
              hasMultipleSelected={selectedLines.size > 1}
              groupColor={group?.color}
              groupTooltip={groupTooltip}
              onSelect={onSelect}
              onAgentChange={onAgentChange}
              onBulkAgentChange={onBulkAgentChange}
              onBackgroundChange={onBackgroundChange}
              onExtractLine={onExtractLine}
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

export { EditPreviewList };
