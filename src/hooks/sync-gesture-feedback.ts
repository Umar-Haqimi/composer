import { noteGuideSignal } from "@/lib/guide-signals";
import { formatTimeMs } from "@/utils/sync-helpers";
import { toast } from "sonner";

// -- Constants ------------------------------------------------------------------

const EARLY_TAP_TOAST_ID = "sync-early-tap";

// -- Functions ------------------------------------------------------------------

function toastEarlyTap(clampedTo: number | null): void {
  if (clampedTo === null) return;
  toast(`Early tap snapped to ${formatTimeMs(clampedTo)}`, { id: EARLY_TAP_TOAST_ID });
  noteGuideSignal("sync.earlyTap");
}

function triggerPulse(setShowPulse: (show: boolean) => void): void {
  setShowPulse(true);
  setTimeout(() => setShowPulse(false), 100);
}

// -- Exports ------------------------------------------------------------------

export { toastEarlyTap, triggerPulse };
