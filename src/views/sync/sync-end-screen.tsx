import { useProjectStore } from "@/stores/project";
import { useSettingsStore } from "@/stores/settings";
import { getEffectiveKeysArray } from "@/stores/shortcut-bindings";
import { Button } from "@/ui/button";
import { InlineKeyBadge } from "@/ui/inline-key-badge";
import { shimmerTransition, shimmerVariants } from "@/utils/animationVariants";
import { readToken } from "@/utils/theme/read-token";
import { pluralize } from "@/utils/pluralize";
import { IconMicrophone2, IconTimeline } from "@tabler/icons-react";
import { m } from "motion/react";

// -- Interfaces ---------------------------------------------------------------

interface SyncEndScreenProps {
  syncComplete: boolean;
  background: BackgroundEnd;
}

interface BackgroundEnd {
  passComplete: boolean;
  lineCount: number;
  onStart: () => void;
}

// -- Components ---------------------------------------------------------------

const SyncCompleteMessage: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const shimmerBase = readToken("accent-text");
  const shimmerHighlight = readToken("text");
  const completeGradient = `linear-gradient(45deg, ${shimmerBase} 0%, ${shimmerBase} 40%, ${shimmerHighlight} 50%, ${shimmerBase} 60%, ${shimmerBase} 100%)`;
  return (
    <div className="text-center">
      {/* react-doctor-disable-next-line react-doctor/no-gradient-text */}
      <m.div
        className="mb-2 text-2xl font-medium"
        variants={shimmerVariants}
        initial="initial"
        animate="animate"
        transition={shimmerTransition}
        style={{
          background: completeGradient,
          backgroundSize: "200% 100%",
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          color: "transparent",
        }}
      >
        {title}
      </m.div>
      {children}
    </div>
  );
};

const OpenTimelineButton: React.FC = () => {
  const showShortcutHints = useSettingsStore((s) => s.showShortcutHints);
  return (
    <Button
      hasIcon
      size="lg"
      className={showShortcutHints ? "pr-2.5 [&>[data-inline-key-badge]]:ml-0" : undefined}
      onClick={() => useProjectStore.getState().setActiveTab("timeline")}
    >
      <IconTimeline className="size-4" />
      Open Timeline
      {showShortcutHints && <InlineKeyBadge keys={getEffectiveKeysArray("global.goToTimeline")} />}
    </Button>
  );
};

// Finishing the lead is when background vocals become worth syncing, so the end screen offers the second pass.
const LeadCompleteMessage: React.FC<{ background: BackgroundEnd }> = ({ background }) => (
  <SyncCompleteMessage title="Sync complete!">
    {background.lineCount > 0 ? (
      <>
        <div className="text-composer-text-muted">
          Every lead line has its timing. {pluralize(background.lineCount, "line has", "lines have")} background vocals
          to sync next.
        </div>
        <div className="mt-5 flex justify-center gap-3">
          <Button hasIcon size="lg" variant="primary" onClick={background.onStart}>
            <IconMicrophone2 className="size-4" />
            Sync background vocals
          </Button>
          <OpenTimelineButton />
        </div>
      </>
    ) : (
      <>
        <div className="text-composer-text-muted">
          Every line has its timing. Open the Timeline to nudge anything that feels off.
        </div>
        <div className="mt-5">
          <OpenTimelineButton />
        </div>
      </>
    )}
  </SyncCompleteMessage>
);

const SyncEndScreen: React.FC<SyncEndScreenProps> = ({ syncComplete, background }) => (
  <div className="flex flex-col items-center justify-center flex-1 px-12 py-12">
    {background.passComplete ? (
      <SyncCompleteMessage title="Background vocals synced!">
        <div className="text-composer-text-muted">
          Every background line has its timing. Open the Timeline to nudge anything that feels off.
        </div>
        <div className="mt-5">
          <OpenTimelineButton />
        </div>
      </SyncCompleteMessage>
    ) : syncComplete ? (
      <LeadCompleteMessage background={background} />
    ) : (
      <div className="text-center">
        <div className="mb-2 text-2xl font-medium text-composer-text">You've reached the end</div>
        <div className="text-composer-text-muted">A few lines still need timing. Pause and click one to sync it.</div>
      </div>
    )}
  </div>
);

// -- Exports ------------------------------------------------------------------

export { SyncEndScreen };
