import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * The reader's Swing Factor visibility preference (quick task 260908-5wd) —
 * `MetricValue.tsx`, the one ± render primitive every metric surface already
 * routes through, reads `showSwingFactor` from this store directly.
 *
 * This is deliberately NOT a URL search param, unlike this app's usual rule
 * (`filterSheet.ts`'s own header: everything shareable lives in the URL).
 * Swing Factor visibility is a durable, per-reader VIEWING preference, not a
 * property of the page being shared — a link sent to somebody else must show
 * them the ± unless THEY have turned it off, never carry the sender's choice.
 * `persist` targets `localStorage` (the zustand-bundled default), keyed under
 * the explicit, versioned name below, so the choice survives a reload.
 *
 * Defaults to `true` — deliberately, not incidentally. Honest uncertainty is
 * this product's stated differentiator (`.claude/CLAUDE.md`'s "Core Value"),
 * so hiding it must be an act a reader takes, never something the site does
 * for them on first visit.
 *
 * Scope boundary, so a later reader does not "finish the job" by widening
 * this: this toggle governs ONLY the per-team/per-metric bonus stat
 * `MetricValue` renders. It must NEVER gate match-prediction bands, plots, or
 * any surface fed by `redScoreVarianceOwn` — those draw a match's own full
 * predictive variance, a different quantity entirely
 * (`uncertainty-display.md`'s "one quantity, everywhere" rule), and hiding
 * them would draw a lie-by-omission band, not an honest toggle.
 */
interface DisplaySettingsState {
  showSwingFactor: boolean;
  toggleSwingFactor: () => void;
}

export const useDisplaySettingsStore = create<DisplaySettingsState>()(
  persist(
    (set) => ({
      showSwingFactor: true,
      toggleSwingFactor: () => set((state) => ({ showSwingFactor: !state.showSwingFactor })),
    }),
    { name: "sigmascout-display-settings" }
  )
);
