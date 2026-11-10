// -- Types --------------------------------------------------------------------

interface CobaltInstance {
  id: string;
  label: string;
  url: string;
}

interface CobaltInstanceStatus {
  status: "success" | "error";
  errorMessage?: string;
  at: number;
}

const DEFAULT_COBALT_INSTANCE_ID = "default";

interface CobaltState {
  cobaltInstances: CobaltInstance[];
  selectedCobaltInstanceId: string;
  cobaltInstanceStatus: Record<string, CobaltInstanceStatus>;
}

type SetCobalt = (partial: Partial<CobaltState> | ((state: CobaltState) => Partial<CobaltState>)) => void;

interface CobaltActions {
  addCobaltInstance: (instance: { label: string; url: string }) => void;
  updateCobaltInstance: (id: string, updates: { label?: string; url?: string }) => void;
  removeCobaltInstance: (id: string) => void;
  selectCobaltInstance: (id: string) => void;
  recordCobaltInstanceResult: (id: string, status: CobaltInstanceStatus["status"], errorMessage?: string) => void;
}

// -- Actions ------------------------------------------------------------------

function cobaltActions(set: SetCobalt): CobaltActions {
  return {
    addCobaltInstance: (instance) =>
      set((state) => {
        const id = crypto.randomUUID();
        return { cobaltInstances: [...state.cobaltInstances, { ...instance, id }] };
      }),
    updateCobaltInstance: (id, updates) =>
      set((state) => ({
        cobaltInstances: state.cobaltInstances.map((i) => (i.id === id ? { ...i, ...updates } : i)),
      })),
    removeCobaltInstance: (id) =>
      set((state) => {
        const { [id]: _removedStatus, ...nextStatus } = state.cobaltInstanceStatus;
        return {
          cobaltInstances: state.cobaltInstances.filter((i) => i.id !== id),
          selectedCobaltInstanceId:
            state.selectedCobaltInstanceId === id ? DEFAULT_COBALT_INSTANCE_ID : state.selectedCobaltInstanceId,
          cobaltInstanceStatus: nextStatus,
        };
      }),
    selectCobaltInstance: (id) => set({ selectedCobaltInstanceId: id }),
    recordCobaltInstanceResult: (id, status, errorMessage) =>
      set((state) => ({
        cobaltInstanceStatus: {
          ...state.cobaltInstanceStatus,
          [id]: { status, errorMessage, at: Date.now() },
        },
      })),
  };
}

// -- Exports ------------------------------------------------------------------

export type { CobaltActions, CobaltInstance, CobaltInstanceStatus };
export { cobaltActions, DEFAULT_COBALT_INSTANCE_ID };
