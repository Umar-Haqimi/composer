import { Button } from "@/ui/button";
import { IconButton } from "@/ui/icon-button";
import { cn } from "@/utils/cn";
import { ROW_BODY } from "@/views/edit/line-preview";
import { IconBulb, IconLink, IconX } from "@tabler/icons-react";

// -- Constants ----------------------------------------------------------------

const GHOST_COLOR = "var(--color-composer-accent)";

const BAND_TONES = {
  group: {
    gutter:
      "bg-[color-mix(in_oklab,var(--group)_10%,var(--gutter-bg))] shadow-[inset_-2px_0_0_color-mix(in_oklab,var(--group)_45%,var(--gutter-bg)),inset_0_-1px_0_var(--divider)]",
    body: "bg-[color-mix(in_oklab,var(--group)_9%,transparent)]",
  },
  ghost: {
    gutter:
      "bg-[color-mix(in_oklab,var(--group)_4%,var(--gutter-bg))] shadow-[inset_-2px_0_0_color-mix(in_oklab,var(--group)_20%,var(--gutter-bg)),inset_0_-1px_0_var(--divider)]",
    body: "bg-[color-mix(in_oklab,var(--group)_4%,transparent)]",
  },
} as const;

// -- Components ---------------------------------------------------------------

const GroupBand: React.FC<{
  tone: keyof typeof BAND_TONES;
  color: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ tone, color, icon, children }) => (
  <div className="flex h-[26px] select-none" style={{ "--group": color }} data-group-band={tone}>
    <span className={cn("grid place-items-center w-11 shrink-0", BAND_TONES[tone].gutter)} aria-hidden>
      {icon}
    </span>
    <span className={cn(ROW_BODY, "gap-1.5 text-[11.5px] text-(--muted)", BAND_TONES[tone].body)}>{children}</span>
  </div>
);

const RunOrdinal: React.FC<{ ordinal: number; total: number }> = ({ ordinal, total }) => (
  <span className="shrink-0 tabular-nums">
    ・ {ordinal} of {total}
  </span>
);

const PreviewGroupHeader: React.FC<{ label: string; ordinal: number; total: number; color: string }> = ({
  label,
  ordinal,
  total,
  color,
}) => (
  <GroupBand tone="group" color={color} icon={<IconLink className="size-[13px] text-(--group)" />}>
    <b className="min-w-0 truncate font-semibold text-(--group)">{label}</b>
    <RunOrdinal ordinal={ordinal} total={total} />
  </GroupBand>
);

const GhostGroupHeader: React.FC<{ ordinal: number; total: number; onGroup: () => void; onDismiss: () => void }> = ({
  ordinal,
  total,
  onGroup,
  onDismiss,
}) => (
  <GroupBand tone="ghost" color={GHOST_COLOR} icon={<IconBulb className="size-[13px] text-(--group) opacity-70" />}>
    <span className="min-w-0 truncate italic text-(--muted)">Suggested group</span>
    <RunOrdinal ordinal={ordinal} total={total} />
    <span className="flex items-center gap-0.5 ml-auto shrink-0">
      <Button
        variant="ghost"
        hasIcon
        aria-label="Group suggested lines"
        title="Group these repeated lines"
        onClick={onGroup}
        className="h-5 pl-1 pr-1.5 gap-1 rounded-md text-[11.5px]"
      >
        <IconLink className="size-3" />
        Group
      </Button>
      <IconButton
        label="Dismiss suggested group"
        icon={<IconX className="size-3" />}
        variant="ghost"
        onClick={onDismiss}
        className="size-5 rounded-md"
      />
    </span>
  </GroupBand>
);

// -- Exports ------------------------------------------------------------------

export { GHOST_COLOR, GhostGroupHeader, PreviewGroupHeader };
