import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RootSearchSchema } from "../lib/searchParams.js";
import { toTeamKey } from "../lib/teamKey.js";
import { teamQueryOptions } from "../lib/api/team.js";
import { useAlgorithmVersion } from "../components/ribbon/AlgorithmSelect.js";
import { ErrorState } from "../components/StateViews.js";

/**
 * The team-artifact tracer (06-01-PLAN.md Task 1): ONE path from the live R2
 * bucket to a rendered element, no tabs, no event sections, no chart yet —
 * proves the `teamKey` derivation (06-RESEARCH.md Pitfall 4), the `page:
 * "team"` artifactKey branch, and a 287 KB artifact parse over a brand-new
 * file route with a third search param family. Task 2 replaces
 * `validateSearch` with `TeamSearchSchema` and adds the tab shell; this task
 * only needs `RootSearchSchema` (year + algorithm).
 */
export const Route = createFileRoute("/team/$teamNumber")({
  validateSearch: RootSearchSchema,
  component: TeamPage,
});

/** A route param that is not a bare positive-integer string never fires a fetch — D-19's "explain, don't silently redirect" rule, applied one level up from D-19's own year mismatch (this is the path segment itself being nonsense). */
const TEAM_NUMBER_PATTERN = /^\d+$/;

function TeamPage() {
  const { teamNumber: teamNumberParam } = Route.useParams();
  const { year, algorithm } = Route.useSearch();

  const isValidTeamNumber = TEAM_NUMBER_PATTERN.test(teamNumberParam) && Number.parseInt(teamNumberParam, 10) > 0;
  const teamNumber = isValidTeamNumber ? Number.parseInt(teamNumberParam, 10) : Number.NaN;
  const teamKey = isValidTeamNumber ? toTeamKey(teamNumber) : "";

  // 05-05-PLAN.md Task 2's established pattern, mirrored here: the artifact
  // query stays DISABLED until the algorithms manifest resolves a real
  // version, and disabled entirely for an invalid team number so no fetch
  // ever fires against a nonsense key.
  const version = useAlgorithmVersion(algorithm);

  const { data, isPending, error, refetch } = useQuery({
    ...teamQueryOptions({ teamKey, year, algorithmId: algorithm, version: version ?? "" }),
    enabled: isValidTeamNumber && version !== undefined,
    placeholderData: keepPreviousData,
  });

  if (!isValidTeamNumber) {
    return (
      <div className="p-[var(--spacing-lg)]">
        <p className="text-role-heading text-[var(--color-text-primary)]">{`"${teamNumberParam}" is not a valid team number.`}</p>
      </div>
    );
  }

  if (isPending) {
    // Task 3 replaces this with a shaped skeleton (header block + 2-3
    // event-section skeleton cards) per the UI-SPEC's E1/E5 loading rows.
    return <div className="p-[var(--spacing-lg)] text-role-body text-[var(--color-text-muted)]">Loading…</div>;
  }

  if (error) {
    return (
      <div className="p-[var(--spacing-lg)]">
        <ErrorState resource={`team ${teamNumber}`} year={year} onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="p-[var(--spacing-lg)]">
      <h1 className="text-role-display text-[var(--color-text-primary)]">{data.nickname || `Team ${teamNumber}`}</h1>
      <p className="text-role-body text-[var(--color-text-muted)]">{`#${teamNumber}`}</p>
      <p data-testid="team-record" className="numeric-cell text-role-body text-[var(--color-text-primary)]">
        {`${data.seasonStats.record.wins}-${data.seasonStats.record.losses}-${data.seasonStats.record.ties}`}
      </p>
    </div>
  );
}
