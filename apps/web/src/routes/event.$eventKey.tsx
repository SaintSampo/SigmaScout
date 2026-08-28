import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { EventSearchSchema } from "../lib/searchParams.js";
import { isValidEventKey, seasonFromEventKey } from "../lib/eventKey.js";
import { eventQueryOptions } from "../lib/api/event.js";
import { useAlgorithmVersion } from "../components/ribbon/AlgorithmSelect.js";
import { ErrorState } from "../components/StateViews.js";
import { EventSectionSkeleton } from "../components/Skeletons.js";

/**
 * The `/event/{eventKey}` route (07-01-PLAN.md). Task 1's tracer proves the
 * single artifact-fetch path — one real, already-published event artifact
 * flowing from the R2 bucket, through `EventArtifactSchema.parse`, into a
 * rendered element. Task 3 replaces this provisional body with the tab strip
 * and the real Breakdown panel.
 */
export const Route = createFileRoute("/event/$eventKey")({
  validateSearch: EventSearchSchema,
  component: EventPage,
});

function EventPage() {
  const { eventKey } = Route.useParams();
  const { algorithm } = Route.useSearch();

  const isValidKey = isValidEventKey(eventKey);

  // 05-05-PLAN.md Task 2's established pattern, mirrored here (and by
  // `team.$teamNumber.tsx`): the artifact query stays DISABLED until the
  // algorithms manifest resolves a real version, and disabled entirely for
  // an invalid event key so no fetch ever fires against a nonsense key.
  const version = useAlgorithmVersion(algorithm);

  const { data, isPending, error, refetch } = useQuery({
    ...eventQueryOptions({ eventKey, algorithmId: algorithm, version: version ?? "" }),
    enabled: isValidKey && version !== undefined,
    placeholderData: keepPreviousData,
  });

  if (!isValidKey) {
    return (
      <div className="p-[var(--spacing-lg)]">
        <p className="text-role-heading text-[var(--color-text-primary)]">{`"${eventKey}" is not a valid event key.`}</p>
      </div>
    );
  }

  const season = seasonFromEventKey(eventKey);

  if (error) {
    return <ErrorState resource={`event ${eventKey}`} year={season} onRetry={() => void refetch()} />;
  }

  if (isPending || data === undefined) {
    return (
      <div className="p-[var(--spacing-lg)]">
        <EventSectionSkeleton />
      </div>
    );
  }

  const firstTeam = data.teams[0];

  return (
    <div className="p-[var(--spacing-lg)]">
      <p data-testid="event-key">{data.eventKey}</p>
      <p data-testid="event-season">{data.season}</p>
      <p data-testid="event-team-count">{data.teams.length}</p>
      {firstTeam !== undefined && (
        <p data-testid="event-first-team">{`${firstTeam.teamNumber ?? "?"} ${firstTeam.nickname ?? ""}`}</p>
      )}
    </div>
  );
}
