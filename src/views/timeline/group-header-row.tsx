import type { LinkGroup } from "@/domain/group/template";
import { useProjectStore } from "@/stores/project";
import { RenameInput } from "@/ui/rename-input";
import { GroupBanner } from "@/views/timeline/group-banner";
import { useTimelineStore } from "@/views/timeline/timeline-store";
import { memo, useCallback } from "react";

// -- Types ---------------------------------------------------------------------

interface GroupHeaderRowProps {
  group: LinkGroup;
  instanceIdx: number;
  ordinal: number;
  totalInstances: number;
  instanceStart: number;
  instanceEnd: number;
}

// -- Constants -----------------------------------------------------------------

const GROUP_HEADER_HEIGHT = 30;

// -- Component -----------------------------------------------------------------

const GroupHeaderRowComponent: React.FC<GroupHeaderRowProps> = ({
  group,
  instanceIdx,
  ordinal,
  totalInstances,
  instanceStart,
  instanceEnd,
}) => {
  const zoom = useTimelineStore((s) => s.zoom);
  const collapsedInstances = useTimelineStore((s) => s.collapsedInstances);
  const setContextMenu = useTimelineStore((s) => s.setContextMenu);
  const clearContextMenu = useTimelineStore((s) => s.clearContextMenu);
  const renamingGroupId = useTimelineStore((s) => s.renamingGroupId);
  const renamingInstanceIdx = useTimelineStore((s) => s.renamingInstanceIdx);
  const setRenamingGroupId = useTimelineStore((s) => s.setRenamingGroupId);
  const isCollapsed = collapsedInstances[`${group.id}:${instanceIdx}`] ?? false;
  const renaming = renamingGroupId === group.id && renamingInstanceIdx === instanceIdx;

  const openGroupMenuAt = useCallback(
    (x: number, y: number) => {
      setContextMenu({ x, y, target: { kind: "group-banner", groupId: group.id, instanceIdx, source: "gutter" } });
    },
    [group.id, instanceIdx, setContextMenu],
  );

  // The menu opens beside the label, so the second click of a double-click reaches the label and renames.
  const openGroupMenuBeside = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.detail > 1) return;
      const rect = e.currentTarget.getBoundingClientRect();
      openGroupMenuAt(rect.right, rect.top);
    },
    [openGroupMenuAt],
  );

  const openGroupMenuAtPointer = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openGroupMenuAt(e.clientX, e.clientY);
    },
    [openGroupMenuAt],
  );

  const startRename = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      clearContextMenu();
      setRenamingGroupId(group.id, instanceIdx);
    },
    [clearContextMenu, group.id, instanceIdx, setRenamingGroupId],
  );

  const commitRename = useCallback(
    (nextValue: string) => {
      const trimmed = nextValue.trim();
      if (trimmed.length > 0 && trimmed !== group.label) {
        useProjectStore.getState().updateGroup(group.id, { label: trimmed });
      }
      setRenamingGroupId(null);
    },
    [group.id, group.label, setRenamingGroupId],
  );

  const cancelRename = useCallback(() => {
    setRenamingGroupId(null);
  }, [setRenamingGroupId]);

  return (
    <div
      className="relative flex"
      style={{ height: GROUP_HEADER_HEIGHT }}
      data-group-header={`${group.id}:${instanceIdx}`}
      data-group-id={group.id}
      data-instance-idx={instanceIdx}
      onDoubleClick={renaming ? undefined : startRename}
    >
      <div
        className="shrink-0 w-12 sticky left-0 z-[60] flex items-center justify-center select-none overflow-hidden"
        style={{
          background: `color-mix(in oklab, ${group.color} 12%, var(--gutter-bg))`,
          boxShadow: `inset 0 1px 0 color-mix(in oklab, ${group.color} 30%, transparent), inset -2px 0 0 color-mix(in oklab, ${group.color} 60%, color-mix(in oklab, ${group.color} 12%, var(--gutter-bg))), inset 0 -1px 0 var(--divider)`,
        }}
      >
        {renaming ? (
          <RenameInput
            initialValue={group.label}
            onCommit={commitRename}
            onCancel={cancelRename}
            ariaLabel="Group name"
            className="w-full text-[10px] text-center leading-none"
          />
        ) : (
          <button
            type="button"
            onClick={openGroupMenuBeside}
            onContextMenu={openGroupMenuAtPointer}
            className="w-full h-full flex items-center justify-center cursor-pointer hover:brightness-110"
            title={`${group.label} · ${ordinal} of ${totalInstances}`}
          >
            <span className="max-w-full pl-1 pr-1.5 text-[10px] font-semibold text-composer-text truncate leading-none">
              {group.label}
            </span>
          </button>
        )}
      </div>
      <div
        className="flex-1 overflow-hidden border-b border-(--divider) relative"
        style={{
          background: `color-mix(in oklab, ${group.color} 9%, transparent)`,
          boxShadow: `inset 0 1px 0 color-mix(in oklab, ${group.color} 30%, transparent)`,
        }}
      >
        <GroupBanner
          group={group}
          instanceIdx={instanceIdx}
          ordinal={ordinal}
          totalInstances={totalInstances}
          instanceStart={instanceStart}
          instanceEnd={instanceEnd}
          isCollapsed={isCollapsed}
          zoom={zoom}
        />
      </div>
    </div>
  );
};

const GroupHeaderRow = memo(GroupHeaderRowComponent);

// -- Exports -------------------------------------------------------------------

export { GroupHeaderRow, GROUP_HEADER_HEIGHT };
