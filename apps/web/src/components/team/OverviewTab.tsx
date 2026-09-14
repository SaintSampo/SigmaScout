import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { SeasonHeader } from "./SeasonHeader.js";
import { EventSectionList } from "./EventSectionList.js";
import { TierKeyRow } from "./TierKeyRow.js";

/**
 * The Overview panel's composition seam. Mounts `SeasonHeader` and
 * `EventSectionList` with their final, FROZEN prop contracts — the two
 * children's bodies fill in without ever editing this file, which is what
 * lets them be worked on independently.
 */
export interface OverviewTabProps {
  artifact: TeamSeasonArtifact;
  /** Narrowed from `string` — see `SeasonHeaderProps.algorithmId`'s doc comment for the full reasoning; this component only threads the value through unchanged. */
  algorithmId: PublishedAlgorithmId;
  season: number;
  teamNumber: number;
  /**
   * The last-OFFICIAL-match snapshot metrics, threaded from the route: the
   * original snapshot change wired the route's `headerMetrics` into the
   * EMPTY-events branch's direct `SeasonHeader` render but missed this
   * success-path composition, so every normal team page silently kept
   * showing season-final values.
   */
  metricsOverride?: TeamSeasonArtifact["metricHistory"][number]["metrics"];
  /** The snapshot row's `matchKey`, threaded through unchanged — see `SeasonHeaderProps.snapshotMatchKey`. */
  snapshotMatchKey?: string;
}

export function OverviewTab({ artifact, algorithmId, season, teamNumber, metricsOverride, snapshotMatchKey }: OverviewTabProps) {
  return (
    <div className="flex min-w-0 flex-col gap-[var(--spacing-xl)]">
      <div className="data-card p-[var(--spacing-md)]">
        {/*
          `RankCards` mounts INSIDE `SeasonHeader` (rendered in its identity
          row, right-aligned) — this component does not mount `RankCards`
          itself. `artifact.ranks` is threaded straight through;
          `SeasonHeader`/`RankCards` own the graceful-absence contract
          (undefined/empty both render nothing).
        */}
        <SeasonHeader artifact={artifact} algorithmId={algorithmId} season={season} teamNumber={teamNumber} metricsOverride={metricsOverride} snapshotMatchKey={snapshotMatchKey} ranks={artifact.ranks} />
      </div>
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
