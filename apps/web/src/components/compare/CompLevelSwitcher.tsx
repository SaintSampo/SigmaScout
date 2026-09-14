import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CompareCompLevelView } from "../../lib/api/compare.js";

/**
 * The Compare page's three-segment compLevel switcher. Three `Button`s in
 * a labelled `role="group"`, NOT Radix `Tabs` — this control re-slices two
 * sibling sections that stay mounted, rather than swapping one panel, and
 * `Tabs`' `TabsList` locks a 32px height that fights the 44x44 tap-target
 * exception for this exact control.
 *
 * FULLY CONTROLLED: `value`/`onValueChange` only, no internal state hook.
 * `compare.tsx` holds the ONE `compLevelView` state both this switcher and
 * `AccuracyTable` (and the calibration section) read — a second copy of
 * the selection here would be exactly the "two controls that could
 * disagree" shape this design exists to prevent.
 */

export const COMP_LEVEL_SWITCHER_TESTID = "compare-comp-level-switcher";

/** The group's accessible name matches the register its own segment labels are written in. */
const COMP_LEVEL_SWITCHER_GROUP_LABEL = "Match type";

export interface CompLevelViewOption {
  readonly view: CompareCompLevelView;
  readonly label: string;
}

/** The exact three labels, in the fixed Combined/Qualification/Elimination order. */
export const COMP_LEVEL_VIEW_OPTIONS: readonly CompLevelViewOption[] = [
  { view: "combined", label: "Combined" },
  { view: "qualification", label: "Qualification" },
  { view: "elimination", label: "Elimination" },
];

export const DEFAULT_COMP_LEVEL_VIEW: CompareCompLevelView = "combined";

/** A stable per-segment test id, so the route test and the narrow-width check address segments without depending on label text. */
export function compLevelSegmentTestId(view: CompareCompLevelView): string {
  return `${COMP_LEVEL_SWITCHER_TESTID}-segment-${view}`;
}

export interface CompLevelSwitcherProps {
  readonly value: CompareCompLevelView;
  readonly onValueChange: (view: CompareCompLevelView) => void;
}

export function CompLevelSwitcher({ value, onValueChange }: CompLevelSwitcherProps) {
  return (
    <div
      role="group"
      aria-label={COMP_LEVEL_SWITCHER_GROUP_LABEL}
      data-testid={COMP_LEVEL_SWITCHER_TESTID}
      className="inline-flex gap-[var(--spacing-xs)]"
    >
      {COMP_LEVEL_VIEW_OPTIONS.map((option) => {
        const isActive = option.view === value;
        return (
          <Button
            key={option.view}
            type="button"
            variant={isActive ? "default" : "ghost"}
            aria-pressed={isActive}
            data-testid={compLevelSegmentTestId(option.view)}
            className={cn("tap-target")}
            onClick={() => onValueChange(option.view)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
