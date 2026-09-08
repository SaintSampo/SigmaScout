import { useDisplaySettingsStore } from "@/stores/displaySettings";

/**
 * The ribbon's site-wide Swing Factor switch (quick task 260908-5wd) — one
 * control that gates every ± on the site from one place, via
 * `MetricValue.tsx` reading `displaySettings.ts`'s `showSwingFactor`
 * directly.
 *
 * The `±` glyph alone is the visible affordance — the same discipline as
 * `GitHubLink`'s icon-only rendering — so `aria-label` names Swing Factor
 * explicitly for assistive tech, and `aria-pressed` reports the on/off state.
 *
 * Styled with the ribbon's own token vocabulary only (`--ribbon-ink` /
 * `--ribbon-ink-muted`, the same `transition-colors` hover treatment
 * `GitHubLink` uses) — never `--color-accent`, which belongs to the page and
 * not the bar. Sized to the glyph, matching `GitHubLink`'s explicit choice
 * not to wear `.tap-target`: a 44px minimum in this row grows the ribbon's
 * height, a regression the user reported on 2026-09-04.
 */
export function SwingFactorToggle() {
  const showSwingFactor = useDisplaySettingsStore((state) => state.showSwingFactor);
  const toggleSwingFactor = useDisplaySettingsStore((state) => state.toggleSwingFactor);

  return (
    <button
      type="button"
      aria-pressed={showSwingFactor}
      aria-label={showSwingFactor ? "Hide Swing Factor (±)" : "Show Swing Factor (±)"}
      onClick={toggleSwingFactor}
      className={
        showSwingFactor
          ? "flex shrink-0 items-center justify-center text-[var(--ribbon-ink)] transition-colors hover:text-[var(--ribbon-ink)]"
          : "flex shrink-0 items-center justify-center text-[var(--ribbon-ink-muted)] transition-colors hover:text-[var(--ribbon-ink)]"
      }
    >
      ±
    </button>
  );
}
