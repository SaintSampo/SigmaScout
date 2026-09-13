import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { districtDisplayName } from "@/lib/districtNames";
import type { DistrictsIndexArtifact } from "../../../../../packages/harness/pageArtifacts.js";

export interface DistrictSelectProps {
  districts: readonly DistrictsIndexArtifact["districts"][number][];
  /** `undefined` is a real, valid state — no district selected yet (this plan's must-have: "not a silently auto-picked district"). */
  value: string | undefined;
  onValueChange: (districtKey: string) => void;
}

/**
 * The `/districts` route's district picker — one clickable chip per index
 * artifact district, labelled with `districtDisplayName(abbreviation)` (the
 * existing map, `lib/districtNames.ts`) so a reader sees "FIRST NC", never
 * TBA's bare `fnc` abbreviation. Every district is visible at once rather
 * than behind a dropdown; the chips wrap on narrow screens.
 *
 * A labelled `role="group"` of `aria-pressed` buttons, the same shape as
 * `CompLevelSwitcher.tsx`. With no district selected no chip is pressed.
 * Clicking reports the new value only — the route's own
 * `handleDistrictChange` (in `districts.tsx`) is the one place that
 * navigation happens, updating `?district=` while preserving every other
 * search param.
 */
export function DistrictSelect({ districts, value, onValueChange }: DistrictSelectProps) {
  return (
    <div role="group" aria-label="District" className="flex flex-wrap gap-[var(--spacing-xs)]">
      {districts.map((district) => {
        const isActive = district.districtKey === value;
        return (
          <Button
            key={district.districtKey}
            type="button"
            variant={isActive ? "default" : "outline"}
            aria-pressed={isActive}
            className={cn("tap-target rounded-full px-[var(--spacing-md)]")}
            onClick={() => onValueChange(district.districtKey)}
          >
            {districtDisplayName(district.abbreviation)}
          </Button>
        );
      })}
    </div>
  );
}
