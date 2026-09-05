import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { SeasonHeader } from "./SeasonHeader.js";
import { EventSectionList } from "./EventSectionList.js";
import { TierKeyRow } from "./TierKeyRow.js";
import { RankCards } from "./RankCards.js";

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
  /**
   * The last-OFFICIAL-match snapshot metrics, threaded from the route
   * (2026-09-01 fix): the original snapshot change wired the route's
   * `headerMetrics` into the EMPTY-events branch's direct `SeasonHeader`
   * render but missed this success-path composition, so every normal team
   * page silently kept showing season-final values.
   */
  metricsOverride?: TeamSeasonArtifact["metricHistory"][number]["metrics"];
}

export function OverviewTab({ artifact, algorithmId, season, teamNumber, metricsOverride }: OverviewTabProps) {
  return (
    <div className="flex min-w-0 flex-col gap-[var(--spacing-xl)]">
      <div className="data-card p-[var(--spacing-md)]">
        <SeasonHeader artifact={artifact} algorithmId={algorithmId} season={season} teamNumber={teamNumber} metricsOverride={metricsOverride} />
      </div>
      {/*
        Quick task 260905-ldu: World/Country/District/State rank cards for
        the currently selected algorithm/year. Renders nothing at all on an
        artifact with no `ranks` (absent or empty) — see RankCards.tsx.
      */}
      <RankCards ranks={artifact.ranks} />
      <EventSectionList artifact={artifact} algorithmId={algorithmId} season={season} teamNumber={teamNumber} />
      {/*
        The tier key is a legend, not a headline: it explains the colour
        banding used by the metric grid above and by every match row, so it
        reads as a footnote at the end of the page rather than as a band
        wedged between the team's identity and its numbers.
      */}
      <TierKeyRow />
    </div>
  );
}
