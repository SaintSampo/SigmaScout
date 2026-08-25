import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { SeasonHeader } from "./SeasonHeader.js";
import { EventSectionList } from "./EventSectionList.js";

/**
 * The Overview panel's composition seam (06-01-PLAN.md Task 2). Mounts
 * `SeasonHeader` and `EventSectionList` with their final, FROZEN prop
 * contracts — plans 06-07 and 06-08 fill the two children's bodies without
 * ever editing this file, which is what lets them run in the same wave.
 */
export interface OverviewTabProps {
  artifact: TeamSeasonArtifact;
  algorithmId: string;
  season: number;
  teamNumber: number;
}

export function OverviewTab({ artifact, algorithmId, season, teamNumber }: OverviewTabProps) {
  return (
    <div className="flex min-w-0 flex-col gap-[var(--spacing-xl)]">
      <SeasonHeader artifact={artifact} algorithmId={algorithmId} season={season} teamNumber={teamNumber} />
      <EventSectionList artifact={artifact} algorithmId={algorithmId} season={season} teamNumber={teamNumber} />
    </div>
  );
}
