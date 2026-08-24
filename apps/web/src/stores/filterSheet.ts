import { create } from "zustand";

/**
 * The only non-URL UI state this phase keeps (05-07-PLAN.md Task 3): whether
 * the mobile Events filter sheet (D-15) is open. Every filter VALUE lives in
 * the URL (`searchParams.ts`'s `EventsSearchSchema`) — this store holds
 * nothing shareable, which is exactly why it is the one piece of state a
 * shared link should not carry, and exactly why a second field here would
 * be a signal that something shareable is being kept out of the URL.
 */
interface FilterSheetState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useFilterSheetStore = create<FilterSheetState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
