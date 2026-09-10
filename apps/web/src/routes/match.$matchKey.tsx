import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_EVENT_TAB, MatchSearchSchema } from "../lib/searchParams.js";
import { eventKeyFromMatchKey, isValidMatchKey } from "../lib/matchKey.js";
import { seasonFromEventKey } from "../lib/eventKey.js";
import { eventQueryOptions } from "../lib/api/event.js";
import { ArtifactFetchError } from "../lib/api/errors.js";
import { useAlgorithmVersion } from "../components/ribbon/AlgorithmSelect.js";
import { EmptyState, ErrorState } from "../components/StateViews.js";
import { EventMatchTable, EventMatchTableSkeleton } from "../components/event/EventMatchTable.js";
import { computeEventAxisDomain, mergeEventMatches } from "../components/event/eventMatchAxis.js";
import { formatScheduledTime, matchLabel } from "../components/team/MatchTable.js";
import { MatchVideoCell } from "../components/MatchVideoCell.js";
import { parseMatchVideoKey } from "../lib/matchVideo.js";
import type { AxisDomain } from "../components/team/matchAxis.js";
import type { EventMatchRow } from "../components/event/eventMatchAxis.js";
import type { EventArtifact } from "../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../packages/harness/publishedAlgorithms.js";

/**
 * The `/match/{matchKey}` route (260909-tiq-PLAN.md Task 1). Reuses
 * `eventQueryOptions` UNCHANGED (D-01: no new fetcher, no new artifact) so a
 * reader arriving from the event page hits a warm TanStack Query cache — the
 * same artifact, the same query key.
 */
export const Route = createFileRoute("/match/$matchKey")({
  validateSearch: MatchSearchSchema,
  component: MatchPage,
});

const MATCH_PAGE_EMPTY_STATE_BODY = "This usually means results haven't published yet. Check back shortly.";

/** The pending state's placeholder — the single-row table shape, matching `QualsTabSkeleton`'s established pattern. */
function MatchPageSkeleton() {
  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <div className="flex flex-col gap-[var(--spacing-xs)]">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div data-testid="match-table-scroll" className="data-card min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <EventMatchTableSkeleton rowCount={1} />
      </div>
    </div>
  );
}

function MatchPage() {
  const { matchKey } = Route.useParams();
  const { algorithm } = Route.useSearch();

  const isValidKey = isValidMatchKey(matchKey);
  // Declared unconditionally, before any early return — `eventKeyFromMatchKey`
  // would throw on an invalid key, so this guards the call rather than
  // letting the throw reach render. `""` never reaches `isValidEventKey`'s
  // caller below because the query stays disabled and the invalid-key branch
  // returns before `seasonFromEventKey` is ever called.
  const eventKey = isValidKey ? eventKeyFromMatchKey(matchKey) : "";

  // 07-01-PLAN.md's established pattern, mirrored here exactly: the artifact
  // query stays DISABLED until the algorithms manifest resolves a real
  // version, and disabled entirely for an invalid match key so no fetch ever
  // fires against a nonsense key.
  const version = useAlgorithmVersion(algorithm);

  const { data, isPending, error, refetch } = useQuery({
    ...eventQueryOptions({ eventKey, algorithmId: algorithm, version: version ?? "" }),
    enabled: isValidKey && version !== undefined,
  });

  // Computed over ALL of the event's rows, never just this one — the site's
  // one-shared-event-scale rule (sketch 003 variant C): this match's bands
  // must be drawn on the same scale as the event's other matches, and a
  // domain computed from a single row would be degenerate.
  const rows = useMemo(() => (data === undefined ? [] : mergeEventMatches(data.matches, data.upcoming, () => true)), [data]);
  const domain = useMemo(() => computeEventAxisDomain(rows), [rows]);
  const row = rows.find((candidate) => candidate.matchKey === matchKey);

  if (!isValidKey) {
    return (
      <div className="p-[var(--spacing-lg)]">
        <p className="text-role-heading text-[var(--color-text-primary)]">{`"${matchKey}" is not a valid match key.`}</p>
      </div>
    );
  }

  const season = seasonFromEventKey(eventKey);

  // A 404 means no artifact was ever published for this event — the same
  // branch `event.$eventKey.tsx` applies, one level down. Every OTHER fetch
  // failure (500, network error, a validation failure) stays the ordinary
  // page-level error.
  const is404 = error instanceof ArtifactFetchError && error.status === 404;

  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      {is404 ? (
        <EmptyState heading={`No published results for ${eventKey} yet`} body={MATCH_PAGE_EMPTY_STATE_BODY} />
      ) : error ? (
        <ErrorState resource={`match ${matchKey}`} year={season} onRetry={() => void refetch()} />
      ) : isPending || data === undefined ? (
        <MatchPageSkeleton />
      ) : row === undefined ? (
        <EmptyState heading={`No match ${matchKey} published for this event`} body={MATCH_PAGE_EMPTY_STATE_BODY} />
      ) : (
        <MatchPageBody data={data} row={row} domain={domain} season={season} algorithm={algorithm} />
      )}
    </div>
  );
}

function MatchPageBody({
  data,
  row,
  domain,
  season,
  algorithm,
}: {
  data: EventArtifact;
  row: EventMatchRow;
  domain: AxisDomain;
  season: number;
  algorithm: PublishedAlgorithmId;
}) {
  // `parseMatchVideoKey` is the ONLY resolver; an unparseable key renders
  // nothing at all, identically to a missing one (T-7eu-01 preserved by
  // reuse, never re-implemented). No video URL is ever constructed here.
  const parsedVideo = parseMatchVideoKey(row.video);

  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <div className="flex flex-col gap-[var(--spacing-xs)]">
        <span className="text-role-heading text-[var(--color-text-primary)]">{matchLabel(row)}</span>
        <span className="flex flex-wrap items-center gap-[var(--spacing-sm)]">
          <Link
            to="/event/$eventKey"
            params={{ eventKey: data.eventKey }}
            search={{ year: season, algorithm, tab: DEFAULT_EVENT_TAB }}
            className="text-role-body text-[var(--color-accent)] hover:underline"
          >
            {data.name ?? data.eventKey}
          </Link>
          {row.sortTime !== undefined && <span className="text-role-body text-[var(--color-text-muted)]">{formatScheduledTime(row.sortTime)}</span>}
        </span>
      </div>

      <div data-testid="match-table-scroll" className="data-card min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        {/* `data.season` — the published field — not the `?year=` search
            param (Decision 1, applied one level down from the event page). */}
        <EventMatchTable rows={[row]} domain={domain} season={data.season} algorithm={algorithm} />
      </div>

      {parsedVideo !== undefined && (
        <div className="flex flex-col gap-[var(--spacing-sm)]">
          <span className="text-role-label text-[var(--color-text-muted)]">Video</span>
          <MatchVideoCell matchKey={row.matchKey} matchLabel={matchLabel(row)} videoKey={row.video} />
        </div>
      )}
    </div>
  );
}
