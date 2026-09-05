import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { districtDisplayName } from "@/lib/districtNames";
import type { DistrictsIndexArtifact } from "../../../../../packages/harness/pageArtifacts.js";

export interface DistrictSelectProps {
  districts: readonly DistrictsIndexArtifact["districts"][number][];
  /** `undefined` is a real, valid state — no district selected yet (this plan's must-have: "not a silently auto-picked district"). */
  value: string | undefined;
  onValueChange: (districtKey: string) => void;
}

/**
 * The `/districts` route's district picker — a `Select` over the index
 * artifact's districts, labelled with `districtDisplayName(abbreviation)`
 * (the existing map, `lib/districtNames.ts`) so a reader sees "FIRST NC",
 * never TBA's bare `fnc` abbreviation. Changing it navigates, updating
 * `?district=` while preserving every other search param — the route's own
 * `handleDistrictChange` (in `districts.tsx`) is the one place that
 * navigation happens; this component only reports the new value.
 */
export function DistrictSelect({ districts, value, onValueChange }: DistrictSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label="District" className="w-[16rem]">
        <SelectValue placeholder="Choose a district" />
      </SelectTrigger>
      <SelectContent>
        {districts.map((district) => (
          <SelectItem key={district.districtKey} value={district.districtKey}>
            {districtDisplayName(district.abbreviation)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
